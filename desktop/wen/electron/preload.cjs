'use strict';
const { contextBridge, ipcRenderer } = require('electron');

let sessionToken = null;
const invoke = (channel, input) => {
  const token = sessionToken;
  return ipcRenderer.invoke(channel, { sessionToken: token, input }).then((result) => {
  if (token !== sessionToken) throw new Error('学习账号已切换，请重试。');
  if (!result?.ok) throw new Error(result?.error || '操作未完成，请重试。');
  return result.value;
  });
};
const accountAction = async (channel, input) => {
  const state = await invoke(channel, input);
  sessionToken = state.sessionToken;
  return state;
};

contextBridge.exposeInMainWorld('wen', Object.freeze({
  getAccountState: () => accountAction('wen:get-account-state'),
  createAccount: input => accountAction('wen:create-account', input),
  loginAccount: input => accountAction('wen:login-account', input),
  logoutAccount: () => accountAction('wen:logout-account'),
  getSettings: () => invoke('wen:get-settings'),
  saveSettings: (settings) => invoke('wen:save-settings', settings),
  testConnection: () => invoke('wen:test-connection'),
  codexLogin: () => invoke('wen:codex-login'),
  codexLogout: () => invoke('wen:codex-logout'),
  ask: (request) => invoke('wen:ask', request),
  cancel: (requestId) => invoke('wen:cancel', requestId),
  getStudyData: () => invoke('wen:get-study-data'),
  saveStudyData: (data) => invoke('wen:save-study-data', data),
  exportStudyData: () => invoke('wen:export-study-data'),
  listExams: () => invoke('wen:list-exams'),
  importExam: input => invoke('wen:import-exam', input),
  openExamFile: input => invoke('wen:open-exam-file', input),
  analyzeExam: input => invoke('wen:analyze-exam', input),
  onStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('状态回调必须为函数。');
    const listener = (_event, data) => { if (data.sessionToken === sessionToken) callback(data); };
    ipcRenderer.on('wen:status', listener);
    return () => ipcRenderer.removeListener('wen:status', listener);
  },
}));
