'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { ExamStore, validateMetadata } = require('../electron/exams.cjs');
const { validateAsk } = require('../electron/backend.cjs');

const metadata = { title: '第一单元测验', subject: 'math', grade: 5, type: 'unit', unit: '分数', date: '2026-10-17' };
function pdfFixture(pageCount = 1) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 4} 0 R`).join(' ')}] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < pageCount; i++) objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageCount + 4} 0 R >>`);
  const stream = 'BT /F1 24 Tf 40 500 Td (Math test: 2 + 3 = ?) Tj ET';
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  let data = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(data)); data += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(data);
}
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wenxi-exam-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canvas = createCanvas(600, 400); const context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, 600, 400); context.fillStyle = 'black'; context.font = '30px sans-serif'; context.fillText('2 + 3 = 6', 30, 70);
  const image = path.join(root, '测验.jpg'); await fs.writeFile(image, canvas.toBuffer('image/jpeg'));
  const pdf = path.join(root, '统考.pdf'); await fs.writeFile(pdf, pdfFixture(2));
  const calls = [];
  const backend = { ask: async input => { calls.push(validateAsk(input)); return { text: '第 1 页：2 + 3 = 5，请检查加法。', provider: 'codex' }; }, enqueueWrite: action => action() };
  const store = new ExamStore({ directory: path.join(root, 'student-a'), backend });
  return { root, image, pdf, backend, store, calls };
}

test('real JPG and multi-page PDF render and archive without changing originals', async t => {
  const { store, image, pdf } = await setup(t);
  const original = await fs.readFile(pdf);
  const exam = await store.importFiles(metadata, [image, pdf]);
  assert.equal(exam.pageCount, 3); assert.deepEqual(exam.files.map(file => file.pageCount), [1, 2]);
  assert.equal(exam.files[1].firstPage, 2);
  assert.equal(exam.pages, undefined); assert.equal(exam.files[0].storedName, undefined);
  assert.deepEqual(await fs.readFile(await store.originalFile({ examId: exam.id, fileId: exam.files[1].id })), original);
  assert.deepEqual(await fs.readFile(pdf), original);
  const internal = await store.read(exam.id);
  for (const page of internal.pages) {
    const png = await fs.readFile(await store.safeFile(exam.id, page.image));
    assert.ok(png.length > 1000); assert.equal(png.subarray(1, 4).toString(), 'PNG');
  }
  assert.equal((await store.list())[0].id, exam.id);
});

test('high school exam metadata accepts nine subjects and rejects unsupported grades and subjects', () => {
  const subjects = ['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'];
  for (const grade of [10, 11, 12]) for (const subject of subjects) assert.equal(validateMetadata({ ...metadata, grade, subject }).subject, subject);
  assert.deepEqual(validateMetadata({ ...metadata, grade: '12', subject: '思想政治' }), { ...metadata, grade: 12, subject: 'politics' });
  for (const grade of [0, 13, 10.5, true, null]) assert.throws(() => validateMetadata({ ...metadata, grade }), /年级/);
  for (const input of [{ grade: 9, subject: 'politics' }, { grade: 10, subject: 'science' }, { grade: 7, subject: 'chemistry' }, { grade: 12, subject: 'unknown' }]) assert.throws(() => validateMetadata({ ...metadata, ...input }), /学科/);
});

test('a 高三思想政治 exam retains its grade and subject through import, reload and analysis', async t => {
  const { store, image, calls, root, backend } = await setup(t);
  const exam = await store.importFiles({ ...metadata, title: '高三逻辑与思维练习', grade: 12, subject: 'politics', unit: '逻辑与思维' }, [image]);
  const reopened = new ExamStore({ directory: path.join(root, 'student-a'), backend });
  assert.equal((await reopened.list())[0].grade, 12);
  assert.equal((await reopened.read(exam.id)).subject, 'politics');
  await reopened.analyze({ examId: exam.id, requestId: 'high-school' });
  assert.equal(calls[0].grade, 12);
  assert.equal(calls[0].subject, 'politics');
  assert.equal((await reopened.read(exam.id)).analyses.length, 1);
});

test('previously archived custom subjects remain readable and analyzable without allowing new custom imports', async t => {
  const { store, image, calls } = await setup(t);
  const exam = await store.importFiles(metadata, [image]);
  const file = path.join(store.location(exam.id), 'exam.json');
  const archived = JSON.parse(await fs.readFile(file, 'utf8'));
  archived.subject = '原有综合科目';
  await fs.writeFile(file, JSON.stringify(archived));
  assert.equal((await store.list())[0].subject, '原有综合科目');
  await store.analyze({ examId: exam.id, requestId: 'legacy-subject' });
  assert.equal(calls[0].subject, '原有综合科目');
  assert.equal((await store.read(exam.id)).analyses.length, 1);
  await assert.rejects(store.importFiles({ ...metadata, subject: '原有综合科目' }, [image]), /学科/);
});

test('analysis sends only selected pages and preserves explanations and source details', async t => {
  const { store, image, pdf, calls } = await setup(t);
  const exam = await store.importFiles(metadata, [image, pdf]);
  const result = await store.analyze({ examId: exam.id, requestId: 'test', question: '请讲第2题', pageNumbers: [3, 1] });
  assert.equal(calls[0].images.length, 2); assert.match(calls[0].messages[0].content, /第 3、1 页/);
  assert.match(calls[0].messages[0].content, /不要把题目直接认定为错题/);
  assert.equal(result.exam.analysisQuestion, '请讲第2题'); assert.deepEqual(result.exam.analysisPages, [3, 1]);
  assert.equal((await store.read(exam.id)).analyses.length, 1);
  await store.analyze({ examId: exam.id, requestId: 'next', question: '讲解下一题', pageNumbers: [2] });
  assert.equal((await store.read(exam.id)).analyses.length, 2);
});

test('AI failure preserves archive and previous explanation; profiles cannot access each other', async t => {
  const { store, image, backend, root } = await setup(t);
  const exam = await store.importFiles(metadata, [image]);
  await store.analyze({ examId: exam.id, requestId: 'first' });
  backend.ask = async () => { throw new Error('offline'); };
  await assert.rejects(store.analyze({ examId: exam.id, requestId: 'second' }), /offline/);
  assert.equal((await store.read(exam.id)).analyses.length, 1);
  const other = new ExamStore({ directory: path.join(root, 'student-b'), backend });
  assert.deepEqual(await other.list(), []);
  await assert.rejects(other.read(exam.id), /没有找到/);
  await assert.rejects(store.originalFile({ examId: exam.id, fileId: '../../settings.json' }), /没有找到/);
  await assert.rejects(store.read('../../student-b'), /编号/);
});

test('bad formats, oversized page counts and invalid page choices are rejected transactionally', async t => {
  const { store, image, root } = await setup(t);
  const fake = path.join(root, 'fake.jpg'); await fs.writeFile(fake, '<script>invalid image</script>');
  await assert.rejects(store.importFiles(metadata, [fake]), /内容与扩展名不符/);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await fs.readdir(store.directory), []);
  const tooLong = path.join(root, 'large.pdf'); await fs.writeFile(tooLong, pdfFixture(31));
  await assert.rejects(store.importFiles(metadata, [tooLong]), /最多归档 30 页/);
  const exam = await store.importFiles(metadata, [image]);
  for (const pages of [[], [0], [2], [1, 1], ['1'], [1,2,3,4,5,6,7]]) await assert.rejects(store.analyze({ examId: exam.id, requestId: 'bad', pageNumbers: pages }), /有效页码/);
  assert.throws(() => validateMetadata({ ...metadata, date: '2026-02-30' }), /日期/);
});

test('queued analysis writes append to the latest history instead of overwriting another result', async t => {
  const { store, image, backend } = await setup(t);
  const exam = await store.importFiles(metadata, [image]);
  let releaseWrites, generatedBoth;
  let chain = new Promise(resolve => { releaseWrites = resolve; });
  const both = new Promise(resolve => { generatedBoth = resolve; });
  let count = 0;
  backend.ask = async () => { count++; if (count === 2) generatedBoth(); return { text: `answer-${count}`, provider: 'codex' }; };
  backend.enqueueWrite = action => { chain = chain.then(action); return chain; };
  const first = store.analyze({ examId: exam.id, requestId: 'first' });
  const second = store.analyze({ examId: exam.id, requestId: 'second' });
  await both; releaseWrites(); await Promise.all([first, second]);
  assert.deepEqual((await store.read(exam.id)).analyses.map(item => item.text).sort(), ['answer-1', 'answer-2']);
});

test('a session invalidated while reading the paper cannot start AI or persist a late result', async t => {
  const { store, image, backend, calls } = await setup(t);
  const exam = await store.importFiles(metadata, [image]);
  let checks = 0;
  await assert.rejects(store.analyze({ examId: exam.id, requestId: 'stale' }, () => { if (++checks > 1) throw new Error('session changed'); }), /session changed/);
  assert.equal(calls.length, 0);
  let active = true;
  backend.ask = async () => { active = false; return { text: 'late result', provider: 'codex' }; };
  await assert.rejects(store.analyze({ examId: exam.id, requestId: 'late' }, () => { if (!active) throw new Error('session changed'); }), /session changed/);
  assert.deepEqual((await store.read(exam.id)).analyses, []);
});
