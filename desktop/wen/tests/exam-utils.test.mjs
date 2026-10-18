import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExamPages, examMistake } from '../src/exam-utils.js';

test('paper page selection supports Chinese separators and ranges, with unique ordered pages', () => {
  assert.deepEqual(parseExamPages('5，1 - 3、3 6', 30), [1, 2, 3, 5, 6]);
  assert.deepEqual(parseExamPages('8至10,2', 10), [2, 8, 9, 10]);
  assert.deepEqual(parseExamPages('1-6,1', 30), [1, 2, 3, 4, 5, 6]);
});

test('paper page selection rejects out-of-range, excessive, empty and ambiguous selections', () => {
  for (const value of ['', ' ', '0', '-1', '3-2', '31', '1.5', '1-7', '1/2', '1-9999999999999', '1,b']) {
    assert.throws(() => parseExamPages(value, 30), undefined, value);
  }
  assert.throws(() => parseExamPages('4', 3), /1 到 3/);
});

test('saved paper explanations retain source identity and the analyzed page selection', () => {
  const exam = { id: 'exam-1', title: '第一单元', grade: 8, subject: 'physics', unit: '声现象', analysis: '第 3 题需要核对学生答案。' };
  const record = examMistake(exam, '第 3 题选了 B', [2, 3]);
  assert.equal(record.examId, 'exam-1');
  assert.equal(record.sourceTitle, '第一单元');
  assert.equal(record.sourceType, 'exam');
  assert.equal(record.question, '第一单元：第 3 题选了 B');
  assert.equal(record.answer, exam.analysis);
  assert.deepEqual(record.pageNumbers, [2, 3]);
  assert.equal(record.grade, 8);
  assert.equal(examMistake(exam, '', []).question, '第一单元 · 试卷讲解');
});
