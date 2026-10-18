import test from 'node:test';
import assert from 'node:assert/strict';
import { getTopicStatus, recommendTopic, recordPracticeAnswer } from '../src/study-flow.js';
import { getGradeLabel, getSchoolStage, getSubjectIds, normalizeGrade } from '../shared/education.js';

const topic = { id: 'g10-math-topic-1', title: '函数' };
const nextTopic = { id: 'g10-math-topic-2', title: '三角函数' };
const question = { id: 'g10-math-q1', topicId: topic.id, topic: topic.title, question: 'f(x)=2x，f(3)=？', options: ['6', '5'], answerIndex: 0, explanation: '代入 x=3，得到 2×3=6。' };
const context = { grade: 10, subject: 'math', id: 'a1', date: '2026-10-18T10:00:00Z' };
const empty = { profile: { grade: 10 }, mistakes: [], activity: [] };

test('shared education supports labels, stage and grade-specific subject boundaries', () => {
  assert.equal(getGradeLabel(10), '高一');
  assert.equal(getGradeLabel('12'), '高三');
  assert.equal(getSchoolStage(9), '初中');
  assert.equal(getSchoolStage(11), '高中');
  assert.equal(getSubjectIds(12).length, 9);
  assert.ok(getSubjectIds(10).includes('politics'));
  assert.ok(!getSubjectIds(9).includes('politics'));
  for (const value of [0, 13, NaN, true, {}, [], 10.5, 'invalid']) assert.equal(normalizeGrade(value), null);
  const subjects = getSubjectIds(10); subjects.pop();
  assert.equal(getSubjectIds(10).length, 9);
});

test('recommendation follows latest scoped attempts, including legacy records without topicId', () => {
  const unrelated = [{ ...context, type: 'practice', questionId: question.id, correct: false, grade: 9 }];
  assert.equal(getTopicStatus(topic, [question], unrelated, 10, 'math'), 'new');
  const wrong = recordPracticeAnswer(empty, question, 1, context);
  assert.equal(recommendTopic([nextTopic, topic], [question], wrong.activity, 10, 'math'), topic);
  const corrected = recordPracticeAnswer(wrong, question, 0, { ...context, id: 'a2' });
  assert.equal(getTopicStatus(topic, [question], corrected.activity, 10, 'math'), 'correct');
  assert.equal(recommendTopic([topic, nextTopic], [question], corrected.activity, 10, 'math'), nextTopic);
  assert.equal(getTopicStatus(topic, [{ ...question, topicId: undefined }], corrected.activity, 10, 'math'), 'correct');
  assert.equal(getTopicStatus(topic, [question], [{ ...wrong.activity[0], subject: 'physics' }], 10, 'math'), 'new');
});

test('wrong answers reopen a previously mastered mistake, preserve its ID, and refresh the attempted answer', () => {
  const first = recordPracticeAnswer(empty, question, 1, context);
  const mastered = { ...first, mistakes: first.mistakes.map(m => ({ ...m, mastered: true, selectedAnswer: '旧答案' })) };
  const again = recordPracticeAnswer(mastered, question, 1, { ...context, id: 'a2' });
  assert.equal(again.mistakes.length, 1);
  assert.equal(again.mistakes[0].id, 'a1');
  assert.equal(again.mistakes[0].mastered, false);
  assert.equal(again.mistakes[0].selectedAnswer, '5');
  assert.equal(mastered.mistakes[0].mastered, true);
  assert.equal(empty.activity.length, 0);
  const correct = recordPracticeAnswer(again, question, 0, { ...context, id: 'a3' });
  assert.equal(correct.mistakes[0].mastered, false, 'one sample answer must not certify mastery');
});
