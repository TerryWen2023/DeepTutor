// Shared by the renderer and Electron (Node >= 22.12 supports require(ESM)).
// Keep this module synchronous and independent of browser / desktop APIs.
const labels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '七年级', '八年级', '九年级', '高一', '高二', '高三'];

export const GRADES = Object.freeze(labels.map((label, index) => Object.freeze({
  value: index + 1, label, stage: index < 6 ? '小学' : index < 9 ? '初中' : '高中',
})));

export const SUBJECT_NAMES = Object.freeze({
  math: '数学', chinese: '语文', english: '英语', science: '科学',
  history: '历史', geography: '地理', biology: '生物', physics: '物理',
  chemistry: '化学', politics: '思想政治',
});

export function normalizeGrade(grade) {
  if (typeof grade !== 'number' && typeof grade !== 'string') return null;
  const value = Number(grade);
  return Number.isInteger(value) && value >= 1 && value <= GRADES.length ? value : null;
}

export function getGradeLabel(grade) { return GRADES[(normalizeGrade(grade) || 0) - 1]?.label || ''; }
export function getSchoolStage(grade) { return GRADES[(normalizeGrade(grade) || 0) - 1]?.stage || ''; }

export function getSubjectIds(grade) {
  const value = normalizeGrade(grade);
  if (!value) return [];
  if (value >= 10) return ['math', 'chinese', 'english', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics'];
  if (value <= 6) return ['math', 'chinese', ...(value >= 3 ? ['english'] : []), 'science'];
  return ['math', 'chinese', 'english', 'history', 'geography', 'biology', ...(value >= 8 ? ['physics'] : []), ...(value >= 9 ? ['chemistry'] : [])];
}

export default Object.freeze({ GRADES, SUBJECT_NAMES, normalizeGrade, getGradeLabel, getSchoolStage, getSubjectIds });
