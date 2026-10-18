'use strict';
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');

async function main() {
  const root = path.resolve(__dirname, '..');
  const studyGrade = Number(process.env.WEN_SMOKE_GRADE || 4);
  assert.ok(Number.isInteger(studyGrade) && studyGrade >= 1 && studyGrade <= 12);
  const output = path.join(root, 'output', 'desktop-smoke');
  await fs.mkdir(output, { recursive: true });
  const userData = await fs.mkdtemp(path.join(output, 'profile-'));
  const canvas = createCanvas(700, 500); const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 700, 500); ctx.fillStyle = 'black'; ctx.font = '34px sans-serif'; ctx.fillText('Unit 1: 2 + 3 = 6', 45, 90);
  const jpg = path.join(userData, 'unit.jpg'); await fs.writeFile(jpg, canvas.toBuffer('image/jpeg'));
  // A small self-contained two-page PDF with visible vector content.
  const pdf = path.join(userData, 'unit.pdf');
  const stream = '0 0 0 RG 30 50 200 150 re S';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 5 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 5 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let contents = '%PDF-1.4\n'; const offsets = [];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(contents)); contents += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(contents); contents += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await fs.writeFile(pdf, contents);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.WEN_DEV_URL;
  const executablePath = process.env.WEN_SMOKE_EXE || require('electron');
  const args = process.env.WEN_SMOKE_EXE ? [`--user-data-dir=${userData}`] : [root, `--user-data-dir=${userData}`];
  const application = await electron.launch({ executablePath, args, env, timeout: 30000 });
  const errors = [];
  let page;
  try {
    page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '建立一个新账号' })).toBeVisible({ timeout: 20000 });
    await page.getByLabel('用户名', { exact: true }).fill('student-a');
    await page.getByLabel('学生姓名 / 昵称').fill('小雨');
    await page.getByRole('combobox').selectOption(String(studyGrade));
    await page.getByLabel('登录密码', { exact: true }).fill('smoke-pass-a');
    await page.getByLabel('确认密码').fill('smoke-pass-a');
    await page.getByRole('button', { name: '建立账号并开始' }).click();
    await expect(page.getByRole('button', { name: '试卷档案', exact: true })).toBeVisible();
    const accountA = await page.evaluate(() => window.wen.getAccountState());
    assert.equal(accountA.activeAccount.username, 'student-a');
    await expect(page.getByRole('combobox', { name: '选择年级' })).toHaveValue(String(studyGrade));
    assert.equal((await page.evaluate(() => window.wen.getStudyData())).profile.grade, studyGrade);
    if (studyGrade >= 10) {
      await expect(page.getByRole('tab')).toHaveCount(9);
      await page.getByRole('tab', { name: '思想政治' }).click();
      await expect(page.locator('.topic-card')).toHaveCount(4);
      await page.screenshot({ path: path.join(output, 'high-school.png'), fullPage: true });
      await page.getByRole('tab', { name: '数学', exact: true }).click();
    }
    await application.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, [jpg, pdf]);
    const exam = await page.evaluate(grade => window.wen.importExam({ title: '第一单元测验', subject: 'math', grade, type: 'unit', unit: '加法', date: '2026-10-17' }), studyGrade);
    assert.equal(exam.grade, studyGrade);
    assert.equal(exam.pageCount, 3); assert.equal(exam.files.length, 2);
    // Seed two saved explanations to verify history selection and immediate account switching.
    // Live AI image recognition is tested separately; this fixture never simulates a live answer.
    const examManifest = path.join(userData, 'profiles', accountA.activeAccount.id, 'exams', exam.id, 'exam.json');
    const recorded = JSON.parse(await fs.readFile(examManifest, 'utf8'));
    const histories = [{ id: 'saved-first', text: '第一题：2 + 3 = 5，先把两个数量合起来。', question: '请讲第1题', pages: [1], createdAt: '2026-10-17T08:00:00Z', provider: 'codex' }, { id: 'saved-later', text: '第二题：四边形共有四条边。', question: '请讲第2题', pages: [2, 3], createdAt: '2026-10-17T09:00:00Z', provider: 'codex' }];
    await fs.writeFile(examManifest, JSON.stringify({ ...recorded, analyses: histories, analysis: histories[1].text, analysisQuestion: histories[1].question, analysisPages: histories[1].pages }));
    await page.getByRole('button', { name: '试卷档案', exact: true }).click();
    await expect(page.getByRole('heading', { name: '第一单元测验', exact: true })).toBeVisible();
    await page.getByRole('heading', { name: '第一单元测验', exact: true }).click();
    await expect(page.getByRole('button', { name: /unit.pdf/ })).toBeVisible();
    await page.getByLabel('查看历次讲解').selectOption('saved-first');
    await expect(page.locator('.exam-analysis .markdown')).toContainText('第一题：2 + 3 = 5');
    await page.screenshot({ path: path.join(output, process.env.WEN_SMOKE_EXE ? 'packaged-exams.png' : 'exams.png'), fullPage: true });
    await page.getByRole('button', { name: '收进错题本', exact: true }).click();
    await page.getByRole('button', { name: '退出并切换学习账号' }).click();
    await expect(page.getByRole('heading', { name: '欢迎回来，继续进步' })).toBeVisible();
    await page.getByRole('button', { name: '新建账号', exact: true }).click();
    await page.getByLabel('用户名', { exact: true }).fill('student-b');
    await page.getByLabel('学生姓名 / 昵称').fill('小林');
    await page.getByLabel('登录密码', { exact: true }).fill('smoke-pass-b');
    await page.getByLabel('确认密码').fill('smoke-pass-b');
    await page.getByRole('button', { name: '建立账号并开始' }).click();
    await expect(page.getByRole('button', { name: '试卷档案', exact: true })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.wen.listExams()), []);
    const studyB = await page.evaluate(() => window.wen.getStudyData());
    assert.equal(studyB.profile.name, '小林'); assert.deepEqual(studyB.mistakes, []);
    await page.getByRole('button', { name: '退出并切换学习账号' }).click();
    await expect(page.getByLabel('选择学习账号')).toBeVisible();
    await page.getByLabel('选择学习账号').selectOption(accountA.activeAccount.id);
    await page.getByLabel('登录密码', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: '登录我的学习空间' }).click();
    await expect(page.getByRole('alert')).toContainText('密码不正确');
    await page.getByLabel('登录密码', { exact: true }).fill('smoke-pass-a');
    await page.getByRole('button', { name: '登录我的学习空间' }).click();
    await expect(page.getByRole('button', { name: '试卷档案', exact: true })).toBeVisible();
    assert.equal((await page.evaluate(() => window.wen.listExams()))[0].id, exam.id);
    const restored = await page.evaluate(() => window.wen.getStudyData());
    assert.equal(restored.profile.grade, studyGrade);
    assert.equal(restored.mistakes.length, 1); assert.equal(restored.mistakes[0].examId, exam.id);
    assert.deepEqual(restored.mistakes[0].pageNumbers, [1]); assert.match(restored.mistakes[0].answer, /第一题：2 \+ 3 = 5/);
    const exportPath = path.join(userData, 'export.json');
    await application.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportPath);
    await page.evaluate(() => window.wen.exportStudyData());
    const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    assert.equal(exported.profile.name, '小雨'); assert.equal(exported.exams[0].id, exam.id);
    assert.equal(JSON.stringify(exported).includes('smoke-pass'), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, appVersion: await application.evaluate(({ app }) => app.getVersion()), packaged: !!process.env.WEN_SMOKE_EXE, checks: ['password login', 'JPG + two-page PDF import through IPC', 'isolated student records', 'wrong-password rejection', 'history explanation selection', 'saved mistake persists across immediate account switch with exact source pages', 'relogin persistence', 'export includes exam records without passwords'], screenshot: path.join(output, process.env.WEN_SMOKE_EXE ? 'packaged-exams.png' : 'exams.png') }, null, 2));
  } catch (error) {
    if (page) { console.error('Smoke UI diagnostics:', { url: page.url(), text: (await page.locator('body').innerText()).slice(0, 1500), errors }); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); }
    throw error;
  } finally { await application.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
