import test from 'node:test';
import assert from 'node:assert/strict';
import { GRADES, CURRICULUM_INFO, getSubjects, getTopics, getPractice } from '../src/curriculum.js';

test('grade coverage and subject availability match the intended learning stages', () => {
  assert.deepEqual(GRADES.map(({ value }) => value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(GRADES.filter(({ stage }) => stage === '小学').length, 6);
  assert.equal(GRADES.filter(({ stage }) => stage === '初中').length, 3);
  assert.deepEqual(GRADES.filter(({ stage }) => stage === '高中').map(({ label }) => label), ['高一', '高二', '高三']);
  const highSchoolSubjects = ['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'];
  const expected = {
    1: ['math', 'chinese', 'science'],
    2: ['math', 'chinese', 'science'],
    3: ['math', 'chinese', 'english', 'science'],
    4: ['math', 'chinese', 'english', 'science'],
    5: ['math', 'chinese', 'english', 'science'],
    6: ['math', 'chinese', 'english', 'science'],
    7: ['math', 'chinese', 'english', 'history', 'geography', 'biology'],
    8: ['math', 'chinese', 'english', 'history', 'geography', 'biology', 'physics'],
    9: ['math', 'chinese', 'english', 'history', 'geography', 'biology', 'physics', 'chemistry'],
    10: highSchoolSubjects,
    11: highSchoolSubjects,
    12: highSchoolSubjects,
  };
  for (const [grade, subjects] of Object.entries(expected)) {
    assert.deepEqual(getSubjects(grade).map(({ id }) => id), subjects);
  }
});

test('all supported topics and practice are usable, uniquely addressable, and complete', () => {
  const ids = new Set();
  let pairs = 0;
  let topicCount = 0;
  let questionCount = 0;
  const assertNewId = (id) => { assert.ok(!ids.has(id), `duplicate id: ${id}`); ids.add(id); };
  for (const { value } of GRADES) {
    for (const subject of getSubjects(value)) {
      pairs += 1;
      assert.ok(subject.name && subject.icon && /^#[0-9A-Fa-f]{6}$/.test(subject.color));
      const topics = getTopics(value, subject.id);
      assert.ok(topics.length >= 4, `missing topic guide: grade ${value} ${subject.id}`);
      for (const topic of topics) {
        assertNewId(topic.id);
        assert.ok(topic.title.trim().length > 1);
        assert.ok(topic.description.trim().length > 5);
        topicCount += 1;
      }
      const questions = getPractice(value, subject.id);
      assert.ok(questions.length >= 3, `missing samples: grade ${value} ${subject.id}`);
      for (const question of questions) {
        assertNewId(question.id);
        assert.ok(question.question.trim().length > 3);
        assert.ok(question.options.length >= 2);
        assert.ok(question.options.every((option) => typeof option === 'string' && option.trim()));
        assert.equal(new Set(question.options).size, question.options.length, `duplicate options: ${question.id}`);
        assert.ok(Number.isInteger(question.answerIndex) && question.answerIndex >= 0 && question.answerIndex < question.options.length);
        assert.ok(question.explanation.trim().length > 8, `missing explanation: ${question.id}`);
        assert.ok(topics.some(({ id, title }) => id === question.topicId && title === question.topic), `unknown topic: ${question.id}`);
        questionCount += 1;
      }
    }
  }
  assert.equal(pairs, 70);
  assert.equal(topicCount, 280);
  assert.equal(questionCount, 237);
  assert.equal(CURRICULUM_INFO.gradeSubjectCount, pairs);
  assert.equal(CURRICULUM_INFO.topicCount, topicCount);
  assert.equal(CURRICULUM_INFO.questionCount, questionCount);
});

test('invalid or unsupported selections never leak another grade or subject', () => {
  for (const grade of [0, 13, -1, 1.5, '', 'bad', null, undefined, true, {}, [], NaN, Infinity]) {
    assert.deepEqual(getSubjects(grade), [], `invalid grade: ${String(grade)}`);
    assert.deepEqual(getTopics(grade, 'math'), []);
    assert.deepEqual(getPractice(grade, 'math'), []);
  }
  for (const [grade, subject] of [[1, 'english'], [6, 'physics'], [8, 'chemistry'], [9, 'science'], [9, 'politics'], [10, 'science'], [12, 'unknown'], [3, 'unknown'], [1, '__proto__'], [12, '__proto__']]) {
    assert.deepEqual(getTopics(grade, subject), []);
    assert.deepEqual(getPractice(grade, subject), []);
  }
  assert.deepEqual(getPractice('9', 'math'), getPractice(9, 'math'));
  assert.deepEqual(getPractice('12', 'politics'), getPractice(12, 'politics'));
});

test('answer selection and UI changes cannot mutate the shared question bank', () => {
  const original = getPractice(3, 'math');
  const changed = getPractice(3, 'math');
  changed[0].options[0] = 'changed';
  changed[0].explanation = '';
  changed.pop();
  assert.deepEqual(getPractice(3, 'math'), original);
  const subjects = getSubjects(3);
  subjects[0].name = 'changed';
  assert.equal(getSubjects(3)[0].name, '数学');
  const topics = getTopics(3, 'math');
  topics[0].title = 'changed';
  assert.notEqual(getTopics(3, 'math')[0].title, 'changed');
});

function answer(grade, subject, number) {
  const question = getPractice(grade, subject).find(({ id }) => id === `g${grade}-${subject}-q${number}`);
  assert.ok(question, `question exists: ${grade} ${subject} ${number}`);
  return question.options[question.answerIndex];
}

test('numeric mathematics answer keys agree with independently computed results', () => {
  const cases = [
    [1, 1, 8 + 5], [1, 2, Math.max(12, 9, 18, 15)],
    [2, 1, 6 * 4], [2, 2, 18 / 3], [2, 3, 100],
    [3, 1, 24 * 3], [3, 3, 2 * (6 + 4)],
    [4, 1, Math.max(0.7, 0.65)], [4, 2, 25 * 16],
    [5, 2, 13], [5, 3, 3 ** 3],
    [6, 1, 40 * 0.25], [6, 2, 25 * 2 / (2 + 3)], [6, 3, 3.14 * 3 ** 2],
    [7, 1, -3 + 8], [7, 3, [2, 4, 6, 8].reduce((a, b) => a + b, 0) / 4],
    [8, 1, Math.hypot(3, 4)], [8, 2, 2 * 3 + 1],
  ];
  for (const [grade, number, expected] of cases) {
    assert.equal(Number.parseFloat(answer(grade, 'math', number)), expected, `wrong mathematical key: grade ${grade} q${number}`);
  }
  // Fractions are checked as quantities, not option positions.
  const fraction = (text) => { const [numerator, denominator] = text.split('/').map(Number); return numerator / denominator; };
  assert.equal(fraction(answer(3, 'math', 2)), 1 / 4);
  assert.equal(fraction(answer(5, 'math', 1)), 1 / 3 + 1 / 6);
  const prime = Number(answer(5, 'math', 2));
  for (let divisor = 2; divisor <= Math.sqrt(prime); divisor += 1) assert.notEqual(prime % divisor, 0);
  assert.equal(answer(1, 'math', 3), '三角形');
  assert.equal(answer(4, 'math', 3), '5 个万');
});

test('algebra and probability answer keys satisfy their equations and outcome spaces', () => {
  const x = Number(answer(7, 'math', 2).split('=')[1]);
  assert.equal(2 * x + 3, 11);
  assert.equal(answer(8, 'math', 3), '(x − 3)(x + 3)');
  for (const value of [-4, -1, 0, 2, 5]) assert.equal((value - 3) * (value + 3), value ** 2 - 9);
  const roots = answer(9, 'math', 1).split(' 和 ').map(Number);
  assert.equal(new Set(roots).size, 2);
  for (const root of roots) assert.equal(root ** 2 - 5 * root + 6, 0);
  assert.equal(answer(9, 'math', 2), '(2, 1)');
  const vertexX = 2;
  assert.equal((vertexX - 2) ** 2 + 1, 1);
  for (const neighbor of [1, 3]) assert.ok((neighbor - 2) ** 2 + 1 > 1);
  const outcomes = [0, 1].flatMap((first) => [0, 1].map((second) => first + second));
  const expectedProbability = outcomes.filter((heads) => heads === 1).length / outcomes.length;
  const [a, b] = answer(9, 'math', 3).split('/').map(Number);
  assert.equal(a / b, expectedProbability);
});

test('measurement and electricity questions use consistent unit conversions and formulas', () => {
  assert.equal(Number.parseFloat(answer(7, 'geography', 2)), 100000 / 100 / 1000);
  assert.equal(Number.parseFloat(answer(8, 'physics', 1)), 50 / 10);
  assert.equal(Number.parseFloat(answer(8, 'physics', 3)), 54 / 20);
  assert.equal(Number.parseFloat(answer(9, 'physics', 1)), 3 / 10);
  assert.equal(Number.parseFloat(answer(9, 'physics', 2)), 6 * 0.5);
});

test('each high-school guide has its own original explained practice and grade-specific content', () => {
  const stems = new Set();
  for (const grade of [10, 11, 12]) {
    assert.equal(getSubjects(grade).find(({ id }) => id === 'politics')?.name, '思想政治');
    for (const { id: subject } of getSubjects(grade)) {
      const topics = getTopics(grade, subject);
      const questions = getPractice(grade, subject);
      assert.equal(topics.length, 4);
      assert.equal(questions.length, 4);
      assert.deepEqual(new Set(questions.map(({ topicId }) => topicId)), new Set(topics.map(({ id }) => id)));
      for (const question of questions) {
        assert.ok(!stems.has(question.question), `reused question across high-school stages: ${question.id}`);
        stems.add(question.question);
        assert.ok(question.explanation.length > 30, `insufficient explanation: ${question.id}`);
      }
      if (grade === 12) assert.ok(topics.every(({ title }) => title.includes('复习')), `grade 12 should identify its review scope: ${subject}`);
    }
  }
  assert.equal(stems.size, 108);
  assert.match(CURRICULUM_INFO.description, /不是完整教材或题库/);
  assert.match(CURRICULUM_INFO.description, /具体进度和选科以学校安排为准/);
});

test('high-school answers and topic selections are independent copies across sessions and grades', () => {
  for (const grade of [10, 11, 12]) {
    for (const { id: subject } of getSubjects(grade)) {
      const original = getPractice(grade, subject);
      const changed = getPractice(grade, subject);
      changed[0].options.reverse();
      changed[0].topicId = 'unrelated';
      changed[0].answerIndex = -1;
      changed.pop();
      assert.deepEqual(getPractice(grade, subject), original);
      const topics = getTopics(grade, subject);
      topics[0].title = 'changed';
      assert.notEqual(getTopics(grade, subject)[0].title, 'changed');
      assert.ok(original.every(({ id, topicId }) => id.startsWith(`g${grade}-${subject}-`) && topicId.startsWith(`g${grade}-${subject}-`)));
    }
  }
});

const numericAnswer = (grade, subject, number) => Number.parseFloat(answer(grade, subject, number).replaceAll('−', '-'));
const fractionAnswer = (grade, subject, number) => {
  const [numerator, denominator] = answer(grade, subject, number).split('/').map(Number);
  return numerator / denominator;
};

test('high-school mathematics keys satisfy sets, derivatives, vectors and conditional sample spaces', () => {
  const intersection = [1, 2, 3].filter((value) => [2, 3, 4].includes(value));
  assert.equal(answer(10, 'math', 1), `{${intersection.join(', ')}}`);
  assert.equal(numericAnswer(10, 'math', 2), Math.log2(8));
  assert.ok(Math.abs(fractionAnswer(10, 'math', 3) - Math.sin(Math.PI / 6)) < 1e-12);
  assert.equal(numericAnswer(10, 'math', 4), [1, 2].reduce((sum, x, index) => sum + x * [3, -1][index], 0));
  assert.equal(numericAnswer(11, 'math', 1), 2 + (5 - 1) * 3);
  assert.equal(numericAnswer(11, 'math', 2) ** 2 + 9, 25);
  // Check the cubic derivative against a symmetric difference, independently of the analytic formula.
  const step = 1e-5;
  const slope = ((2 + step) ** 3 - (2 - step) ** 3) / (2 * step);
  assert.ok(Math.abs(numericAnswer(11, 'math', 3) - slope) < 1e-8);
  const pairs = [1, 2, 3, 4, 5].flatMap((a) => [1, 2, 3, 4, 5].filter((b) => b > a).map((b) => [a, b]));
  assert.equal(numericAnswer(11, 'math', 4), pairs.length);
  assert.equal(numericAnswer(12, 'math', 1), Math.log(1) - 1);
  for (const x of [0.1, 0.5, 2, 10]) assert.ok(Math.log(x) - x < numericAnswer(12, 'math', 1));
  const perpendicular = answer(12, 'math', 2).replace(/[()]/g, '').replaceAll('−', '-').split(',').map(Number);
  assert.equal(perpendicular.reduce((sum, x, index) => sum + x * [1, 2, 2][index], 0), 0);
  const conditionalOutcomes = [1, 2, 3, 4, 5, 6].filter((x) => x > 3);
  assert.equal(fractionAnswer(12, 'math', 3), conditionalOutcomes.filter((x) => x % 2 === 0).length / conditionalOutcomes.length);
  const areas = Array.from({ length: 9 }, (_, index) => (index + 1) * (10 - (index + 1)));
  assert.equal(numericAnswer(12, 'math', 4), Math.max(...areas));
});

test('high-school science calculations respect units, conservation and stated assumptions', () => {
  const physicsCases = [
    [10, 1, 2 * 4 + 0.5 * 3 * 4 ** 2], [10, 2, 10 / 2], [10, 3, 20 * 3 * 0.5], [10, 4, 4 ** 2 / 2],
    [11, 1, 0.006 / 0.000002], [11, 2, 2 * 3 * 0.5], [11, 3, 100 * 0.02 / 0.1], [11, 4, 10 / 2],
    [12, 1, 2 * 3 / (2 + 1)], [12, 2, 100 - 40], [12, 4, 3 / 0.2],
  ];
  for (const [grade, number, expected] of physicsCases) {
    assert.equal(numericAnswer(grade, 'physics', number), expected, `physics ${grade} q${number}`);
  }
  assert.equal(numericAnswer(10, 'chemistry', 1), 14 / 28);
  assert.equal(numericAnswer(11, 'chemistry', 3), -890 * 0.5);
  assert.equal(numericAnswer(12, 'chemistry', 1), (0.1 * 1 - 0.1 * 0.5) / (0.1 + 0.1));
  assert.equal(1 + numericAnswer(12, 'chemistry', 2) + 4 * -2, 0);
  assert.equal(numericAnswer(10, 'biology', 4), 6 * 2);
  const offspring = ['A', 'a'].flatMap((first) => ['A', 'a'].map((second) => first + second));
  assert.equal(fractionAnswer(11, 'biology', 1), offspring.filter((genotype) => genotype === 'aa').length / offspring.length);
  assert.equal(numericAnswer(11, 'biology', 4), 1000 * 0.1);
  assert.equal(fractionAnswer(12, 'biology', 1), ['Aa', 'aa'].filter((genotype) => genotype === 'aa').length / 2);
  // Track the two original heavy strands across two rounds of semiconservative replication.
  let molecules = [['heavy', 'heavy']];
  for (let round = 0; round < 2; round += 1) molecules = molecules.flatMap(([a, b]) => [[a, 'light'], [b, 'light']]);
  assert.equal(fractionAnswer(12, 'biology', 2), molecules.filter((molecule) => molecule.includes('heavy')).length / molecules.length);
  assert.equal(Number(answer(11, 'geography', 1).split(':')[0]), 12 - (120 - 30) / 15);
  assert.equal(numericAnswer(12, 'geography', 1), 3 * 50000 / 100000);
  assert.equal(numericAnswer(12, 'geography', 2), 20 - (2000 - 500) / 100 * 0.6);
});
