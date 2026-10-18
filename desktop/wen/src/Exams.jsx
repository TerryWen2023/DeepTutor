import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Bookmark, CheckCircle2, CircleHelp, FileText, FolderOpen, LoaderCircle, Plus, RotateCcw, Sparkles, Square, Upload } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { GRADES, getSubjects } from './curriculum.js';
import { examAnalysisText, examMistake, parseExamPages } from './exam-utils.js';
import { getGradeLabel } from '../shared/education.js';

const types = { unit: '单元测验', unified: '统考 / 期中期末', other: '其他练习' };
const localDay = () => new Date().toLocaleDateString('en-CA');
const gradeName = value => getGradeLabel(value) || '未设置年级';

export default function Exams({ bridge, profile, initialExamId, connected, provider, onSettings, onMistake, notify, onBusy }) {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState(initialExamId || null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const alive = useRef(true);
  const selected = exams.find(e => e.id === selectedId);
  const [draft, setDraft] = useState({ title: '', subject: 'math', grade: Number(profile.grade), type: 'unit', unit: '', date: localDay() });

  async function reload() {
    setLoading(true); setError('');
    try { const result = bridge ? await bridge.listExams() : []; if (alive.current) setExams(Array.isArray(result) ? result : []); }
    catch (e) { if (alive.current) setError(e.message || '试卷档案读取失败，请重试。'); }
    finally { if (alive.current) setLoading(false); }
  }
  useEffect(() => { alive.current = true; reload(); return () => { alive.current = false; }; }, []);
  useEffect(() => { onBusy(importing); return () => onBusy(false); }, [importing]);

  async function importFiles(event) {
    event.preventDefault();
    if (!bridge || importing) return;
    setImporting(true); setError('');
    try {
      const exam = await bridge.importExam({ ...draft, title: draft.title.trim(), unit: draft.unit.trim() });
      if (!alive.current || exam?.canceled) return;
      if (!exam?.id) throw new Error('试卷尚未归档，请重试。');
      setExams(items => [exam, ...items.filter(e => e.id !== exam.id)]); setSelectedId(exam.id); setShowImport(false);
      setDraft(previous => ({ ...previous, title: '', unit: '' })); notify('试卷原件已收好，可以随时回来讲解');
    } catch (e) { if (alive.current) setError(e.message || '上传失败，请检查文件后重试。'); }
    finally { if (alive.current) setImporting(false); }
  }

  if (selected) return <ExamDetail key={selected.id} exam={selected} bridge={bridge} connected={connected} provider={provider} onSettings={onSettings} onBack={() => setSelectedId(null)} onUpdate={exam => setExams(items => items.map(e => e.id === exam.id ? exam : e))} onMistake={onMistake} onBusy={onBusy}/>;
  const visible = exams.filter(e => (filter === 'all' || e.type === filter) && `${e.title} ${e.unit || ''} ${getSubjects(e.grade).find(s => s.id === e.subject)?.name || e.subject}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="page-heading"><div><div className="eyebrow"><span/>每一次考试，都留下成长的线索</div><h1>把试卷收好，把难题弄懂</h1><p>{profile.name}的个人试卷档案 · 原卷、讲解和错题一起留存。</p></div><button className="button primary" disabled={!bridge || importing || loading} onClick={() => { setShowImport(value => !value); setError(''); }}><Plus size={17}/>上传试卷</button></div>
    {!bridge && <div className="preview-notice"><CircleHelp size={19}/><div><strong>桌面版可上传 JPG、PNG 和 PDF</strong><p>网页预览保留本地练习。请打开 Windows 桌面版建立账号和试卷档案。</p></div></div>}
    {showImport && <form className="panel exam-import" onSubmit={importFiles}><div className="section-heading"><div><h2>给这份试卷建档</h2><p>可多选 JPG、PNG 或 PDF，单文件最多 30 MB、合计 100 MB / 30 页。无需连接 AI 也能归档。</p></div><Upload size={23}/></div><fieldset disabled={importing}>
      <label className="field"><span>试卷名称</span><input required maxLength={100} placeholder="例如：八年级物理 · 第一单元测验" value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}/></label>
      <div className="exam-form-grid"><label className="field"><span>考试类型</span><select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}>{Object.entries(types).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="field"><span>考试日期</span><input type="date" required value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}/></label><label className="field"><span>年级</span><select value={draft.grade} onChange={e => setDraft(d => ({ ...d, grade: Number(e.target.value), subject: getSubjects(Number(e.target.value))[0]?.id || 'math' }))}>{GRADES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label><label className="field"><span>学科</span><select value={draft.subject} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))}>{getSubjects(draft.grade).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
      <label className="field"><span>单元 / 范围（选填）</span><input maxLength={100} placeholder="例如：第一单元 · 声现象" value={draft.unit} onChange={e => setDraft(d => ({ ...d, unit: e.target.value }))}/></label>
      <div className="exam-import-actions"><span>保留原始试卷，按文件名顺序编号页面。</span><button className="button secondary" type="button" onClick={() => setShowImport(false)}>取消</button><button className="button primary" type="submit">{importing ? <LoaderCircle size={16} className="spin"/> : <FolderOpen size={16}/>} {importing ? '正在整理试卷…' : '选择 JPG / PNG / PDF'}</button></div>
    </fieldset></form>}
    {error && <div className="connection-result error" role="alert"><CircleHelp size={18}/><span>{error}</span>{!showImport && <button className="button ghost" onClick={reload}><RotateCcw size={14}/>重试</button>}</div>}
    <div className="list-toolbar exam-toolbar"><div className="segmented">{[['all', '全部试卷'], ['unit', '单元测验'], ['unified', '统考'], ['other', '其他']].map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div><input className="exam-search" aria-label="搜索试卷" placeholder="搜索试卷、学科或单元" value={search} onChange={e => setSearch(e.target.value)}/></div>
    {loading ? <div className="empty-state" role="status"><LoaderCircle size={26} className="spin"/><p>正在打开试卷档案…</p></div> : !visible.length ? <div className="empty-state"><span className="empty-icon"><FileText size={29}/></span><h3>{exams.length ? '还没有找到这份试卷' : '第一份试卷，从这里收好'}</h3><p>{exams.length ? '试试其他关键词或考试类型。' : '上传单元测验或统考试卷，补充错题题号和自己的作答，听温习一步步讲明白。'}</p></div> : <div className="exam-grid">{visible.map(exam => <button key={exam.id} className="exam-card" onClick={() => setSelectedId(exam.id)}><div className="exam-card-top"><span className="exam-file-icon"><FileText size={24}/></span><span className="small-tag">{types[exam.type] || '试卷'}</span></div><h2>{exam.title}</h2><p>{gradeName(exam.grade)} · {getSubjects(exam.grade).find(s => s.id === exam.subject)?.name || exam.subject}</p>{exam.unit && <p>{exam.unit}</p>}<div className="exam-card-bottom"><span>{exam.date} · {exam.pageCount} 页</span><span>{examAnalysisText(exam) ? '查看讲解' : '打开档案'}<ArrowRight size={14}/></span></div></button>)}</div>}
  </>;
}

function ExamDetail({ exam, bridge, connected, provider, onSettings, onBack, onUpdate, onMistake, onBusy }) {
  const [question, setQuestion] = useState(exam.analysisQuestion || '');
  const [pageInput, setPageInput] = useState((exam.analysisPages || Array.from({ length: Math.min(6, exam.pageCount) }, (_, i) => i + 1)).join(','));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [selectedAnalysisId, setSelectedAnalysisId] = useState('latest');
  const activeRequest = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; const request = activeRequest.current; activeRequest.current = null; if (request) bridge?.cancel(request).catch(() => {}); }; }, []);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy]);
  useEffect(() => bridge?.onStatus?.(event => { if (event.requestId === activeRequest.current) setStatus(event.message); }), []);
  const histories = [...(exam.analyses || [])].reverse();
  const selectedAnalysis = histories.find(item => item.id === selectedAnalysisId) || { text: examAnalysisText(exam), question: exam.analysisQuestion || '', pages: exam.analysisPages || [] };
  const analysis = selectedAnalysis.text || '';

  async function analyze() {
    if (busy) return;
    if (provider !== 'codex') { setError('试卷图片讲解目前使用 Codex。请在连接设置中切换并登录 Codex；试卷归档和文字学习可继续使用。'); return; }
    if (!connected) { setError('试卷已经安全归档。请先到连接设置登录 Codex，再回来讲解。'); return; }
    let pages;
    try { pages = parseExamPages(pageInput, exam.pageCount); } catch (e) { setError(e.message); return; }
    const requestId = crypto.randomUUID(); activeRequest.current = requestId;
    setBusy(true); setError(''); setStatus('正在阅读试卷，整理讲解…');
    try {
      const response = await bridge.analyzeExam({ examId: exam.id, requestId, question: question.trim(), pageNumbers: pages });
      if (!alive.current || activeRequest.current !== requestId) return;
      if (!response?.text?.trim()) throw new Error('没有收到有效讲解。原卷仍在，可以稍后重试。');
      const updated = { ...exam, ...response.exam, analysis: response.text, analysisQuestion: question.trim(), analysisPages: pages };
      onUpdate(updated); setSelectedAnalysisId('latest');
    } catch (e) { if (alive.current && activeRequest.current === requestId) setError(e.message || '讲解暂时未完成，原卷已保留，请重试。'); }
    finally { if (alive.current && activeRequest.current === requestId) { activeRequest.current = null; setBusy(false); setStatus(''); } }
  }
  async function cancel() {
    const request = activeRequest.current; if (!request) return;
    activeRequest.current = null; setStatus('正在停止讲解…');
    try { await bridge.cancel(request); if (alive.current) setError('已停止本次讲解，原卷和已有讲解都已保留。'); }
    catch { if (alive.current) setError('已停止显示本次讲解，后台取消未确认，请稍后重试。'); }
    finally { if (alive.current) { setBusy(false); setStatus(''); } }
  }

  return <>
    <button className="button ghost exam-back" onClick={onBack} disabled={busy}><ArrowLeft size={16}/>返回试卷档案</button>
    <div className="page-heading"><div><div className="eyebrow"><span/>{types[exam.type] || '试卷'} · {exam.date}</div><h1>{exam.title}</h1><p>{gradeName(exam.grade)} · {getSubjects(exam.grade).find(s => s.id === exam.subject)?.name || exam.subject}{exam.unit ? ` · ${exam.unit}` : ''} · 共 {exam.pageCount} 页</p></div><span className="exam-saved"><CheckCircle2 size={15}/>原卷已归档</span></div>
    <section className="panel exam-originals"><div className="section-heading"><div><h2>试卷原件</h2><p>随时打开原件核对题目、批改和学生作答。</p></div><BookOpen size={22}/></div><div className="exam-files">{(exam.files || []).map((file, index) => { const first = 1 + exam.files.slice(0, index).reduce((sum, entry) => sum + entry.pageCount, 0); return <button key={file.id} className="exam-original" onClick={async () => { try { await bridge.openExamFile({ examId: exam.id, fileId: file.id }); } catch (e) { if (alive.current) setError(e.message || '原卷无法打开，请重试。'); } }}><FileText size={20}/><span><strong>{file.name}</strong><small>第 {first}{file.pageCount > 1 ? `–${first + file.pageCount - 1}` : ''} 页</small></span><FolderOpen size={17}/></button>; })}</div></section>
    <section className="panel exam-explain"><div className="section-heading"><div><h2>哪些地方，还没有弄明白？</h2><p>填写错题题号、学生答案或希望讲解的内容。一次最多选择 6 页。</p></div><Sparkles size={22}/></div>
      <label className="field"><span>讲解页码</span><input disabled={busy} value={pageInput} onChange={e => setPageInput(e.target.value)} placeholder="例如 1-3,5"/><small>按上方原件的连续页码填写。较长的试卷可以分批讲解。</small></label>
      <label className="field"><span>错题题号 / 学生作答 / 讲解要求（选填）</span><textarea disabled={busy} value={question} maxLength={6000} rows={4} onChange={e => setQuestion(e.target.value)} placeholder="例如：第 3、5 题做错了，第 3 题我选了 B。请讲清错误原因，再给一道类似题。"/></label>
      <p className="exam-note"><CircleHelp size={15}/>没有批改痕迹或学生答案时，AI 会讲解题目；判断错题还需要补充作答信息。</p>
      {provider !== "codex" && <div className="preview-notice"><CircleHelp size={18}/><div><strong>图片讲解需要 Codex</strong><p>当前连接为 DeepSeek，可继续归档和文字学习；试卷图片讲解请切换并登录 Codex。</p></div></div>}
      {error && <div className="connection-result error" role="alert"><CircleHelp size={18}/><span>{error}</span></div>}
      <div className="exam-analysis-actions"><span role="status">{busy ? status : '所选页面和补充内容会发送至你配置的 AI 服务。'}</span>{(!connected || provider !== "codex") && <button className="button secondary" onClick={onSettings}>连接设置<ArrowRight size={15}/></button>}{busy ? <button className="button secondary" onClick={cancel}><Square size={14}/>停止讲解</button> : <button className="button primary" onClick={analyze}><Sparkles size={16}/>{error ? '重试讲解' : analysis ? '重新讲解所选页' : '开始讲解'}</button>}</div>
    </section>
    {analysis && <section className="panel exam-analysis"><div className="section-heading"><div><h2>这份试卷的讲解</h2><p>讲解已保存在档案中。确认需要温习的内容后，可收进错题本。</p></div><button className="button secondary" disabled={busy} onClick={() => onMistake(examMistake({ ...exam, analysis }, selectedAnalysis.question, selectedAnalysis.pages || []))}><Bookmark size={16}/>收进错题本</button></div>
      {histories.length > 1 && <label className="field exam-history"><span>查看历次讲解</span><select value={selectedAnalysisId} onChange={e => setSelectedAnalysisId(e.target.value)}><option value="latest">最新讲解 · 第 {(exam.analysisPages || []).join('、')} 页</option>{histories.slice(1).map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · 第 {(item.pages || []).join('、')} 页{item.question ? ` · ${item.question.slice(0, 35)}` : ''}</option>)}</select></label>}
      {(selectedAnalysis.question || selectedAnalysis.pages?.length > 0) && <div className="exam-analysis-context"><span>{selectedAnalysis.pages?.length ? `第 ${selectedAnalysis.pages.join('、')} 页` : '试卷讲解'}</span>{selectedAnalysis.question && <p>{selectedAnalysis.question}</p>}</div>}
      <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml>{analysis}</ReactMarkdown></div><p className="exam-note">AI 识别与讲解可能有误，请结合原卷、教材及教师批改核对。</p></section>}
  </>;
}
