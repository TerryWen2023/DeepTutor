'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { UserError, atomicWrite } = require('./backend.cjs');
const { normalizeGrade } = require('../shared/education.js');

const scrypt = promisify(crypto.scrypt);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LEGACY_FILES = ['study.json', 'settings.json', 'deepseek-key.bin', path.join('codex', 'auth.json')];
const MAX_ACCOUNTS_BYTES = 1024 * 1024;

function fail(message) { throw new UserError(message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function publicAccount(account) { return { id: account.id, username: account.username, name: account.name, grade: account.grade }; }
function usernameKey(username) { return username.normalize('NFKC').toLowerCase(); }

function validateDetails(input) {
  if (!object(input)) fail('账号资料格式不正确。');
  const username = typeof input.username === 'string' ? input.username.normalize('NFKC').trim() : '';
  if (!username || username.length > 40 || !/^[\p{L}\p{N}_.@-]+$/u.test(username)) fail('账号名请使用 1 至 40 个汉字、字母、数字或 _ . @ -。');
  const name = input.name == null ? username : typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) fail('昵称请填写 1 至 40 个字符。');
  const grade = normalizeGrade(input.grade);
  if (!grade) fail('请选择小学一年级至高三的有效年级。');
  return { username, name, grade };
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6 || password.length > 256 || !password.trim()) fail('密码需要 6 至 256 个字符。');
  return password;
}

function validateStore(data) {
  if (!object(data) || data.version !== 1 || !Array.isArray(data.accounts) || data.accounts.length > 1000) fail('账号档案无法读取，原文件已保留，请先备份后再恢复。');
  const ids = new Set();
  const usernames = new Set();
  const accounts = data.accounts.map((entry) => {
    if (!object(entry) || typeof entry.id !== 'string' || !UUID.test(entry.id)) fail('账号档案编号不正确，原文件已保留。');
    const details = validateDetails(entry);
    const key = usernameKey(details.username);
    if (ids.has(entry.id) || usernames.has(key)) fail('账号档案存在重复，原文件已保留。');
    ids.add(entry.id);
    usernames.add(key);
    const credential = entry.credential;
    if (!object(credential) || credential.algorithm !== 'scrypt-v1' || typeof credential.salt !== 'string' || !/^[0-9a-f]{32}$/.test(credential.salt) || typeof credential.hash !== 'string' || !/^[0-9a-f]{128}$/.test(credential.hash)) fail('账号密码档案无法读取，原文件已保留。');
    return { id: entry.id, ...details, credential: { algorithm: 'scrypt-v1', salt: credential.salt, hash: credential.hash } };
  });
  // A nonempty account registry itself also prevents a repeated legacy import.
  const legacyMigration = data.legacyMigration ?? null;
  if (legacyMigration !== null && (!object(legacyMigration) || !ids.has(legacyMigration.accountId) || !Array.isArray(legacyMigration.files) || legacyMigration.files.some((file) => !LEGACY_FILES.includes(file)))) fail('旧档案迁移记录无法读取，原文件已保留。');
  return { version: 1, accounts, legacyMigration };
}

class AccountManager {
  constructor({ userData, createBackend }) {
    if (typeof userData !== 'string' || typeof createBackend !== 'function') throw new TypeError('AccountManager requires userData and createBackend.');
    this.userData = path.resolve(userData);
    this.profilesDirectory = path.join(this.userData, 'profiles');
    this.accountsFile = path.join(this.userData, 'accounts.json');
    this.createBackend = createBackend;
    this.store = { version: 1, accounts: [], legacyMigration: null };
    this.session = null;
    this.hasLegacyData = false;
    this.initialized = false;
    this.operationChain = Promise.resolve();
    this.disposing = false;
    this.disposePromise = null;
  }

  assertOpen() { if (this.disposing) fail('应用正在关闭，请重新打开后登录。'); }

  enqueue(action) {
    const next = this.operationChain.then(async () => {
      this.assertOpen();
      try { return await action(); }
      catch (error) {
        if (error instanceof UserError) throw error;
        fail('账号档案暂时无法保存或读取，原有资料已保留，请重试。');
      }
    });
    this.operationChain = next.catch(() => {});
    return next;
  }

  async ensureDirectory(directory) {
    await fs.mkdir(directory, { recursive: true });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('账号档案目录不正确，请先备份后再恢复。');
  }

  accountDirectory(id) {
    if (typeof id !== 'string' || !UUID.test(id)) fail('请选择有效的学习账号。');
    const directory = path.resolve(this.profilesDirectory, id);
    if (path.dirname(directory) !== this.profilesDirectory) fail('账号档案目录不正确。');
    return directory;
  }

  async legacyFiles() {
    const files = [];
    for (const file of LEGACY_FILES) {
      try {
        const stat = await fs.lstat(path.join(this.userData, file));
        if (!stat.isFile() || stat.isSymbolicLink()) fail('旧档案文件不正确，原文件已保留，请先备份后再恢复。');
        files.push(file);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return files;
  }

  async initializeInternal() {
    if (this.initialized) return;
    await this.ensureDirectory(this.userData);
    await this.ensureDirectory(this.profilesDirectory);
    let store;
    try {
      const stat = await fs.lstat(this.accountsFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ACCOUNTS_BYTES) fail('账号档案文件不正确或过大，原文件已保留。');
      store = validateStore(JSON.parse(await fs.readFile(this.accountsFile, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') store = { version: 1, accounts: [], legacyMigration: null };
      else if (error instanceof UserError) throw error;
      else fail('账号档案无法读取，原文件已保留，请先备份后再恢复。');
    }
    const hasLegacyData = store.accounts.length === 0 && (await this.legacyFiles()).length > 0;
    this.store = store;
    this.hasLegacyData = hasLegacyData;
    this.initialized = true;
  }

  initialize() { return this.enqueue(async () => { await this.initializeInternal(); return this.getState(); }); }

  getState() {
    return {
      accounts: this.store.accounts.map(publicAccount),
      activeAccount: this.session && !this.disposing ? publicAccount(this.session.account) : null,
      sessionToken: this.session && !this.disposing ? this.session.token : null,
      hasLegacyData: this.hasLegacyData,
    };
  }

  requireSession(token) {
    if (this.disposing || !this.session || typeof token !== 'string' || token !== this.session.token) fail('登录状态已变化，请重新登录学习账号。');
    return { account: publicAccount(this.session.account), backend: this.session.backend, directory: this.session.directory };
  }

  async closeBackend(backend) {
    if (!backend) return;
    // Capture jobs before dispose clears their bookkeeping, then let their aborts settle.
    const pending = [...(backend.requests?.values() || [])].map((request) => request.finished).filter(Boolean);
    if (backend.loginPromise) pending.push(backend.loginPromise);
    let failure;
    try { await backend.dispose(); } catch (error) { failure = error; }
    await Promise.allSettled(pending);
    try { await backend.writeChain; } catch (error) { failure ||= error; }
    if (failure) throw failure;
  }

  async activate(account, backend, directory) {
    this.assertOpen();
    const previous = this.session;
    this.session = null; // Old renderer requests stop being authorized before cancellation.
    await this.closeBackend(previous?.backend);
    this.assertOpen();
    this.session = { account, backend, directory, token: crypto.randomBytes(32).toString('hex') };
  }

  createAccount(input) {
    return this.enqueue(async () => {
      await this.initializeInternal();
      const details = validateDetails(input);
      const password = validatePassword(input.password);
      if (this.store.accounts.some((account) => usernameKey(account.username) === usernameKey(details.username))) fail('这个账号名已存在，请换一个账号名。');
      if (this.store.accounts.length >= 1000) fail('本机账号数量已达到上限。');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = (await scrypt(password, Buffer.from(salt, 'hex'), 64)).toString('hex');
      const account = { id: crypto.randomUUID(), ...details, credential: { algorithm: 'scrypt-v1', salt, hash } };
      const directory = this.accountDirectory(account.id);
      let backend;
      let directoryCreated = false;
      let committed = false;
      try {
        await fs.mkdir(directory); // Never reuse or overwrite another profile's directory.
        directoryCreated = true;
        const migratedFiles = this.store.accounts.length === 0 ? await this.legacyFiles() : [];
        for (const file of migratedFiles) {
          const destination = path.join(directory, file);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(path.join(this.userData, file), destination, require('node:fs').constants.COPYFILE_EXCL);
        }
        backend = await this.createBackend(directory);
        await backend.initialize();
        const study = await backend.getStudyData();
        await backend.saveStudyData({ ...study, profile: { name: details.name, grade: details.grade } });
        const nextStore = {
          ...this.store,
          accounts: [...this.store.accounts, account],
          legacyMigration: this.store.accounts.length === 0 ? { accountId: account.id, files: migratedFiles, completedAt: new Date().toISOString() } : this.store.legacyMigration,
        };
        this.assertOpen();
        await atomicWrite(this.accountsFile, JSON.stringify(nextStore, null, 2));
        committed = true;
        this.store = nextStore;
        this.hasLegacyData = false;
        await this.activate(account, backend, directory);
        return { ...this.getState(), migratedLegacyData: migratedFiles.length > 0 };
      } catch (error) {
        await this.closeBackend(backend).catch(() => {});
        // Cleanup is confined to the UUID directory exclusively created by this attempt.
        // A committed account is retained even if session shutdown subsequently failed.
        if (!committed && directoryCreated && directory === this.accountDirectory(account.id) && path.dirname(directory) === this.profilesDirectory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  login(input) {
    return this.enqueue(async () => {
      await this.initializeInternal();
      if (!object(input) || typeof input.accountId !== 'string' || !UUID.test(input.accountId)) fail('请选择有效的学习账号。');
      const password = validatePassword(input.password);
      const account = this.store.accounts.find((entry) => entry.id === input.accountId);
      if (!account) fail('账号不存在，请重新选择。');
      const hash = await scrypt(password, Buffer.from(account.credential.salt, 'hex'), 64);
      if (!crypto.timingSafeEqual(hash, Buffer.from(account.credential.hash, 'hex'))) fail('密码不正确，请重新输入。');
      const directory = this.accountDirectory(account.id);
      // Missing profiles must not silently replace existing study records with defaults.
      const stat = await fs.lstat(directory).catch((error) => { if (error.code === 'ENOENT') fail('这个账号的学习档案目录已丢失，请从备份恢复。'); throw error; });
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('账号档案目录不正确，请先备份后再恢复。');
      let backend;
      try {
        backend = await this.createBackend(directory);
        await backend.initialize();
        await this.activate(account, backend, directory);
        return this.getState();
      } catch (error) { await this.closeBackend(backend).catch(() => {}); throw error; }
    });
  }

  updateProfile(token, profile) {
    return this.enqueue(async () => {
      await this.initializeInternal();
      // Check after entering the same queue as login/logout: a request queued
      // behind an account switch cannot update the newly selected student.
      const { account } = this.requireSession(token);
      if (!object(profile)) fail('账号资料格式不正确。');
      const details = validateDetails({ username: account.username, name: profile.name, grade: profile.grade });
      if (details.name === account.name && details.grade === account.grade) return this.getState();
      const previous = this.store.accounts.find((entry) => entry.id === account.id);
      const updated = { ...previous, name: details.name, grade: details.grade };
      const nextStore = { ...this.store, accounts: this.store.accounts.map((entry) => entry.id === account.id ? updated : entry) };
      await atomicWrite(this.accountsFile, JSON.stringify(nextStore, null, 2));
      this.store = nextStore;
      if (this.session?.token === token) this.session.account = updated;
      return this.getState();
    });
  }

  logout(token) {
    return this.enqueue(async () => {
      await this.initializeInternal();
      // IPC callers pass their token; queueing behind a login must not let an
      // old request terminate the newly activated account's session.
      if (token !== undefined) this.requireSession(token);
      const previous = this.session;
      this.session = null;
      await this.closeBackend(previous?.backend);
      return this.getState();
    });
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise;
    this.disposing = true;
    this.disposePromise = this.operationChain.then(async () => {
      const previous = this.session;
      this.session = null;
      await this.closeBackend(previous?.backend);
    });
    return this.disposePromise;
  }
}

module.exports = { AccountManager };
