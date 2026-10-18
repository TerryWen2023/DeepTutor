'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { AccountManager } = require('../electron/accounts.cjs');
const { LearningBackend, UserError } = require('../electron/backend.cjs');

const accountInput = (username, overrides = {}) => ({ username, password: 'test-password-123', name: `${username}同学`, grade: 5, ...overrides });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wen-accounts-test-'));
  const backends = [];
  const managers = [];
  const encryptionKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString: (value) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8');
    },
  };
  const createBackend = (userData) => {
    const backend = new LearningBackend({ userData, safeStorage, codexPath: '', fetchImpl: () => assert.fail('Unexpected network request') });
    backends.push(backend);
    return backend;
  };
  const createManager = (factory = createBackend) => {
    const manager = new AccountManager({ userData: directory, createBackend: factory });
    managers.push(manager);
    return manager;
  };
  t.after(async () => {
    await Promise.all(managers.map((manager) => manager.dispose().catch(() => {})));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('wen-accounts-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, manager: createManager(), createManager, createBackend, safeStorage, backends };
}

test('accounts own independent profile, history, provider settings, encrypted key and Codex directory', async (t) => {
  const { manager } = await fixture(t);
  const first = await manager.createAccount(accountInput('姐姐', { name: '小文', grade: 8 }));
  const firstSession = manager.requireSession(first.sessionToken);
  assert.deepEqual((await firstSession.backend.getStudyData()).profile, { name: '小文', grade: 8 });
  const study = await firstSession.backend.getStudyData();
  await firstSession.backend.saveStudyData({ ...study, mistakes: [{ id: 'private-mistake', question: '姐姐的错题' }] });
  await firstSession.backend.saveSettings({ provider: 'codex', deepseekKey: 'sk-first-account-private' });
  await fs.writeFile(path.join(firstSession.directory, 'codex', 'auth.json'), '{"token":"first-account-only"}');
  const second = await manager.createAccount(accountInput('弟弟', { name: '小习', grade: 3 }));
  const secondSession = manager.requireSession(second.sessionToken);
  assert.notEqual(firstSession.directory, secondSession.directory);
  assert.equal(path.basename(path.dirname(secondSession.directory)), 'profiles');
  const secondStudy = await secondSession.backend.getStudyData();
  assert.deepEqual(secondStudy.profile, { name: '小习', grade: 3 });
  assert.deepEqual(secondStudy.mistakes, []);
  assert.equal((await secondSession.backend.getSettings()).provider, 'deepseek');
  assert.equal((await secondSession.backend.getSettings()).hasDeepseekKey, false);
  await assert.rejects(fs.access(path.join(secondSession.directory, 'codex', 'auth.json')), { code: 'ENOENT' });
  const returned = await manager.login({ accountId: first.activeAccount.id, password: 'test-password-123' });
  const restored = manager.requireSession(returned.sessionToken);
  assert.equal((await restored.backend.getStudyData()).mistakes[0].id, 'private-mistake');
  assert.equal(await restored.backend.readKey(), 'sk-first-account-private');
  assert.equal((await restored.backend.getSettings()).provider, 'codex');
});

test('credentials use unique scrypt salts and neither passwords nor derived secrets reach public state', async (t) => {
  const { manager, directory } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  const second = await manager.createAccount(accountInput('bob'));
  const serialized = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8');
  assert.ok(!serialized.includes('test-password-123'));
  const stored = JSON.parse(serialized);
  assert.equal(stored.accounts[0].credential.algorithm, 'scrypt-v1');
  assert.notEqual(stored.accounts[0].credential.salt, stored.accounts[1].credential.salt);
  assert.notEqual(stored.accounts[0].credential.hash, stored.accounts[1].credential.hash);
  for (const state of [first, second, manager.getState(), await manager.logout()]) {
    const text = JSON.stringify(state);
    for (const secret of ['test-password-123', 'credential', 'salt', 'hash', ...stored.accounts.flatMap((entry) => [entry.credential.salt, entry.credential.hash])]) assert.ok(!text.includes(secret));
    assert.deepEqual(Object.keys(state.accounts[0]).sort(), ['grade', 'id', 'name', 'username']);
  }
});

test('validates password length, normalized unique usernames and profile details', async (t) => {
  const { manager } = await fixture(t);
  for (const password of ['short', '', '      ', null, 'x'.repeat(257)]) await assert.rejects(manager.createAccount(accountInput('alice', { password })), /密码/);
  await assert.rejects(manager.createAccount(accountInput('../escape')), /账号名/);
  for (const grade of [0, 13, 10.5, true, null]) await assert.rejects(manager.createAccount(accountInput('alice', { grade })), /年级/);
  await assert.rejects(manager.createAccount(accountInput('alice', { name: 'x'.repeat(41) })), /昵称/);
  const first = await manager.createAccount(accountInput('Alice'));
  await assert.rejects(manager.createAccount(accountInput(' ＡＬＩＣＥ ')), /已存在/);
  assert.equal(manager.getState().accounts.length, 1);
  assert.equal(manager.getState().sessionToken, first.sessionToken);
});

test('high school accounts retain grades and study profiles through creation, updates, restart and login', async (t) => {
  const { manager, createManager } = await fixture(t);
  const created = [];
  for (const grade of [10, 11, 12]) {
    const state = await manager.createAccount(accountInput(`student${grade}`, { grade }));
    created.push(state.activeAccount);
    assert.equal(manager.requireSession(state.sessionToken).account.grade, grade);
    assert.equal((await manager.requireSession(state.sessionToken).backend.getStudyData()).profile.grade, grade);
  }
  await manager.dispose();
  const restarted = createManager();
  assert.deepEqual((await restarted.initialize()).accounts, created);
  for (const account of created) {
    const state = await restarted.login({ accountId: account.id, password: 'test-password-123' });
    assert.equal(state.activeAccount.grade, account.grade);
    assert.equal((await restarted.requireSession(state.sessionToken).backend.getStudyData()).profile.grade, account.grade);
  }
  const state = await restarted.login({ accountId: created[0].id, password: 'test-password-123' });
  const backend = restarted.requireSession(state.sessionToken).backend;
  const study = await backend.getStudyData();
  const profile = { name: '升入高三', grade: 12 };
  await backend.saveStudyData({ ...study, profile });
  const updated = await restarted.updateProfile(state.sessionToken, profile);
  assert.equal(updated.activeAccount.grade, 12);
  await restarted.dispose();
  const again = createManager();
  const loggedIn = await again.login({ accountId: created[0].id, password: 'test-password-123' });
  assert.equal(loggedIn.activeAccount.grade, 12);
  assert.deepEqual((await again.requireSession(loggedIn.sessionToken).backend.getStudyData()).profile, profile);
});

test('failed passwords preserve the active session; every login rotates tokens and logout revokes access', async (t) => {
  const { manager } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  assert.throws(() => manager.requireSession(undefined), UserError);
  assert.throws(() => manager.requireSession('guess'), /登录状态/);
  await assert.rejects(manager.login({ accountId: first.activeAccount.id, password: 'wrong-password' }), /密码不正确/);
  assert.equal(manager.getState().sessionToken, first.sessionToken);
  assert.equal(manager.requireSession(first.sessionToken).account.username, 'alice');
  const second = await manager.login({ accountId: first.activeAccount.id, password: 'test-password-123' });
  assert.notEqual(second.sessionToken, first.sessionToken);
  assert.throws(() => manager.requireSession(first.sessionToken), /登录状态/);
  const logout = await manager.logout();
  assert.equal(logout.activeAccount, null);
  assert.equal(logout.sessionToken, null);
  assert.throws(() => manager.requireSession(second.sessionToken), /登录状态/);
});

test('initialization and concurrent account creation serialize without overwriting another account', async (t) => {
  const { manager, directory } = await fixture(t);
  const results = await Promise.all([manager.initialize(), manager.createAccount(accountInput('alice')), manager.createAccount(accountInput('bob')), manager.initialize()]);
  assert.equal(results.at(-1).accounts.length, 2);
  assert.equal(manager.getState().activeAccount.username, 'bob');
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')).accounts.length, 2);
  const duplicate = await Promise.allSettled([manager.createAccount(accountInput('carol')), manager.createAccount(accountInput('CAROL'))]);
  assert.deepEqual(duplicate.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.equal(manager.getState().accounts.length, 3);
});

test('legacy study, settings and service credentials migrate only to the first account, preserving originals', async (t) => {
  const { manager, directory, safeStorage, createManager } = await fixture(t);
  const study = { profile: { name: '旧昵称', grade: 7 }, mistakes: [{ id: 'legacy-mistake' }], sessions: [{ id: 'legacy-session' }], activity: [{ date: '2026-10-17' }] };
  const originals = {
    'study.json': Buffer.from(JSON.stringify(study)),
    'settings.json': Buffer.from(JSON.stringify({ provider: 'codex', codexModel: 'saved-model' })),
    'deepseek-key.bin': safeStorage.encryptString('sk-legacy-secret'),
    [path.join('codex', 'auth.json')]: Buffer.from('{"private":"legacy-auth-value"}'),
  };
  for (const [file, bytes] of Object.entries(originals)) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), bytes);
  }
  assert.equal((await manager.initialize()).hasLegacyData, true);
  const first = await manager.createAccount(accountInput('alice', { name: '新昵称', grade: 8 }));
  assert.equal(first.migratedLegacyData, true);
  assert.equal(first.hasLegacyData, false);
  const firstBackend = manager.requireSession(first.sessionToken).backend;
  const migrated = await firstBackend.getStudyData();
  assert.deepEqual(migrated.profile, { name: '新昵称', grade: 8 });
  for (const key of ['mistakes', 'sessions', 'activity']) assert.deepEqual(migrated[key], study[key]);
  assert.equal(await firstBackend.readKey(), 'sk-legacy-secret');
  assert.equal((await firstBackend.getSettings()).codexModel, 'saved-model');
  const second = await manager.createAccount(accountInput('bob'));
  assert.equal(second.migratedLegacyData, false);
  assert.deepEqual((await manager.requireSession(second.sessionToken).backend.getStudyData()).mistakes, []);
  assert.equal((await manager.requireSession(second.sessionToken).backend.getSettings()).hasDeepseekKey, false);
  for (const [file, bytes] of Object.entries(originals)) assert.deepEqual(await fs.readFile(path.join(directory, file)), bytes);
  await manager.dispose();
  const restarted = createManager();
  assert.equal((await restarted.initialize()).hasLegacyData, false);
  const third = await restarted.createAccount(accountInput('carol'));
  assert.equal(third.migratedLegacyData, false);
  assert.equal((await restarted.requireSession(third.sessionToken).backend.getSettings()).hasDeepseekKey, false);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')).legacyMigration.accountId, first.activeAccount.id);
});

test('accounts survive restart, require a password again and do not persist live session tokens', async (t) => {
  const { manager, directory, createManager } = await fixture(t);
  const original = await manager.createAccount(accountInput('alice'));
  await manager.dispose();
  assert.throws(() => manager.requireSession(original.sessionToken), /登录状态/);
  const restarted = createManager();
  const state = await restarted.initialize();
  assert.equal(state.activeAccount, null);
  assert.equal(state.sessionToken, null);
  assert.deepEqual(state.accounts, original.accounts);
  assert.ok(!(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8')).includes(original.sessionToken));
  const restored = await restarted.login({ accountId: original.activeAccount.id, password: 'test-password-123' });
  assert.notEqual(restored.sessionToken, original.sessionToken);
  assert.deepEqual((await restarted.requireSession(restored.sessionToken).backend.getStudyData()).profile, { name: 'alice同学', grade: 5 });
});

test('switching cancels the old backend and waits for its pending writes before authorizing the new session', async (t) => {
  const { manager } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  const second = await manager.createAccount(accountInput('bob'));
  const previous = manager.requireSession(second.sessionToken).backend;
  let finishWrite;
  let disposed;
  previous.writeChain = new Promise((resolve) => { finishWrite = resolve; });
  const closed = new Promise((resolve) => { disposed = resolve; });
  const dispose = previous.dispose.bind(previous);
  previous.dispose = () => { dispose(); disposed(); };
  let completed = false;
  const switching = manager.login({ accountId: first.activeAccount.id, password: 'test-password-123' }).then((state) => { completed = true; return state; });
  await closed;
  assert.equal(completed, false);
  assert.equal(manager.getState().activeAccount, null);
  assert.throws(() => manager.requireSession(second.sessionToken), /登录状态/);
  finishWrite();
  const state = await switching;
  assert.equal(state.activeAccount.id, first.activeAccount.id);
});

test('failed backend initialization leaves the active account and its data intact', async (t) => {
  const { manager, directory, createBackend } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  const before = await fs.readFile(path.join(directory, 'accounts.json'), 'utf8');
  manager.createBackend = (profileDirectory) => {
    const backend = createBackend(profileDirectory);
    backend.initialize = async () => { throw new Error('private diagnostic must not leak'); };
    return backend;
  };
  await assert.rejects(manager.createAccount(accountInput('bob')), (error) => error instanceof UserError && !error.message.includes('private diagnostic'));
  assert.equal(manager.getState().sessionToken, first.sessionToken);
  assert.equal(manager.requireSession(first.sessionToken).account.username, 'alice');
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), before);
  assert.deepEqual(await fs.readdir(path.join(directory, 'profiles')), [first.activeAccount.id]);
});

test('malformed legacy study is preserved and failed migration can safely be retried', async (t) => {
  const { manager, directory } = await fixture(t);
  await fs.writeFile(path.join(directory, 'study.json'), '{broken-json');
  await manager.initialize();
  await assert.rejects(manager.createAccount(accountInput('alice')), /本地数据无法读取/);
  assert.equal(await fs.readFile(path.join(directory, 'study.json'), 'utf8'), '{broken-json');
  assert.deepEqual(await fs.readdir(path.join(directory, 'profiles')), []);
  assert.equal(manager.getState().hasLegacyData, true);
  await assert.rejects(fs.access(path.join(directory, 'accounts.json')), { code: 'ENOENT' });
  await fs.writeFile(path.join(directory, 'study.json'), JSON.stringify({ profile: { name: '旧资料', grade: 2 }, mistakes: [], sessions: [], activity: [] }));
  assert.equal((await manager.createAccount(accountInput('alice'))).migratedLegacyData, true);
});

test('malformed registry and injected profile paths fail closed without modifying stored data', async (t) => {
  const { manager, directory, createManager } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  for (const accountId of ['../outside', '..\\outside', 'C:\\outside', '', null]) await assert.rejects(manager.login({ accountId, password: 'test-password-123' }), /学习账号/);
  assert.equal(manager.getState().sessionToken, first.sessionToken);
  await manager.dispose();
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'));
  stored.accounts[0].id = '../outside';
  const invalid = JSON.stringify(stored);
  await fs.writeFile(path.join(directory, 'accounts.json'), invalid);
  await assert.rejects(createManager().initialize(), /档案编号/);
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), invalid);
  await fs.writeFile(path.join(directory, 'accounts.json'), '{broken');
  await assert.rejects(createManager().initialize(), /账号档案无法读取/);
  assert.equal(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'), '{broken');
});

test('public account snapshots cannot mutate private registry or active account', async (t) => {
  const { manager } = await fixture(t);
  const state = await manager.createAccount(accountInput('alice'));
  state.accounts[0].username = 'tampered';
  state.activeAccount.id = '../escape';
  const session = manager.requireSession(state.sessionToken);
  session.account.name = 'tampered';
  assert.equal(manager.getState().accounts[0].username, 'alice');
  assert.equal(manager.getState().activeAccount.name, 'alice同学');
});

test('profile updates persist the current login card without changing credentials, tokens or other students', async (t) => {
  const { manager, directory, createManager } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  const second = await manager.createAccount(accountInput('bob'));
  const before = JSON.parse(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'));
  const updated = await manager.updateProfile(second.sessionToken, { name: '小明', grade: 8 });
  assert.equal(updated.sessionToken, second.sessionToken);
  assert.deepEqual(updated.accounts[0], first.accounts[0]);
  assert.equal(updated.activeAccount.name, '小明');
  assert.equal(updated.activeAccount.grade, 8);
  assert.equal(manager.requireSession(second.sessionToken).account.name, '小明');
  const after = JSON.parse(await fs.readFile(path.join(directory, 'accounts.json'), 'utf8'));
  assert.deepEqual(after.accounts[1].credential, before.accounts[1].credential);
  assert.deepEqual(after.legacyMigration, before.legacyMigration);
  await manager.dispose();
  const restarted = createManager();
  const state = await restarted.initialize();
  assert.equal(state.accounts[1].name, '小明');
  assert.equal(state.accounts[1].grade, 8);
  assert.equal((await restarted.login({ accountId: second.activeAccount.id, password: 'test-password-123' })).activeAccount.name, '小明');
});

test('profile updates queued behind a login reject the old token and cannot change the next student', async (t) => {
  const { manager } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  const second = await manager.createAccount(accountInput('bob'));
  const results = await Promise.allSettled([
    manager.login({ accountId: first.activeAccount.id, password: 'test-password-123' }),
    manager.updateProfile(second.sessionToken, { name: '不应写入', grade: 9 }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /登录状态/);
  assert.equal(manager.getState().activeAccount.name, 'alice同学');
  assert.equal(manager.getState().accounts[1].name, 'bob同学');
  const token = manager.getState().sessionToken;
  await assert.rejects(manager.updateProfile(token, { name: '', grade: 8 }), /昵称/);
  await assert.rejects(manager.updateProfile(token, { name: '小明', grade: 0 }), /年级/);
  assert.equal(manager.getState().activeAccount.name, 'alice同学');
});

test('logout queued with an old token cannot terminate a subsequent login', async (t) => {
  const { manager } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  const second = await manager.createAccount(accountInput('bob'));
  const results = await Promise.allSettled([
    manager.login({ accountId: first.activeAccount.id, password: 'test-password-123' }),
    manager.logout(second.sessionToken),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /登录状态/);
  assert.equal(manager.getState().activeAccount.id, first.activeAccount.id);
  const currentToken = manager.getState().sessionToken;
  assert.equal((await manager.logout(currentToken)).activeAccount, null);
  assert.throws(() => manager.requireSession(currentToken), /登录状态/);
});

test('registry write failures preserve active account metadata and do not leave unregistered profile copies', async (t) => {
  const { manager, directory } = await fixture(t);
  const first = await manager.createAccount(accountInput('alice'));
  const registryPath = manager.accountsFile;
  const before = await fs.readFile(registryPath, 'utf8');
  const blocker = path.join(directory, 'not-a-directory');
  await fs.writeFile(blocker, 'fixture');
  manager.accountsFile = path.join(blocker, 'accounts.json');
  await assert.rejects(manager.updateProfile(first.sessionToken, { name: '无法保存', grade: 8 }), UserError);
  assert.equal(manager.getState().activeAccount.name, 'alice同学');
  await assert.rejects(manager.createAccount(accountInput('bob')), UserError);
  assert.equal(manager.getState().sessionToken, first.sessionToken);
  assert.equal(await fs.readFile(registryPath, 'utf8'), before);
  assert.deepEqual(await fs.readdir(path.join(directory, 'profiles')), [first.activeAccount.id]);
  manager.accountsFile = registryPath;
  assert.equal((await manager.updateProfile(first.sessionToken, { name: '成功保存', grade: 8 })).activeAccount.name, '成功保存');
});

test('first-account registry write failure does not consume or remove legacy files', async (t) => {
  const { manager, directory } = await fixture(t);
  const oldStudy = JSON.stringify({ profile: { name: '旧资料', grade: 3 }, mistakes: [{ id: 'preserved' }], sessions: [], activity: [] });
  await fs.writeFile(path.join(directory, 'study.json'), oldStudy);
  await manager.initialize();
  const registryPath = manager.accountsFile;
  const blocker = path.join(directory, 'not-a-directory');
  await fs.writeFile(blocker, 'fixture');
  manager.accountsFile = path.join(blocker, 'accounts.json');
  await assert.rejects(manager.createAccount(accountInput('alice')), UserError);
  assert.equal(await fs.readFile(path.join(directory, 'study.json'), 'utf8'), oldStudy);
  assert.equal(manager.getState().hasLegacyData, true);
  assert.deepEqual(await fs.readdir(path.join(directory, 'profiles')), []);
  manager.accountsFile = registryPath;
  const created = await manager.createAccount(accountInput('alice'));
  assert.equal(created.migratedLegacyData, true);
  assert.equal((await manager.requireSession(created.sessionToken).backend.getStudyData()).mistakes[0].id, 'preserved');
});
