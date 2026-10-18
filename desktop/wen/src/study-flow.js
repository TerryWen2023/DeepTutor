// A sample answer is evidence about that question, never a mastery certificate.
export function getTopicStatus(topic, questions, activity, grade, subject) {
  const relevant = questions.filter(q => q.topicId === topic.id || (!q.topicId && q.topic === topic.title));
  const latest = new Map();
  const ids = new Set(relevant.map(q => q.id));
  for (const attempt of activity) {
    if (attempt.type === 'practice' && Number(attempt.grade) === Number(grade) && attempt.subject === subject && ids.has(attempt.questionId) && typeof attempt.correct === 'boolean') {
      latest.set(attempt.questionId, attempt.correct);
    }
  }
  if ([...latest.values()].some(correct => !correct)) return 'review';
  if (!latest.size) return 'new';
  return latest.size === relevant.length ? 'correct' : 'started';
}

export const TOPIC_STATUS_LABELS = Object.freeze({ new: '尚未练习', review: '建议再练', correct: '样例已答对', started: '继续练习' });

export function recommendTopic(topics, questions, activity, grade, subject) {
  const byStatus = status => topics.find(topic => getTopicStatus(topic, questions, activity, grade, subject) === status);
  return byStatus('review') || byStatus('started') || byStatus('new') || topics[0];
}

export function recordPracticeAnswer(study, question, selected, { grade, subject, id, date }) {
  const correct = selected === question.answerIndex;
  const existing = study.mistakes.find(m => m.questionId === question.id && Number(m.grade) === Number(grade) && m.subject === subject);
  const details = {
    questionId: question.id, question: question.question,
    answer: `${question.options[question.answerIndex]}\n\n${question.explanation}`,
    selectedAnswer: question.options[selected], subject, grade,
    topic: question.topic, topicId: question.topicId, mastered: false,
  };
  let mistakes = study.mistakes;
  if (!correct) mistakes = existing
    ? mistakes.map(m => m === existing ? { ...m, ...details, lastAttemptAt: date } : m)
    : [{ id, createdAt: date, ...details }, ...mistakes];
  return {
    ...study, mistakes,
    activity: [...study.activity, { id, date, type: 'practice', questionId: question.id, topic: question.topic, topicId: question.topicId, subject, grade, correct }].slice(-3000),
  };
}
