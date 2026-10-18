'use strict';

const { app, BrowserWindow, ipcMain, Menu, dialog, safeStorage, shell, session, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { LearningBackend, UserError } = require('./backend.cjs');
const { AccountManager } = require('./accounts.cjs');
const { ExamStore, validateMetadata } = require('./exams.cjs');

app.setName('温习');
app.setAppUserModelId('cn.wenxi.learning');
const explicitUserData = app.commandLine.getSwitchValue('user-data-dir');
if (explicitUserData && path.isAbsolute(explicitUserData)) {
  fs.mkdirSync(explicitUserData, { recursive: true });
  app.setPath('userData', path.resolve(explicitUserData));
}
let mainWindow;
let accounts;
const examStores = new WeakMap();
const entryPath = path.join(__dirname, '..', 'dist', 'index.html');
const devUrl = !app.isPackaged && process.env.WEN_DEV_URL === 'http://127.0.0.1:5173' ? process.env.WEN_DEV_URL : null;
const expectedUrl = devUrl || pathToFileURL(entryPath).href;

function trustedFrame(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  const actual = event.senderFrame.url.split('#')[0];
  return devUrl ? actual === devUrl || actual === `${devUrl}/` : actual === expectedUrl;
}

function examsFor(current) {
  if (!examStores.has(current.backend)) examStores.set(current.backend, new ExamStore({ directory: current.directory, backend: current.backend }));
  return examStores.get(current.backend);
}

async function exportStudyData(token = accounts?.getState().sessionToken) {
  const current = accounts.requireSession(token);
  const selected = await dialog.showSaveDialog(mainWindow, { title: '导出温习学习记录', defaultPath: path.join(app.getPath('documents'), `温习学习记录-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: '学习记录 JSON', extensions: ['json'] }] });
  if (selected.canceled || !selected.filePath) return { ok: false };
  accounts.requireSession(token);
  const study = await current.backend.getStudyData();
  const exams = await examsFor(current).list();
  accounts.requireSession(token);
  const { atomicWrite } = require('./backend.cjs');
  await atomicWrite(selected.filePath, JSON.stringify({ app: '温习', version: 2, exportedAt: new Date().toISOString(), ...study, exams, note: '本文件包含试卷目录与讲解；JPG/PDF 原件仍保存在本机账号档案中。' }, null, 2));
  return { ok: true, path: selected.filePath };
}

function registerHandlers() {
  const actions = {
    'wen:get-settings': current => current.backend.getSettings(),
    'wen:save-settings': (current, input) => current.backend.saveSettings(input),
    'wen:test-connection': current => current.backend.testConnection(),
    'wen:codex-login': current => current.backend.codexLogin(),
    'wen:codex-logout': current => current.backend.codexLogout(),
    // Renderer inputs cannot introduce arbitrary local file attachments.
    'wen:ask': (current, input) => current.backend.ask({ ...input, images: undefined }),
    'wen:cancel': (current, requestId) => current.backend.cancel(requestId),
    'wen:get-study-data': current => current.backend.getStudyData(),
    'wen:save-study-data': async (current, data, token) => {
      const saved = await current.backend.saveStudyData(data);
      await accounts.updateProfile(token, saved.profile);
      return saved;
    },
    'wen:export-study-data': (_current, _input, token) => exportStudyData(token),
    'wen:list-exams': current => examsFor(current).list(),
    'wen:import-exam': async (current, input, token) => {
      const metadata = validateMetadata(input);
      const selection = await dialog.showOpenDialog(mainWindow, { title: '选择试卷 JPG、PNG 或 PDF（按文件名顺序归档）', properties: ['openFile', 'multiSelections'], filters: [{ name: '试卷图片和 PDF', extensions: ['jpg', 'jpeg', 'png', 'pdf'] }] });
      accounts.requireSession(token);
      if (selection.canceled || !selection.filePaths.length) return { canceled: true };
      return examsFor(current).importFiles(metadata, selection.filePaths.sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN', { numeric: true })));
    },
    'wen:open-exam-file': async (current, input, token) => {
      const file = await examsFor(current).originalFile(input);
      accounts.requireSession(token);
      const error = await shell.openPath(file);
      if (error) throw new UserError('无法打开试卷原件，请确认系统中已安装图片或 PDF 查看程序。');
      return { ok: true };
    },
    'wen:analyze-exam': (current, input, token) => examsFor(current).analyze(input, () => accounts.requireSession(token)),
  };
  for (const [channel, action] of Object.entries(actions)) ipcMain.handle(channel, async (event, envelope) => {
    if (!trustedFrame(event)) return { ok: false, error: '此操作来源不受信任。' };
    try {
      const current = accounts.requireSession(envelope?.sessionToken);
      const value = await action(current, envelope?.input, envelope.sessionToken);
      accounts.requireSession(envelope.sessionToken);
      return { ok: true, value };
    }
    catch (error) { return { ok: false, error: error instanceof UserError ? error.message : '操作未完成，请检查本机存储空间后重试。' }; }
  });
  for (const [channel, action] of Object.entries({
    'wen:get-account-state': () => accounts.getState(),
    'wen:create-account': input => accounts.createAccount(input),
    'wen:login-account': input => accounts.login(input),
    'wen:logout-account': (_input, token) => accounts.logout(token),
  })) ipcMain.handle(channel, async (event, envelope) => {
    if (!trustedFrame(event)) return { ok: false, error: '此操作来源不受信任。' };
    try { return { ok: true, value: await action(envelope?.input, envelope?.sessionToken) }; }
    catch (error) { return { ok: false, error: error instanceof UserError ? error.message : '账号操作未完成，请重试。' }; }
  });
}

function codexBinary() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'codex', 'bin', 'codex.exe');
  const candidates = [
    path.join(__dirname, '..', 'vendor', 'codex', 'bin', 'codex.exe'),
    path.join(__dirname, '..', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320, height: 900, minWidth: 1000, minHeight: 720,
    title: '温习 · 每一点进步，都值得温习', backgroundColor: '#F7F8F6',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' && target.hostname === 'platform.deepseek.com' && !target.username && !target.password) {
        shell.openExternal(target.href).catch(() => {});
      }
    } catch { /* Invalid and non-allowlisted URLs stay inside the deny boundary. */ }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { void accounts?.dispose(); mainWindow = null; });
  if (devUrl) mainWindow.loadURL(devUrl); else mainWindow.loadFile(entryPath);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    accounts = new AccountManager({ userData: app.getPath('userData'), createBackend: directory => {
      const scopedBackend = new LearningBackend({
      userData: directory, safeStorage, codexPath: codexBinary(),
      fetchImpl: (url, options) => net.fetch(url, options),
      resolveProxy: url => session.defaultSession.resolveProxy(url),
      onStatus: message => {
        const state = accounts.getState();
        if (state.activeAccount && accounts.requireSession(state.sessionToken).backend === scopedBackend && mainWindow && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('wen:status', { ...message, sessionToken: state.sessionToken });
      },
      });
      return scopedBackend;
    } });
    await accounts.initialize();
    registerHandlers();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '温习', submenu: [{ label: '导出学习记录', click: async () => { try { await exportStudyData(); } catch { dialog.showErrorBox('导出未完成', '请检查文件保存位置和本机存储空间后重试。'); } } }, { type: 'separator' }, { role: 'quit', label: '退出温习' }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '视图', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
    ]));
    createWindow();
  }).catch(() => { dialog.showErrorBox('温习启动失败', '无法初始化本地学习数据，请检查磁盘空间和文件访问权限。'); app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && accounts) createWindow(); });
  app.on('window-all-closed', () => { void accounts?.dispose(); app.quit(); });
  let shuttingDown = false;
  app.on('before-quit', event => {
    if (shuttingDown || !accounts) return;
    event.preventDefault(); shuttingDown = true;
    accounts.dispose().finally(() => app.quit());
  });
}
