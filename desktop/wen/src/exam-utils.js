export function parseExamPages(value, pageCount, limit = 6) {
  if (!String(value).trim()) throw new Error('请选择需要讲解的页码。');
  const pages = new Set();
  for (const part of String(value).trim().replace(/\s*([-—~至])\s*/g, '$1').split(/[,，、\s]+/)) {
    const match = part.match(/^(\d+)(?:\s*[-—~至]\s*(\d+))?$/);
    if (!match) throw new Error('页码格式不正确，例如：1-3,5。');
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > pageCount) throw new Error(`页码应在 1 到 ${pageCount} 之间。`);
    for (let page = start; page <= end; page += 1) {
      pages.add(page);
      if (pages.size > limit) throw new Error(`一次最多讲解 ${limit} 页，请分次选择。`);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export function examAnalysisText(exam) {
  return typeof exam?.analysis === 'string' ? exam.analysis : exam?.analysis?.text || '';
}

export function examMistake(exam, question, pageNumbers) {
  return {
    question: question?.trim() ? `${exam.title}：${question.trim()}` : `${exam.title} · ${pageNumbers.length ? `第 ${pageNumbers.join('、')} 页` : '试卷'}讲解`,
    answer: examAnalysisText(exam), subject: exam.subject, grade: exam.grade,
    topic: exam.unit || exam.title, examId: exam.id, sourceTitle: exam.title,
    sourceType: 'exam', pageNumbers,
  };
}
