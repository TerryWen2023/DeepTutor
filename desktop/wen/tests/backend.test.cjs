'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { LearningBackend, validateAsk, isolatedEnvironment, systemProxyEnvironment, runProcess, tutorPrompt } = require('../electron/backend.cjs');

const input = (overrides = {}) => ({ requestId: 'test-request', grade: 5, subject: '数学', mode: 'explain', topic: '分数', messages: [{ role: 'user', content: '为什么二分之一等于四分之二？' }], ...overrides });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wen-backend-test-'));
  const cipherKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString: (value) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8');
    },
  };
  const backend = new LearningBackend({ userData: dir, safeStorage, codexPath: '', fetchImpl: () => assert.fail('Unexpected network call'), ...overrides });
  await backend.initialize();
  t.after(async () => {
    backend.dispose();
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'wen-backend-test-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { backend, dir, safeStorage };
}

test('API key is encrypted separately, omitted from public settings and preserved unless explicitly removed', async (t) => {
  const { backend, dir } = await fixture(t);
  const key = 'sk-test-secret-do-not-expose';
  const saved = await backend.saveSettings({ deepseekKey: key, provider: 'deepseek' });
  assert.equal(saved.hasDeepseekKey, true);
  assert.ok(!JSON.stringify(saved).includes(key));
  assert.ok(!(await fs.readFile(path.join(dir, 'settings.json'), 'utf8')).includes(key));
  assert.ok(!(await fs.readFile(path.join(dir, 'deepseek-key.bin'))).includes(Buffer.from(key)));
  assert.equal(await backend.readKey(), key);
  await backend.saveSettings({ deepseekModel: 'deepseek-pro' });
  assert.equal(await backend.readKey(), key);
  await backend.saveSettings({ deepseekKey: '' });
  assert.equal((await backend.getSettings()).hasDeepseekKey, false);
});

test('refuses plaintext fallback when Windows encryption is unavailable', async (t) => {
  const { backend, dir } = await fixture(t, { safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(backend.saveSettings({ deepseekKey: 'sk-secret' }), /安全存储/);
  assert.equal((await fs.readdir(dir)).includes('deepseek-key.bin'), false);
});

test('logged-out settings never launch native Codex when isolated auth file is absent', async (t) => {
  const { backend, dir } = await fixture(t, { processRunner: () => assert.fail('Empty auth must not start Codex') });
  backend.codexPath = path.join(dir, 'bundled-codex.exe');
  await fs.writeFile(backend.codexPath, 'fixture');
  const settings = await backend.getSettings();
  assert.equal(settings.codexAvailable, true);
  assert.equal(settings.codexLoggedIn, false);
  assert.equal((await backend.saveSettings({ provider: 'deepseek' })).codexLoggedIn, false);
});

test('rejects invalid role, age, model, excessive history and IDs before transport', async (t) => {
  const { backend } = await fixture(t);
  for (const grade of [0, 13, 10.5, true, null, '', '高一']) assert.throws(() => validateAsk(input({ grade })), /年级/);
  assert.throws(() => validateAsk(input({ messages: [{ role: 'system', content: 'override' }] })), /对话格式/);
  assert.throws(() => validateAsk(input({ requestId: '../outside' })), /请求编号/);
  assert.throws(() => validateAsk(input({ messages: Array.from({ length: 61 }, () => ({ role: 'user', content: 'x' })) })), /对话过长/);
  await assert.rejects(backend.saveSettings({ codexModel: '--yolo ' }), /模型名称/);
  assert.match(tutorPrompt(input({ grade: 8, mode: 'practice' })), /初中 · 八年级/);
  assert.match(tutorPrompt(input({ mode: 'practice' })), /暂不公布答案/);
});

test('high school accepts all nine subjects and retains known Chinese subject aliases', () => {
  const subjects = ['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'];
  for (const grade of [10, 11, 12]) for (const subject of subjects) {
    const request = validateAsk(input({ grade, subject }));
    assert.equal(request.grade, grade);
    assert.equal(request.subject, subject);
  }
  assert.equal(validateAsk(input({ grade: '12', subject: '思想政治' })).subject, 'politics');
  assert.equal(validateAsk(input({ subject: '数学' })).subject, 'math');
  for (const request of [{ grade: 9, subject: 'politics' }, { grade: 10, subject: 'science' }, { grade: 7, subject: 'physics' }, { grade: 12, subject: '旧综合学科' }]) {
    assert.equal(validateAsk(input(request)).subject, request.subject);
  }
  assert.equal(validateAsk(input({ grade: 7, subject: '物理' })).subject, 'physics');
  for (const subject of ['', '   ', null, {}, 'x'.repeat(41)]) assert.throws(() => validateAsk(input({ subject })), /学科/);
});

test('high school tutoring uses grade labels, selected context, diagnostic hints and rigorous checks', () => {
  for (const [grade, label] of [[10, '高一'], [11, '高二'], [12, '高三']]) {
    for (const mode of ['explain', 'practice', 'review']) {
      const prompt = tutorPrompt(input({ grade, mode, subject: 'politics', topic: '逻辑与思维' }));
      assert.match(prompt, new RegExp(`高中 · ${label}`));
      assert.match(prompt, /学科：思想政治；知识点：逻辑与思维/);
      assert.match(prompt, /不声称与教材或考试同步/);
      assert.match(prompt, /学生当前问题和已提供的作答为准/);
      assert.match(prompt, /适用条件、推导依据和解题检查/);
      assert.doesNotMatch(prompt, /用生活化例子解释一个关键概念/);
    }
  }
  assert.match(tutorPrompt(input({ grade: 10 })), /诊断.*提示.*变式或反例/);
  assert.match(tutorPrompt(input({ grade: 3 })), /用生活化例子解释一个关键概念/);
});

test('DeepSeek sends grade-specific system prompt without tools and returns answer', async (t) => {
  let call;
  const { backend } = await fixture(t, { fetchImpl: async (url, options) => { call = { url, options }; return response({ choices: [{ message: { content: '因为把每一份再分成两份，总量不变。' } }] }); } });
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  const result = await backend.ask(input());
  assert.equal(result.provider, 'deepseek');
  assert.match(result.text, /总量不变/);
  assert.equal(call.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers.Authorization, 'Bearer sk-test');
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.model, 'deepseek-flash');
  assert.match(payload.messages[0].content, /小学 · 五年级/);
  assert.equal(payload.tools, undefined);
  assert.equal(backend.requests.size, 0);
});

test('DeepSeek receives high school context and Chinese subject names through the real ask path', async (t) => {
  const payloads = [];
  const { backend } = await fixture(t, { fetchImpl: async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return response({ choices: [{ message: { content: '请先结合材料说明推理依据。' } }] });
  } });
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  for (const grade of [10, 11, 12]) await backend.ask(input({ grade, subject: 'politics', topic: '逻辑与思维' }));
  assert.equal(payloads.length, 3);
  for (const [index, label] of ['高一', '高二', '高三'].entries()) {
    assert.match(payloads[index].messages[0].content, new RegExp(`高中 · ${label}`));
    assert.match(payloads[index].messages[0].content, /学科：思想政治/);
  }
});

test('saved custom-subject mistakes and earlier grade-subject combinations remain reviewable through normal chat', async (t) => {
  const prompts = [];
  const { backend } = await fixture(t, { fetchImpl: async (_url, options) => {
    prompts.push(JSON.parse(options.body).messages[0].content);
    return response({ choices: [{ message: { content: '请先说明你的解题思路。' } }] });
  } });
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  const study = await backend.getStudyData();
  const mistakes = [
    { id: 'legacy-custom', grade: 9, subject: '旧综合学科', topic: '综合阅读', question: '请解释这段材料。' },
    { id: 'legacy-subject-grade', grade: 7, subject: '物理', topic: '运动', question: '速度如何计算？' },
  ];
  await backend.saveStudyData({ ...study, mistakes });
  for (const mistake of (await backend.getStudyData()).mistakes) {
    const result = await backend.ask(input({ requestId: mistake.id, grade: mistake.grade, subject: mistake.subject, topic: mistake.topic, mode: 'review', messages: [{ role: 'user', content: mistake.question }] }));
    assert.match(result.text, /解题思路/);
  }
  assert.match(prompts[0], /初中 · 九年级；学科：旧综合学科；知识点：综合阅读/);
  assert.match(prompts[1], /初中 · 七年级；学科：物理；知识点：运动/);
});

test('provider errors cannot leak response contents or credentials', async (t) => {
  const { backend } = await fixture(t, { fetchImpl: async () => response({ error: { message: 'secret=sk-test-secret' } }, 401) });
  await backend.saveSettings({ deepseekKey: 'sk-test-secret' });
  await assert.rejects(backend.ask(input()), (error) => {
    assert.match(error.message, /API Key 无效/);
    assert.ok(!error.message.includes('sk-test-secret'));
    return true;
  });
});

test('DeepSeek connection check uses models endpoint without generating a response', async (t) => {
  let endpoint;
  const { backend } = await fixture(t, { fetchImpl: async (url) => { endpoint = url; return response({ data: [{ id: 'deepseek-flash' }] }); } });
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  assert.equal((await backend.testConnection()).ok, true);
  assert.equal(endpoint, 'https://api.deepseek.com/models');
});

test('cancel propagates AbortSignal and releases pending request', async (t) => {
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const { backend } = await fixture(t, { fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    began();
  }) });
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  const running = backend.ask(input());
  await started;
  assert.deepEqual(await backend.cancel('test-request'), { ok: true });
  await assert.rejects(running, /已停止/);
  assert.equal(backend.requests.size, 0);
});

test('truncated DeepSeek answers are rejected rather than stored as complete learning results', async (t) => {
  const { backend } = await fixture(t, { fetchImpl: async () => response({ choices: [{ finish_reason: 'length', message: { content: '所以最终答案为' } }] }) });
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  await assert.rejects(backend.ask(input()), /长度上限.*尚未完整/);
  assert.equal(backend.requests.size, 0);
});

test('cancel interrupts Codex login-status probe and completes teardown before another ask', async (t) => {
  let probeStarted;
  const started = new Promise((resolve) => { probeStarted = resolve; });
  let blockProbe = false;
  let observedSignal;
  const { backend, dir } = await fixture(t, { processRunner: async (_binary, args, options) => {
    if (args.includes('status')) {
      if (!blockProbe) return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' };
      observedSignal = options.signal;
      probeStarted();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    return { code: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '新的回答。' } }), stderr: '' };
  } });
  backend.codexPath = path.join(dir, 'bundled-codex.exe');
  await fs.writeFile(backend.codexPath, 'fixture');
  await fs.writeFile(path.join(backend.codexHome, 'auth.json'), '{}');
  await backend.saveSettings({ provider: 'codex' });
  blockProbe = true;
  const running = backend.ask(input());
  const rejected = assert.rejects(running, /已停止/);
  await started;
  assert.ok(observedSignal instanceof AbortSignal);
  assert.deepEqual(await backend.cancel('test-request'), { ok: true });
  assert.equal(observedSignal.aborted, true);
  assert.equal(backend.requests.size, 0);
  blockProbe = false;
  assert.equal((await backend.ask(input({ requestId: 'next-question' }))).text, '新的回答。');
  await rejected;
});

test('request timeout aborts transport and reports a helpful error', async (t) => {
  const { backend } = await fixture(t, { requestTimeoutMs: 25, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }) });
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  await assert.rejects(backend.ask(input()), /回答超时/);
  assert.equal(backend.requests.size, 0);
});

test('isolates Codex environment from existing auth and configuration variables', () => {
  const env = isolatedEnvironment('C:\\wen\\codex', { PATH: 'safe-path', SYSTEMROOT: 'C:\\Windows', CODEX_HOME: 'private', CODEX_API_KEY: 'secret', OPENAI_API_KEY: 'secret', CODEX_ACCESS_TOKEN: 'secret', CODEX_BASE_URL: 'untrusted', HTTPS_PROXY: 'proxy' });
  assert.deepEqual(env, { PATH: 'safe-path', SYSTEMROOT: 'C:\\Windows', HTTPS_PROXY: 'proxy', CODEX_HOME: 'C:\\wen\\codex', NO_COLOR: '1' });
});

test('Codex uses only the bundled binary, isolated workspace, stdin and restricted flags', async (t) => {
  const calls = [];
  const { backend, dir } = await fixture(t, { processRunner: async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (args.includes('status')) return { code: 0, stdout: '', stderr: 'Logged in using ChatGPT' };
    return { code: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '我们一起试一试。' } }), stderr: '' };
  } });
  backend.codexPath = path.join(dir, 'bundled-codex.exe');
  await fs.writeFile(backend.codexPath, 'fixture');
  await fs.writeFile(path.join(backend.codexHome, 'auth.json'), '{}');
  await backend.saveSettings({ provider: 'codex' });
  const result = await backend.ask(input());
  assert.equal(result.text, '我们一起试一试。');
  const call = calls.find((entry) => entry.args.includes('exec'));
  assert.equal(call.binary, backend.codexPath);
  assert.equal(call.options.env.CODEX_HOME, path.join(dir, 'codex'));
  assert.equal(call.options.cwd, path.join(dir, 'workspace'));
  assert.ok(call.args.includes('features.shell_tool=false'));
  assert.ok(call.args.includes('features.apps=false'));
  assert.ok(call.args.includes('--ignore-user-config'));
  assert.ok(call.args.includes('read-only'));
  assert.ok(call.args.includes('--ephemeral'));
  assert.equal(call.args.at(-1), '-');
  assert.match(call.options.input, /二分之一/);
  assert.ok(!call.args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('study records survive restart and export contains no provider credentials', async (t) => {
  const { backend, dir, safeStorage } = await fixture(t);
  await backend.saveSettings({ deepseekKey: 'sk-private' });
  const study = { profile: { name: '小温', grade: 7 }, mistakes: [{ id: 'one', text: '负数计算' }], sessions: [{ id: 'session' }], activity: [{ date: '2026-10-17' }] };
  await backend.saveStudyData(study);
  const restart = new LearningBackend({ userData: dir, safeStorage, codexPath: '' });
  assert.deepEqual(await restart.getStudyData(), study);
  const exported = path.join(dir, 'export.json');
  await backend.exportStudyData(exported);
  const raw = await fs.readFile(exported, 'utf8');
  assert.ok(!raw.includes('sk-private'));
  assert.ok(!raw.includes('deepseekKey'));
  assert.equal(JSON.parse(raw).profile.name, '小温');
});

test('concurrent study writes remain valid and corrupt originals are retained', async (t) => {
  const { backend, dir } = await fixture(t);
  const study = await backend.getStudyData();
  await Promise.all(Array.from({ length: 5 }, (_, index) => backend.saveStudyData({ ...study, profile: { name: `同学${index}`, grade: 3 } })));
  assert.equal((await backend.getStudyData()).profile.name, '同学4');
  const file = path.join(dir, 'study.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(backend.getStudyData(), /原文件已保留/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('high school study profiles survive save, reload and export without resetting histories or defaults', async (t) => {
  const { backend, dir, safeStorage } = await fixture(t);
  const original = await backend.getStudyData();
  assert.equal(original.profile.grade, 5);
  const records = { mistakes: [{ id: 'junior-mistake', grade: 9, subject: 'math' }], sessions: [{ id: 'old-session' }], activity: [{ date: '2026-10-17' }] };
  const restarted = new LearningBackend({ userData: dir, safeStorage, codexPath: '', fetchImpl: () => assert.fail('Unexpected network call') });
  for (const grade of [10, 11, 12]) {
    const study = { profile: { name: '高中同学', grade }, ...records };
    await backend.saveStudyData(study);
    assert.deepEqual(await restarted.getStudyData(), study);
  }
  for (const grade of [0, 13, 10.5, null]) await assert.rejects(backend.saveStudyData({ ...original, profile: { name: '无效', grade } }), /年级/);
  const exported = path.join(dir, 'high-school-export.json');
  await restarted.exportStudyData(exported);
  const result = JSON.parse(await fs.readFile(exported, 'utf8'));
  assert.deepEqual(result.profile, { name: '高中同学', grade: 12 });
  for (const key of ['mistakes', 'sessions', 'activity']) assert.deepEqual(result[key], records[key]);
});

test('process runner decodes Chinese correctly across partial UTF-8 chunks', async () => {
  let receivedOptions;
  const spawnImpl = (_binary, _args, options) => {
    receivedOptions = options;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    setImmediate(() => {
      const bytes = Buffer.from('温习：一起学习 🌱');
      for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
      child.stderr.write(Buffer.from('测').subarray(0, 1));
      child.stderr.write(Buffer.from('测').subarray(1));
      child.emit('close', 0);
    });
    return child;
  };
  const result = await runProcess('fixture.exe', [], { spawnImpl });
  assert.equal(result.stdout, '温习：一起学习 🌱');
  assert.equal(result.stderr, '测');
  assert.equal(receivedOptions.shell, false);
  assert.equal(receivedOptions.windowsHide, true);
});

async function codexFixture(t, runner, options = {}) {
  const calls = [];
  const result = await fixture(t, { ...options, processRunner: async (binary, args, processOptions) => {
    calls.push({ binary, args, options: processOptions });
    if (args.includes('status')) return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' };
    return runner(binary, args, processOptions);
  } });
  result.backend.codexPath = path.join(result.dir, 'bundled-codex.exe');
  await fs.writeFile(result.backend.codexPath, 'fixture');
  await fs.writeFile(path.join(result.backend.codexHome, 'auth.json'), '{}');
  await result.backend.saveSettings({ provider: 'codex' });
  return { ...result, calls };
}

const codexAnswer = (text = '连接正常') => ({ code: 0, stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }), stderr: '' });

test('Windows system proxy and PAC are forwarded to native Codex without replacing explicit proxies', () => {
  const env = { CODEX_HOME: 'isolated', NO_COLOR: '1' };
  assert.deepEqual(systemProxyEnvironment('PROXY 127.0.0.1:21882; DIRECT', env), { ...env, HTTPS_PROXY: 'http://127.0.0.1:21882/', HTTP_PROXY: 'http://127.0.0.1:21882/', ALL_PROXY: 'http://127.0.0.1:21882/' });
  assert.equal(systemProxyEnvironment('SOCKS5 localhost:1080', env).HTTPS_PROXY, 'socks5h://localhost:1080');
  assert.deepEqual(systemProxyEnvironment('DIRECT; PROXY unwanted:80', env), env);
  assert.deepEqual(systemProxyEnvironment('PROXY ignored:80', { ...env, https_proxy: 'http://explicit:80' }), { ...env, https_proxy: 'http://explicit:80' });
  assert.throws(() => systemProxyEnvironment('PROXY invalid/path', env), /代理地址/);
});

test('Codex connection test verifies an actual answer through the resolved system proxy', async (t) => {
  const urls = [];
  const { backend, calls } = await codexFixture(t, () => codexAnswer(), { resolveProxy: async (url) => { urls.push(url); return 'PROXY 127.0.0.1:21882'; } });
  const result = await backend.testConnection();
  assert.equal(result.ok, true);
  assert.match(result.message, /实际回答/);
  const call = calls.find((entry) => entry.args.includes('exec'));
  assert.ok(call);
  assert.equal(call.options.env.HTTPS_PROXY, 'http://127.0.0.1:21882/');
  assert.match(call.options.input, /只回复“连接正常”/);
  assert.equal(call.options.timeoutMs, 90000);
  assert.ok(urls.every((url) => url === 'https://chatgpt.com'));
  assert.equal((await backend.getStudyData()).sessions.length, 0);
});

test('Codex connection test distinguishes network, quota, authentication and model errors without exposing diagnostics', async (t) => {
  for (const [diagnostic, expected] of [
    ['error sending request: proxy connect failed secret=sk-private', /系统代理/],
    ['usage_limit_reached secret=sk-private', /额度/],
    ['401 unauthorized access_token=sk-private', /登录已失效/],
    ['model is not supported secret=sk-private', /无法使用该模型/],
  ]) {
    const { backend } = await codexFixture(t, () => ({ code: 1, stdout: '', stderr: diagnostic }));
    const result = await backend.testConnection();
    assert.equal(result.ok, false);
    assert.match(result.message, expected);
    assert.ok(!result.message.includes('sk-private'));
  }
});

test('Codex failed-turn event is rejected even when process exit code is zero', async (t) => {
  const { backend } = await codexFixture(t, () => ({ code: 0, stdout: `${codexAnswer('未完成的回答').stdout}\n${JSON.stringify({ type: 'turn.failed', error: { message: 'rate limit exceeded' } })}`, stderr: '' }));
  await assert.rejects(backend.ask(input()), /额度/);
});

test('Codex attaches only account-contained images and rejects missing, external and excessive images', async (t) => {
  const { backend, dir, calls } = await codexFixture(t, () => codexAnswer('第 1 题需要先通分。'));
  const picture = path.join(dir, 'paper.png');
  await fs.writeFile(picture, 'fixture image');
  const answer = await backend.ask(input({ images: [picture] }));
  assert.match(answer.text, /通分/);
  const call = calls.find((entry) => entry.args.includes('exec'));
  assert.equal(call.args[call.args.indexOf('--image') + 1], await fs.realpath(picture));
  await assert.rejects(backend.ask(input({ images: [path.join(dir, 'missing.png')] })), /无法读取/);
  const otherAccount = await fixture(t);
  const external = path.join(otherAccount.dir, 'other-account.png');
  await fs.writeFile(external, 'private');
  await assert.rejects(backend.ask(input({ images: [external] })), /当前账号/);
  assert.throws(() => validateAsk(input({ images: ['relative.png'] })), /试卷图片格式/);
  assert.throws(() => validateAsk(input({ images: Array(21).fill(picture) })), /试卷图片格式/);
});

test('DeepSeek never silently ignores a submitted paper image', async (t) => {
  const { backend, dir } = await fixture(t);
  await backend.saveSettings({ deepseekKey: 'sk-test' });
  await assert.rejects(backend.ask(input({ images: [path.join(dir, 'paper.png')] })), /不支持试卷图片识别.*切换 Codex/);
});

test('process runner streams complete JSON lines across UTF-8 chunks for progress', async () => {
  const lines = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    setImmediate(() => {
      for (const byte of Buffer.from('{"type":"turn.started"}\n{"text":"温习"}')) child.stdout.write(Buffer.from([byte]));
      child.emit('close', 0);
    });
    return child;
  };
  await runProcess('fixture.exe', [], { spawnImpl, onStdoutLine: (line) => lines.push(JSON.parse(line)) });
  assert.deepEqual(lines, [{ type: 'turn.started' }, { text: '温习' }]);
});

test('disposed account rejects new operations while accepted queued writes finish', async (t) => {
  const { backend } = await fixture(t);
  let release;
  backend.enqueueWrite(() => new Promise((resolve) => { release = resolve; }));
  await Promise.resolve();
  const saved = backend.saveSettings({ deepseekModel: 'deepseek-pro' });
  const study = backend.saveStudyData({ profile: { name: '原账号', grade: 6 }, mistakes: [], sessions: [], activity: [] });
  backend.dispose();
  await assert.rejects(backend.ask(input()), /当前账号已退出/);
  await assert.rejects(backend.codexLogin(), /当前账号已退出/);
  await assert.rejects(backend.saveSettings({ deepseekModel: 'changed' }), /当前账号已退出/);
  await assert.rejects(backend.saveStudyData({}), /当前账号已退出/);
  release();
  await Promise.all([saved, study, backend.writeChain]);
  assert.equal((await backend.storedSettings()).deepseekModel, 'deepseek-pro');
  assert.equal((await backend.getStudyData()).profile.name, '原账号');
});

test('switching accounts during proxy resolution prevents a late native Codex launch', async (t) => {
  let block = false;
  let release;
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const { backend, calls } = await codexFixture(t, () => codexAnswer(), { resolveProxy: async () => {
    if (block) { began(); await new Promise((resolve) => { release = resolve; }); }
    return 'DIRECT';
  } });
  calls.length = 0;
  block = true;
  const running = backend.ask(input());
  const rejected = assert.rejects(running, /已停止/);
  await started;
  backend.dispose();
  release();
  await rejected;
  assert.equal(calls.length, 0);
  assert.equal(backend.requests.size, 0);
});
