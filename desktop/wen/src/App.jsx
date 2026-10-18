import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Atom, BookOpen, Bookmark, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, Download, ExternalLink, Feather, Flame, Flower2, Globe2, GraduationCap, History, House, KeyRound, Leaf, Lightbulb, LoaderCircle, LogOut, MessageCircle, NotebookPen, PanelLeftClose, PencilLine, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Square, Target, Trash2, TrendingUp, WandSparkles, Wifi, X } from 'lucide-react';
import { GRADES, getSubjects, getTopics, getPractice } from './curriculum.js';
import AccountGate from './AccountGate.jsx';
import Exams from './Exams.jsx';
import { getGradeLabel } from '../shared/education.js';
import { getTopicStatus, TOPIC_STATUS_LABELS, recommendTopic, recordPracticeAnswer } from './study-flow.js';

const LOCAL_KEY = 'wenxi-study-preview-v1';
const freshStudy = () => ({ profile: { name: '小同学', grade: 4 }, mistakes: [], sessions: [], activity: [] });
const initialSettings = { provider: 'codex', deepseekModel: 'deepseek-flash', codexModel: 'auto', hasDeepseekKey: false, codexAvailable: false, codexLoggedIn: false };
const bridge = window.wen;
const uid = () => crypto.randomUUID();
const dayKey = (date = new Date()) => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dateText = (date) => new Date(date).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
const gradeName = grade => getGradeLabel(grade) || '未设置年级';
const subjectIcons = { math: Target, chinese: Feather, english: Globe2, science: Leaf, history: History, geography: Globe2, biology: Flower2, physics: Atom, chemistry: Atom, politics: BookOpen };
const navItems = [{ id: 'desk', label: '学习书桌', icon: House }, { id: 'practice', label: '随堂练习', icon: PencilLine }, { id: 'exams', label: '试卷档案', icon: BookOpen }, { id: 'mistakes', label: '错题本', icon: NotebookPen }, { id: 'activity', label: '学习足迹', icon: TrendingUp }, { id: 'settings', label: '连接设置', icon: Settings2 }];
const modes = [{ id: 'explain', label: '讲明白', icon: Lightbulb }, { id: 'practice', label: '练一练', icon: PencilLine }, { id: 'review', label: '温故知新', icon: RotateCcw }];

function Markdown({ children }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} skipHtml components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{children || ''}</ReactMarkdown>;
}

function Illustration() {
  return <div className="hero-art" aria-hidden="true"><svg viewBox="0 0 360 230" fill="none">
    <ellipse cx="199" cy="207" rx="126" ry="13" fill="#d9e6ce" />
    <circle cx="193" cy="104" r="91" fill="#e1ead4" />
    <circle cx="267" cy="43" r="17" fill="#eccf79" />
    <path d="M83 173l83-31 109 39-88 31-104-39Z" fill="#d8aa5e"/><path d="M83 164l83-31 109 39-88 31-104-39Z" fill="#f6d798"/><path d="M187 203v9M84 169l104 39 83-29" stroke="#ba8c48" strokeWidth="2"/>
    <path d="m110 133 76-29 99 35-75 31-100-37Z" fill="#2c795d"/><path d="m112 127 74-28 99 35-75 31-98-38Z" fill="#8bb39a"/><path d="m113 133 97 37 74-30v11l-74 29-97-36v-11Z" fill="#fcf8e9"/><path d="m110 144 100 38 78-31" stroke="#28674e" strokeWidth="5" strokeLinecap="round"/>
    <path d="M127 104c18-12 44-13 66-3v50c-21-10-47-10-66 1v-48Z" fill="#fffdf4"/><path d="M193 101c21-9 43-11 67-4v49c-24-6-46-5-67 5v-50Z" fill="#f7f0d8"/><path d="M193 103v46" stroke="#d5c9a6" strokeWidth="2"/>
    <path d="m138 114 27-5m-27 14 37-5m-37 14 31-4m36-15 38-6m-38 15 38-6m-38 15 23-4" stroke="#c6c4a9" strokeWidth="3" strokeLinecap="round"/>
    <path d="M109 94c-2-21 4-38 18-52 3 17-2 36-18 52Z" fill="#427d54"/><path d="M108 94c-18-9-29-23-30-41 17 5 27 20 30 41Z" fill="#91b47d"/><path d="m110 111-1-30" stroke="#5d8755" strokeWidth="3"/><path d="M94 104h31l-5 27H99l-5-27Z" fill="#dbb976"/>
    <path d="m276 97 19-27 9 6-19 27-9 6v-12Z" fill="#e3b643"/><path d="m278 98 6 4-8 6 2-10Z" fill="#fcf3d7"/>
    <path d="m170 41 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#689876"/><path d="m308 128 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" fill="#97ad7a"/>
    <circle cx="70" cy="140" r="4" fill="#d4b56e"/><circle cx="233" cy="25" r="3" fill="#87aa77"/>
  </svg><span className="art-note">让好奇心，慢慢发芽。</span></div>;
}

function EmptyState({ icon: Icon = BookOpen, title, children, action, onAction }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={29} strokeWidth={1.5}/></span><h3>{title}</h3><p>{children}</p>{action && <button className="button primary" onClick={onAction}>{action}<ArrowRight size={16}/></button>}</div>;
}

export default function App() {
  const [accountState, setAccountState] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    setError('');
    bridge.getAccountState().then(state => { if (alive) setAccountState(state); }).catch(e => { if (alive) setError(e.message || '学习账号读取失败，请重试。'); });
    return () => { alive = false; };
  }, [attempt]);
  if (!bridge) return <StudyApp/>;
  if (error) return <main className="account-loading"><CircleHelp size={28}/><p role="alert">{error}</p><button className="button secondary" onClick={() => setAttempt(value => value + 1)}>重新读取账号<RotateCcw size={16}/></button></main>;
  if (!accountState) return <main className="account-loading" role="status"><LoaderCircle size={28} className="spin"/><p>正在打开学习空间…</p></main>;
  if (!accountState.activeAccount) return <AccountGate key={accountState.accounts?.length || 0} bridge={bridge} state={accountState} onAuthenticated={setAccountState}/>;
  return <StudyApp key={accountState.activeAccount.id} account={accountState.activeAccount} onLoggedOut={setAccountState}/>;
}

function StudyApp({ account, onLoggedOut }) {
  const [view, setView] = useState('desk');
  const [examToOpen, setExamToOpen] = useState(null);
  const [study, setStudy] = useState(freshStudy);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [subject, setSubject] = useState('math');
  const [practiceTopic, setPracticeTopic] = useState('');
  const [toast, setToast] = useState('');
  const [initError, setInitError] = useState('');
  const [chat, setChat] = useState({ id: uid(), messages: [], topic: '', grade: 4, subject: 'math', mode: 'explain' });
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [chatError, setChatError] = useState('');
  const [childBusy, setChildBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [saveError, setSaveError] = useState('');
  const switchingRef = useRef(false);
  const aliveRef = useRef(true);
  const saveQueue = useRef(Promise.resolve());
  const latestStudy = useRef(study);
  latestStudy.current = study;
  const activeRequest = useRef(null);
  const chatEnd = useRef(null);
  const inputRef = useRef(null);
  const grade = Number(study.profile.grade);
  const subjects = useMemo(() => getSubjects(grade), [grade]);
  const subjectInfo = subjects.find(s => s.id === subject) || subjects[0];
  const topics = getTopics(grade, subjectInfo?.id || 'math');
  const questions = getPractice(grade, subjectInfo?.id || 'math');
  const selectedPracticeTopic = topics.find(topic => topic.id === practiceTopic);
  const practiceQuestions = selectedPracticeTopic ? questions.filter(q => q.topicId === selectedPracticeTopic.id || q.topic === selectedPracticeTopic.title) : questions;
  const nextTopic = recommendTopic(topics, questions, study.activity, grade, subjectInfo?.id);
  const today = dayKey();
  const todayActivity = study.activity.filter(a => dayKey(a.date || a.createdAt) === today);
  const connected = settings.provider === 'deepseek' ? settings.hasDeepseekKey : settings.codexLoggedIn;

  useEffect(() => {
    let alive = true;
    aliveRef.current = true;
    (async () => {
      try {
        const raw = bridge ? await bridge.getStudyData() : JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
        if (alive && raw) setStudy({ ...freshStudy(), ...raw, profile: { ...freshStudy().profile, ...raw.profile }, mistakes: Array.isArray(raw.mistakes) ? raw.mistakes : [], sessions: Array.isArray(raw.sessions) ? raw.sessions : [], activity: Array.isArray(raw.activity) ? raw.activity : [] });
      } catch { if (alive) setInitError('学习记录暂时无法读取。为保护已有记录，本次暂不自动保存，请重启应用后再试。'); return; }
      if (!alive) return;
      try { if (bridge) { const config = await bridge.getSettings(); if (alive) setSettings({ ...initialSettings, ...config }); } } catch (e) { if (alive) setInitError(e.message || '连接设置读取失败'); }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; aliveRef.current = false; const request = activeRequest.current; activeRequest.current = null; if (request) bridge?.cancel(request).catch(() => {}); };
  }, []);

  function queueSave(value) {
    const operation = saveQueue.current.catch(() => {}).then(() => bridge.saveStudyData(value));
    saveQueue.current = operation;
    return operation;
  }
  useEffect(() => {
    if (!loaded || switchingRef.current) return;
    if (bridge) queueSave(study).then(() => { if (aliveRef.current) setSaveError(''); }).catch(() => { if (aliveRef.current) setSaveError('学习档案保存失败，请检查磁盘空间。退出前会再次尝试保存。'); });
    else { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(study)); } catch { setToast('浏览器存储空间不足，记录未保存。'); } }
  }, [study, loaded]);
  useEffect(() => { if (toast) { const timeout = setTimeout(() => setToast(''), 3800); return () => clearTimeout(timeout); } }, [toast]);
  useEffect(() => { if (!subjects.some(s => s.id === subject)) setSubject(subjects[0]?.id || 'math'); }, [subjects, subject]);
  useEffect(() => { setPracticeTopic(''); }, [grade, subject]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [chat.messages, pending]);
  useEffect(() => bridge?.onStatus?.(event => { if (event.requestId === activeRequest.current) setStatus(event.message); }), []);

  function updateProfile(update) { setStudy(s => ({ ...s, profile: { ...s.profile, ...update } })); }
  function go(next) { if (childBusy || switchingRef.current) { setToast('请等待当前操作完成，或先停止试卷讲解。'); return; } if (next === 'exams') setExamToOpen(null); setView(next); setChatError(''); }
  async function switchAccount() {
    if (pending || childBusy) { setToast('请等待当前操作完成，或先停止回答，再切换账号。'); return; }
    if (switchingRef.current) return;
    switchingRef.current = true; setSwitching(true);
    try {
      if (loaded) await queueSave(latestStudy.current);
      else await saveQueue.current;
      const next = await bridge.logoutAccount();
      onLoggedOut(next);
    } catch (e) { setToast(e.message || '档案保存或退出失败，请重试。'); switchingRef.current = false; setSwitching(false); }
  }
  function beginChat(topic = '', mode = 'explain', prompt = '') {
    if (childBusy || switchingRef.current) { setToast('请等待当前操作完成，或先停止试卷讲解。'); return; }
    if (pending) { setToast('请先停止当前回答，再开启新的学习。'); setView('chat'); return; }
    const title = typeof topic === 'string' ? topic : topic.title;
    setChat({ id: uid(), messages: [], topic: title, grade, subject: subjectInfo?.id || 'math', mode });
    setInput(prompt || (title ? grade >= 10 ? `我想学习「${title}」，请先用一个简短问题判断我的基础，再结合概念、适用条件和例题引导我学习。` : `我想学习「${title}」，请从一个生活中的例子开始，带我一步步理解。` : ''));
    setChatError(''); setView('chat');
    setTimeout(() => inputRef.current?.focus(), 80);
  }
  function openSession(session) { if (pending || childBusy || switchingRef.current) { setToast('请先完成或停止当前操作。'); return; } setChat({ ...session, messages: session.messages || [], mode: session.mode || 'explain' }); setInput(''); setChatError(''); setView('chat'); }
  async function sendMessage() {
    const content = input.trim();
    if (!content || pending) return;
    if (!bridge) { setChatError('网页预览仅提供本地练习。请打开 Windows 桌面版，在「连接设置」中登录 Codex 或填写 DeepSeek API Key。'); return; }
    if (!connected) { setChatError(`请先在「连接设置」中${settings.provider === 'codex' ? '登录 Codex' : '保存 DeepSeek API Key'}。`); return; }
    const requestId = uid(); activeRequest.current = requestId;
    const userMessage = { role: 'user', content };
    const messages = [...chat.messages, userMessage];
    setChat(prev => ({ ...prev, messages })); setInput(''); setPending(true); setStatus('正在整理思路…'); setChatError('');
    try {
      const result = await bridge.ask({ requestId, messages: messages.map(({role, content}) => ({role, content})), grade: chat.grade, subject: chat.subject, mode: chat.mode, topic: chat.topic });
      if (activeRequest.current !== requestId) return;
      if (!result.text?.trim()) throw new Error('没有收到有效回答，请稍后重试。');
      const completed = { ...chat, messages: [...messages, { role: 'assistant', content: result.text, provider: result.provider }], updatedAt: new Date().toISOString(), title: chat.title || chat.topic || content.slice(0, 30) };
      setChat(completed);
      setStudy(s => ({ ...s, sessions: [completed, ...s.sessions.filter(item => item.id !== completed.id)].slice(0, 100), activity: [...s.activity, { id: uid(), date: new Date().toISOString(), type: 'chat', subject: chat.subject, topic: chat.topic || content.slice(0, 40), grade: chat.grade }].slice(-3000) }));
    } catch (e) { if (activeRequest.current === requestId) { setChatError(e.message || '连接暂时没有成功，请检查设置后重试。'); setInput(current => current.trim() ? current : content); setChat(prev => ({ ...prev, messages: prev.messages.slice(0, -1) })); } }
    finally { if (activeRequest.current === requestId) { activeRequest.current = null; setPending(false); setStatus(''); } }
  }
  async function cancel() { const id = activeRequest.current; if(!id)return; activeRequest.current = null; const last = chat.messages.at(-1); if(last?.role==='user'){setInput(current => current.trim() ? current : last.content);setChat(previous=>({...previous,messages:previous.messages.slice(0,-1)}));} setStatus('正在停止回答…'); try { await bridge?.cancel(id); setChatError('已停止本次回答。你可以修改问题后重新发送。'); } catch { setChatError('已停止显示本次回答，但后台取消未确认。请稍后再试。'); } finally { setPending(false);setStatus(''); } }
  function addMistake(item) {
    if (study.mistakes.some(m => m.question === item.question && Number(m.grade) === Number(item.grade) && m.subject === item.subject && m.examId === item.examId && JSON.stringify(m.pageNumbers || []) === JSON.stringify(item.pageNumbers || []))) { setToast('这一题已经在错题本里了'); return; }
    setStudy(s => ({ ...s, mistakes: [{ id: uid(), createdAt: new Date().toISOString(), mastered: false, ...item }, ...s.mistakes] }));
    setToast('已收进错题本，留给下一次温习');
  }
  function recordAnswer(question, correct, selected) {
    setStudy(s => recordPracticeAnswer(s, question, selected, { grade, subject: subjectInfo?.id, id: uid(), date: new Date().toISOString() }));
  }
  function beginPractice(topicId = '') {
    if (childBusy || switchingRef.current) { setToast('请等待当前操作完成。'); return; }
    setPracticeTopic(topicId); setView('practice');
  }
  const activeNav = view === 'chat' ? 'desk' : view;

  return <div className="app-shell">
    <aside className="sidebar" inert={switching}>
      <button className="brand" onClick={() => go('desk')} aria-label="温习首页"><img src="./icon.png" alt="温习" onError={e => { e.currentTarget.style.display='none'; }}/><div><strong>温习<span className="brand-dot">.</span></strong><small>温故而知新</small></div></button>
      <div className="sidebar-caption">我的学习空间</div>
      <nav>{navItems.map(({id,label,icon:Icon}) => <button key={id} className={`nav-item ${activeNav === id ? 'active' : ''}`} onClick={() => go(id)}><Icon size={19} strokeWidth={1.8}/><span>{label}</span>{id === 'mistakes' && study.mistakes.filter(m => !m.mastered).length > 0 && <span className="nav-count">{study.mistakes.filter(m => !m.mastered).length}</span>}{activeNav === id && <span className="nav-active-dot"/>}</button>)}</nav>
      {study.sessions.length > 0 && <div className="recent-sidebar"><div className="sidebar-caption">最近一起学过</div>{study.sessions.slice(0,3).map(session => <button key={session.id} onClick={() => openSession(session)}><MessageCircle size={14}/><span>{session.title}</span></button>)}</div>}
      <div className="sidebar-bottom"><div className="daily-quote"><Leaf size={19}/><p>不必一口气走很远，<br/>每天进步一点点。</p><span>KEEP YOUR CURIOSITY</span></div><button className="profile" onClick={() => go('settings')}><span className="avatar">{study.profile.name?.slice(0,1) || '温'}</span><span><strong>{study.profile.name || '小同学'}</strong><small>{account ? account.username : gradeName(grade)} · {account ? '个人档案' : '自在成长'}</small></span><Settings2 size={16}/></button>{account && <button className="account-switch" aria-label="退出并切换学习账号" title="退出并切换学习账号" disabled={switching} onClick={switchAccount}><LogOut size={16}/><span>退出 / 切换账号</span></button>}</div>
    </aside>
    <div className="main-shell" inert={switching}>
      <header className="topbar"><div className="breadcrumb"><span>我的空间</span><ChevronRight size={14}/><strong>{view === 'chat' ? '和温习一起学' : navItems.find(n => n.id === view)?.label}</strong></div><div className="header-right"><span className="date-label">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span><button className={`connection-chip ${connected ? 'connected' : ''}`} onClick={() => go('settings')}><span/>{connected ? `${settings.provider === 'codex' ? 'Codex' : 'DeepSeek'} 已配置` : '连接 AI 伙伴'}<ChevronRight size={13}/></button></div></header>
      {initError && <div className="global-warning" role="alert">{initError}</div>}
      {saveError && <div className="global-warning" role="alert">{saveError}<button className="button ghost" onClick={() => queueSave(latestStudy.current).then(() => setSaveError('')).catch(() => setToast('保存仍未成功，请检查磁盘空间。'))}>重试保存</button></div>}
      <main className={`main-content ${view === 'chat' ? 'chat-main' : ''}`}>
        {view === 'desk' && <>
          <div className="page-heading"><div><div className="eyebrow"><span/> 今天，也是长知识的一天</div><h1>你好，{study.profile.name || '小同学'}<span className="hello-sun">☀</span></h1><p>把不懂的变成懂的，把好奇变成自己的本领。</p></div><GradePicker grade={grade} onChange={value => updateProfile({grade:value})}/></div>
          <section className="hero"><div className="hero-copy"><div className="hero-kicker"><Sparkles size={15}/> 你的专属学习伙伴</div><h2>每一个“为什么”，<br/>都值得认真探索。</h2><p>难题拆成小步骤，知识连到生活里。<br/>温习陪你想明白，也陪你练扎实。</p><button className="button primary" onClick={() => beginChat(nextTopic || '')}>开始今天的学习<ArrowRight size={17}/></button><span className="hero-footnote">小学 · 初中 · 高中，按你的节奏学习</span>{nextTopic && <span className="hero-next-topic">建议从「{nextTopic.title}」开始</span>}</div><Illustration/></section>
          <div className="stats-grid"><Stat icon={BookOpen} label="今天的探索" value={todayActivity.filter(a => a.type==='chat').length} unit="次对话" color="green"/><Stat icon={PencilLine} label="今天的练习" value={todayActivity.filter(a => a.type==='practice').length} unit="道题目" color="gold"/><Stat icon={NotebookPen} label="待温习的错题" value={study.mistakes.filter(m => !m.mastered).length} unit="道小关卡" color="purple"/></div>
          <section className="subjects-section"><div className="section-heading"><div><h2>今天，想学点什么？</h2><p>选一个学科，从熟悉的地方向前一步。</p></div><span className="small-tag">{gradeName(grade)}</span></div><SubjectTabs subjects={subjects} value={subject} onChange={setSubject}/>{grade >= 10 && <p className="curriculum-note">高中九科导览与原创样例。高一侧重基础，高二侧重拓展，高三侧重综合复习；选科与教学顺序以学校安排为准。</p>}<div className="topic-grid">{topics.map((topic,index) => {const Icon = subjectIcons[subject] || BookOpen; const status = getTopicStatus(topic, questions, study.activity, grade, subjectInfo?.id); const hasPractice = questions.some(q => q.topicId === topic.id || q.topic === topic.title); return <article key={topic.id} className={`topic-card tone-${index%3}`}><button className="topic-open" onClick={() => beginChat(topic)} aria-label={`学习${topic.title}`}><span className="topic-top"><span className="topic-icon"><Icon size={21} strokeWidth={1.65}/></span><span className="topic-number">{String(index+1).padStart(2,'0')}</span></span><h3>{topic.title}</h3><p>{topic.description}</p><span className="topic-link">一起弄明白<ArrowUp size={17}/></span></button><div className="topic-practice-row"><span className={`topic-status status-${status}`}>{hasPractice ? TOPIC_STATUS_LABELS[status] : '概念导览'}</span>{hasPractice && <button onClick={() => beginPractice(topic.id)} aria-label={`练习${topic.title}`}>练此知识点<ArrowRight size={13}/></button>}</div></article>;})}</div></section>
          <section className="practice-banner"><span className="practice-banner-icon"><PencilLine size={26}/></span><div><h3>知识有没有住进脑袋里？</h3><p>来一组小练习，给今天的进步打个勾。无需联网，也能开始。</p></div><button className="button secondary" onClick={() => go('practice')}>去练一练<ArrowRight size={16}/></button></section>
          <footer className="page-footer"><Leaf size={13}/> 温习一小步，成长一大步。<span>WENXI · LEARN WITH WONDER</span></footer>
        </>}
        {view === 'practice' && <><PageHeading eyebrow="一点点练习，一点点熟练" title="把知识，变成你的本领" description="先独立想一想，再看解析。答错也没关系，我们会把它好好记下来。"/><div className="filter-bar"><GradePicker grade={grade} onChange={value => updateProfile({grade:value})}/><SubjectTabs subjects={subjects} value={subject} onChange={setSubject}/></div><label className="practice-topic-filter">练习范围<select aria-label="选择练习知识点" value={selectedPracticeTopic?.id || ''} onChange={e => setPracticeTopic(e.target.value)}><option value="">本科全部样例</option>{topics.filter(t => questions.some(q => q.topicId === t.id || q.topic === t.title)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select><span>样例答对仅代表本题表现，不等于掌握整个知识点。</span></label><Practice key={`${grade}-${subject}-${selectedPracticeTopic?.id || 'all'}`} questions={practiceQuestions} onAnswer={recordAnswer} onAsk={q => beginChat(q.topic, 'explain', `请带我一步步理解这道题，先给一个提示，不要直接告诉我答案：\n${q.question}\n${q.options.map((o,i)=>`${String.fromCharCode(65+i)}. ${o}`).join('\n')}`)}/></>}
        {view === 'mistakes' && <Mistakes study={study} onExam={id => { setExamToOpen(id); setView("exams"); }} onUpdate={setStudy} onPractice={() => go('practice')} onReview={mistake => { if (pending) { setToast('请先停止当前回答。'); return; } setChat({id:uid(), messages:[], topic:mistake.topic || '错题温习', grade:mistake.grade || grade, subject:mistake.subject || subject, mode:'review'}); setInput(`我想复习这道题，请先提一个引导问题，帮我自己想通：\n${mistake.question}\n${mistake.selectedAnswer ? `我之前的答案：${mistake.selectedAnswer}` : ''}`); setView('chat'); }}/>}
        {view === 'activity' && <Activity study={study} onOpen={openSession} onExport={async () => { if (!bridge) { const blob = new Blob([JSON.stringify(study,null,2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`温习学习记录-${today}.json`; a.click(); URL.revokeObjectURL(url); setToast('已导出学习记录'); return; } try { if(loaded) await queueSave(study); const result = await bridge.exportStudyData(); if (result.ok) setToast('学习记录已导出'); } catch(e) { setToast(e.message || '导出失败'); } }}/>}
        {view === 'exams' && <Exams bridge={bridge} profile={study.profile} initialExamId={examToOpen} connected={connected} provider={settings.provider} onSettings={() => go('settings')} onMistake={addMistake} notify={setToast} onBusy={setChildBusy}/>}
        {view === 'settings' && <Settings settings={settings} setSettings={setSettings} profile={study.profile} updateProfile={updateProfile} notify={setToast} onBusy={setChildBusy}/>}
        {view === 'chat' && <div className="chat-layout"><div className="chat-toolbar"><button className="icon-button" onClick={() => go('desk')} aria-label="回到书桌"><ArrowLeft size={19}/></button><div><h2>{chat.topic || '好奇心，尽管问'}</h2><p>{gradeName(chat.grade)}<span>·</span>{getSubjects(chat.grade).find(s => s.id===chat.subject)?.name || chat.subject}<span>·</span>{settings.provider === 'codex' ? 'Codex' : 'DeepSeek'} 陪你学</p></div><button className="button ghost new-chat" onClick={() => beginChat()} disabled={pending}><Plus size={16}/>新的探索</button></div><div className="chat-messages">
          {!chat.messages.length && <div className="chat-welcome"><div className="chat-brand-mark"><img src="./icon.png" alt=""/><Sparkles size={18}/></div><h2>我们一起，把问题想明白。</h2><p>你可以问一道题、一个概念，或告诉我哪里卡住了。<br/>我会配合你的年级，陪你一步一步探索。</p><div className="starter-prompts">{['用生活中的例子讲一讲', '先给我一个提示', '出一道题考考我'].map((prompt,index) => <button key={prompt} onClick={() => {setInput(`${chat.topic ? `关于「${chat.topic}」，` : ''}${prompt}。`); setChat(s => ({...s,mode:index===2?'practice':'explain'})); inputRef.current?.focus();}}>{index===0?<Lightbulb size={15}/>:index===1?<WandSparkles size={15}/>:<PencilLine size={15}/>} {prompt}<ArrowRight size={14}/></button>)}</div></div>}
          {chat.messages.map((message,index) => <div key={index} className={`message ${message.role}`}><span className="message-avatar">{message.role==='assistant' ? <Sparkles size={17}/> : study.profile.name?.slice(0,1)||'我'}</span><div className="message-body"><div className="message-label">{message.role==='assistant'?'温习':study.profile.name || '我'}{message.role==='assistant' && <span>{message.provider === 'codex' ? 'Codex' : message.provider === 'deepseek' ? 'DeepSeek' : ''}</span>}</div><div className="markdown"><Markdown>{message.content}</Markdown></div>{message.role==='assistant' && <div className="message-actions"><button onClick={async()=>{try{await navigator.clipboard.writeText(message.content);setToast('回答已复制');}catch{setToast('复制失败，请选中文字复制');}}}><Copy size={13}/>复制</button><button onClick={()=>addMistake({question:chat.messages[index-1]?.content||chat.topic,answer:message.content,subject:chat.subject,grade:chat.grade,topic:chat.topic})}><Bookmark size={13}/>收进错题本</button></div>}</div></div>)}
          {pending && <div className="message assistant"><span className="message-avatar"><Sparkles size={17}/></span><div className="thinking"><span className="thinking-dots"><i/><i/><i/></span>{status || '正在整理思路…'}</div></div>}
          {chatError && <div className="chat-error" role="alert"><CircleHelp size={18}/><span>{chatError}</span>{!connected && <button onClick={()=>go('settings')}>前往设置<ArrowRight size={13}/></button>}</div>}<div ref={chatEnd}/></div>
          <div className="composer-wrap"><div className="composer"><div className="mode-selector">{modes.map(({id,label,icon:Icon})=><button key={id} disabled={pending} className={chat.mode===id?'selected':''} onClick={()=>setChat(c=>({...c,mode:id}))}><Icon size={14}/>{label}</button>)}</div><textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} placeholder="哪里还不太明白？把问题交给温习…" aria-label="输入学习问题" maxLength={12000} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();sendMessage();}}}/><div className="composer-bottom"><span><ShieldCheck size={13}/>只聊学习，安心探索</span>{pending?<button className="send-button stop" onClick={cancel} aria-label="停止回答"><Square size={15} fill="currentColor"/></button>:<button className="send-button" onClick={sendMessage} disabled={!input.trim()} aria-label="发送问题"><ArrowUp size={20}/></button>}</div></div><p className="composer-note">AI 的回答可能有误，重要知识请结合课本核对。<span>Enter 发送 · Shift + Enter 换行</span></p></div>
        </div>}
      </main>
    </div>
    {switching && <div className="account-switch-overlay" role="status"><LoaderCircle size={25} className="spin"/><p>正在保存档案，准备切换账号…</p></div>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={17}/>{toast}<button onClick={()=>setToast('')} aria-label="关闭提示"><X size={14}/></button></div>}
  </div>;
}

function PageHeading({eyebrow,title,description,children}) { return <div className="page-heading"><div><div className="eyebrow"><span/>{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{children}</div>; }
function GradePicker({grade,onChange}) { return <label className="grade-picker"><GraduationCap size={18}/><select aria-label="选择年级" value={grade} onChange={e=>onChange(Number(e.target.value))}>{GRADES.map(g=><option key={g.value} value={g.value}>{g.stage} · {g.label}</option>)}</select><ChevronDown size={14}/></label>; }
function SubjectTabs({subjects,value,onChange}) { return <div className="subject-tabs" role="tablist" aria-label="选择学科">{subjects.map(s=>{const Icon=subjectIcons[s.id]||BookOpen;return <button key={s.id} role="tab" aria-selected={value===s.id} className={value===s.id?'selected':''} onClick={()=>onChange(s.id)}><Icon size={16}/>{s.name}</button>;})}</div>; }
function Stat({icon:Icon,label,value,unit,color}) { return <div className="stat-card"><span className={`stat-icon ${color}`}><Icon size={22} strokeWidth={1.7}/></span><div><p>{label}</p><strong>{value}<span>{unit}</span></strong></div></div>; }

function Practice({questions,onAnswer,onAsk}) {
  const [index,setIndex]=useState(0),[selected,setSelected]=useState(null),[answered,setAnswered]=useState(false),[results,setResults]=useState([]),[finished,setFinished]=useState(false);
  const question=questions[index];
  if(!questions.length) return <EmptyState title="这个学科的练习还在准备中" action="问问 AI 伙伴" onAction={()=>onAsk({topic:'学科练习',question:'请为我出一道适合当前年级的题目。',options:[]})}>先从一次有趣的提问开始吧。</EmptyState>;
  const correct=selected===question.answerIndex;
  const submit=()=>{if(selected===null||answered)return;setAnswered(true);setResults(r=>[...r,correct]);onAnswer(question,correct,selected);};
  const next=()=>{if(index===questions.length-1){setFinished(true);return;}setIndex(i=>i+1);setSelected(null);setAnswered(false);};
  return <div className="practice-layout"><section className="practice-card">
    {finished?<div className="practice-finished"><span className="finish-icon"><CheckCircle2 size={42}/></span><span className="eyebrow">完成啦，给自己一个小小的肯定</span><h2>今天，又向前了一步。</h2><div className="score"><strong>{results.filter(Boolean).length}</strong><span>/ {questions.length} 题答对</span></div><p>{results.every(Boolean)?'这一组都答对了！试着把解题思路讲给身边的人听吧。':'每一道错题，都是发现新知识的机会。错题已经收好，下次再来挑战。'}</p><button className="button primary" onClick={()=>{setIndex(0);setSelected(null);setAnswered(false);setResults([]);setFinished(false);}}>再温习一遍<RotateCcw size={16}/></button></div>:<>
      <div className="practice-card-top"><span className="small-tag"><span className="green-dot"/>本地精选练习</span><span>第 <b>{index+1}</b> / {questions.length} 题</span></div><div className="practice-progress"><span style={{width:`${index/questions.length*100}%`}}/></div><div className="question-topic">{question.topic}</div><h2 className="question-text">{question.question}</h2><div className="answer-options">{question.options.map((option,i)=><button key={i} disabled={answered} onClick={()=>setSelected(i)} className={`answer-option ${selected===i?'selected':''} ${answered&&i===question.answerIndex?'correct':''} ${answered&&selected===i&&!correct?'incorrect':''}`}><span className="option-letter">{String.fromCharCode(65+i)}</span><span>{option}</span>{answered&&i===question.answerIndex&&<CheckCircle2 size={19}/>}</button>)}</div>
      {answered&&<div className={`answer-explanation ${correct?'is-correct':'is-incorrect'}`}><div><CheckCircle2 size={19}/><strong>{correct?'答对了，你的思路很棒！':'再想一想，就会更明白。'}</strong></div><p>{question.explanation}</p>{!correct&&<small>这道题已经自动收进错题本。</small>}</div>}
      <div className="practice-actions"><button className="button ghost" onClick={()=>onAsk(question)}><Lightbulb size={16}/>请温习讲一讲</button>{answered?<button className="button primary" onClick={next}>{index===questions.length-1?'看看练习结果':'下一道题'}<ArrowRight size={16}/></button>:<button className="button primary" disabled={selected===null} onClick={submit}>确定答案<Check size={16}/></button>}</div>
    </>}
  </section><aside className="practice-aside"><div className="aside-illustration"><PencilLine size={35} strokeWidth={1.4}/><Sparkles size={18}/></div><h3>先想一想，<br/>答案不着急。</h3><p>读清题意，找到线索，<br/>试着写出自己的思路。</p><div className="aside-divider"/><span className="small-label">这一组的收获</span><div className="practice-dots">{questions.map((q,i)=><span key={q.id} className={i<results.length?(results[i]?'correct':'incorrect'):i===index?'current':''}>{i<results.length?(results[i]?<Check size={13}/>:<RotateCcw size={12}/>):i+1}</span>)}</div><p className="aside-note">自主编写的基础示例题，<br/>不等同于特定版本教材题库。</p></aside></div>;
}

function Mistakes({study,onUpdate,onReview,onPractice,onExam}) {
  const [filter,setFilter]=useState('pending'),[expanded,setExpanded]=useState(null),[confirmDelete,setConfirmDelete]=useState(null);
  const items=study.mistakes.filter(m=>filter==='all'||(filter==='mastered'?m.mastered:!m.mastered));
  return <><PageHeading eyebrow="错过一次，就更懂一点" title="错题也能，变成进步的起点" description="把还不熟悉的留下来，下一次温习的时候，试着自己讲清楚。"/><div className="list-toolbar"><div className="segmented">{[['pending','待温习'],['mastered','已掌握'],['all','全部']].map(([id,label])=><button key={id} className={filter===id?'selected':''} onClick={()=>setFilter(id)}>{label}<span>{study.mistakes.filter(m=>id==='all'||(id==='mastered'?m.mastered:!m.mastered)).length}</span></button>)}</div><span className="muted">记录保存在这台电脑上</span></div>
    {!items.length?<EmptyState icon={NotebookPen} title={filter==='mastered'?'每一次温习，都离掌握更近':'这里，等待你的第一个小突破'} action="开始一组练习" onAction={onPractice}>{filter==='mastered'?'温习后，把已经会了的题目标记为「已掌握」。':'练习中答错的题目会自动收进来，也可以收藏 AI 的讲解。'}</EmptyState>:<div className="mistake-list">{items.map(m=><article key={m.id} className="mistake-card"><div className="mistake-meta"><span className="small-tag">{getSubjects(m.grade||4).find(s=>s.id===m.subject)?.name||m.subject||'学习'}</span><span>{gradeName(m.grade||4)}</span><span>{dateText(m.createdAt)}</span>{m.mastered&&<span className="mastered-label"><CheckCircle2 size={13}/>已掌握</span>}</div><h3>{m.question}</h3>{m.sourceTitle && <button className="exam-source" onClick={() => onExam(m.examId)}><BookOpen size={13}/>来源：{m.sourceTitle}{m.pageNumbers?.length ? ` · 第 ${m.pageNumbers.join("、")} 页` : ""}<ChevronRight size={13}/></button>}{m.selectedAnswer&&<p className="your-answer">之前的答案：{m.selectedAnswer}</p>}{expanded===m.id&&<div className="mistake-answer markdown"><Markdown>{m.answer}</Markdown></div>}<div className="mistake-actions"><button className="button ghost" onClick={()=>setExpanded(expanded===m.id?null:m.id)}><BookOpen size={14}/>{expanded===m.id?'收起解析':'看看解析'}</button><button className="button ghost" onClick={()=>onReview(m)}><Sparkles size={14}/>陪我温习</button><div className="spacer"/><button className="button ghost" onClick={()=>onUpdate(s=>({...s,mistakes:s.mistakes.map(item=>item.id===m.id?{...item,mastered:!item.mastered}:item)}))}><CheckCircle2 size={14}/>{m.mastered?'还需温习':'已经掌握'}</button>{confirmDelete===m.id?<><button className="button danger" onClick={()=>{onUpdate(s=>({...s,mistakes:s.mistakes.filter(item=>item.id!==m.id)}));setConfirmDelete(null);}}>确认删除</button><button className="icon-button" onClick={()=>setConfirmDelete(null)} aria-label="取消删除"><X size={15}/></button></>:<button className="icon-button" onClick={()=>setConfirmDelete(m.id)} aria-label="删除错题"><Trash2 size={15}/></button>}</div></article>)}</div>}
  </>;
}

function Activity({study,onOpen,onExport}) {
  const days=Array.from({length:28},(_,i)=>{const d=new Date();d.setDate(d.getDate()-27+i);return {key:dayKey(d),date:d};});
  const answered=study.activity.filter(a=>a.type==='practice');
  const learnedDays=new Set(study.activity.map(a=>dayKey(a.date||a.createdAt))).size;
  return <><PageHeading eyebrow="每一个脚印，都算数" title="那些认真学过的日子" description="这里记录你真实的探索与练习，让一点点进步变得看得见。"><button className="button secondary" onClick={onExport}><Download size={16}/>导出记录</button></PageHeading><div className="stats-grid"><Stat icon={Leaf} label="有学习记录的日子" value={learnedDays} unit="天" color="green"/><Stat icon={MessageCircle} label="一起探索过" value={study.activity.filter(a=>a.type==='chat').length} unit="次对话" color="purple"/><Stat icon={Target} label="练习正确率" value={answered.length?Math.round(answered.filter(a=>a.correct).length/answered.length*100):'—'} unit={answered.length?'%':'尚未练习'} color="gold"/></div><section className="panel activity-calendar"><div className="section-heading"><div><h2>最近四周的学习时光</h2><p>每一个绿色，都是好奇心留下的印记。</p></div><span className="small-tag">{study.activity.filter(a=>days.some(d=>d.key===dayKey(a.date||a.createdAt))).length} 次学习活动</span></div><div className="calendar-days">{days.map(d=>{const count=study.activity.filter(a=>dayKey(a.date||a.createdAt)===d.key).length;return <div key={d.key} className={`calendar-day ${count?'has-activity':''} ${count>4?'busy':''}`} title={`${dateText(d.date)}：${count} 次活动`}><span>{d.date.getDate()}</span>{count>0?<Leaf size={17}/>:<span className="calendar-dot"/>}</div>;})}</div><p className="calendar-legend"><span/>还未探索<span className="filled"/>已经出发</p></section><div className="section-heading session-heading"><div><h2>可以接着聊的探索</h2><p>知识的线索，我们替你留着。</p></div></div>{!study.sessions.length?<EmptyState icon={MessageCircle} title="第一次探索，从一个问题开始">成功完成一次 AI 对话后，学习记录就会出现在这里。</EmptyState>:<div className="session-list">{study.sessions.map(s=><button key={s.id} onClick={()=>onOpen(s)}><span className="session-icon"><BookOpen size={21}/></span><span><strong>{s.title}</strong><small>{gradeName(s.grade)} · {getSubjects(s.grade).find(x=>x.id===s.subject)?.name||s.subject} · {dateText(s.updatedAt)}</small></span><span className="session-turns">{s.messages?.filter(m=>m.role==='assistant').length||0} 次回答</span><ChevronRight size={17}/></button>)}</div>}</>;
}

function Settings({settings,setSettings,profile,updateProfile,notify,onBusy}) {
  const [provider,setProvider]=useState(settings.provider),[key,setKey]=useState(''),[deepseekModel,setDeepseekModel]=useState(settings.deepseekModel||'deepseek-flash'),[codexModel,setCodexModel]=useState(settings.codexModel||'auto'),[busy,setBusy]=useState(''),[result,setResult]=useState(null),[name,setName]=useState(profile.name);
  useEffect(() => { onBusy(!!busy); return () => onBusy(false); }, [busy, onBusy]);
  const refresh=async()=>{if(bridge){const next=await bridge.getSettings();setSettings({...initialSettings,...next});return next;}};
  async function save(showToast=true) { if(!bridge){setResult({ok:false,message:'浏览器预览不接收或保存 API Key。请使用 Windows 桌面版连接 AI。'});return false;} try{const saved=await bridge.saveSettings({provider,deepseekModel:deepseekModel.trim(),codexModel:codexModel.trim()==='auto'?'':codexModel.trim(),...(key.trim()?{deepseekKey:key.trim()}: {})});setSettings({...initialSettings,...saved});setKey('');if(showToast)notify('连接设置已保存');return true;}catch(e){setResult({ok:false,message:e.message||'保存失败'});return false;} }
  async function test() {setBusy('test');setResult(null);try{if(await save(false))setResult(await bridge.testConnection());}catch(e){setResult({ok:false,message:e.message||'连接测试失败'});}finally{setBusy('');}}
  async function login() {if(!bridge)return;setBusy('login');setResult({ok:null,message:'请在打开的浏览器中完成 OpenAI 官方登录，完成后返回这里。'});try{if(!(await save(false)))return;const response=await bridge.codexLogin();setResult(response);await refresh();}catch(e){setResult({ok:false,message:e.message||'登录未完成，请重试'});}finally{setBusy('');}}
  return <><PageHeading eyebrow="找到适合你的学习方式" title="让温习，更懂你" description="选择年级，连接 AI 伙伴，开启属于自己的学习节奏。"/>
    {!bridge&&<div className="preview-notice"><CircleHelp size={19}/><div><strong>当前是界面预览</strong><p>本地练习和学习记录可用；Codex 登录和 DeepSeek 连接需要打开 Windows 桌面版。</p></div></div>}
    <section className="panel settings-profile"><div className="settings-section-title"><span className="stat-icon green"><GraduationCap size={21}/></span><div><h2>关于学习中的你</h2><p>年级会帮助温习选择更合适的知识与讲解方式。</p></div></div><div className="profile-fields"><label className="field"><span>怎么称呼你</span><input value={name} maxLength={20} placeholder="输入昵称" onChange={e=>setName(e.target.value)} onBlur={()=>updateProfile({name:name.trim()||'小同学'})}/></label><label className="field"><span>正在读的年级</span><select value={profile.grade} onChange={e=>updateProfile({grade:Number(e.target.value)})}>{GRADES.map(g=><option key={g.value} value={g.value}>{g.stage} · {g.label}</option>)}</select></label></div></section>
    <section className="panel settings-ai"><div className="settings-section-title"><span className="stat-icon purple"><Sparkles size={21}/></span><div><h2>连接你的 AI 伙伴</h2><p>任选一种方式，登录或填写密钥后就可以开始。</p></div><span className="optional-tag">联网学习</span></div><div className="provider-grid"><button className={`provider-card ${provider==='codex'?'selected':''}`} onClick={()=>{setProvider('codex');setResult(null);}} disabled={!!busy}><div className="provider-symbol codex-symbol"><Sparkles size={25}/></div><div><h3>Codex <span>OpenAI</span></h3><p>使用 OpenAI 官方账号登录</p></div><span className="radio-indicator">{provider==='codex'&&<span/>}</span></button><button className={`provider-card ${provider==='deepseek'?'selected':''}`} onClick={()=>{setProvider('deepseek');setResult(null);}} disabled={!!busy}><div className="provider-symbol deepseek-symbol"><WandSparkles size={25}/></div><div><h3>DeepSeek</h3><p>使用自己的 API Key 连接</p></div><span className="radio-indicator">{provider==='deepseek'&&<span/>}</span></button></div>
      {provider==='codex'?<div className="provider-config"><div className="login-status"><span className={`status-icon ${settings.codexLoggedIn?'ok':''}`}>{settings.codexLoggedIn?<CheckCircle2 size={23}/>:<KeyRound size={23}/>}</span><div><strong>{settings.codexLoggedIn?'Codex 已登录':'登录 Codex，开始一起学'}</strong><p>{settings.codexLoggedIn?'测试连接会请求模型实际回答；模型权限与额度由你的账号决定。':'将打开 OpenAI 官方登录页面，温习不会接触你的账号密码。'}</p></div>{settings.codexLoggedIn?<button className="button secondary" disabled={!!busy} onClick={async()=>{setBusy('logout');try{const response=await bridge.codexLogout();await refresh();setResult({ok:response?.ok===true,message:response?.message||(response?.ok?'已退出 Codex 登录。':'退出登录未完成，请重试。')});}catch(e){setResult({ok:false,message:e.message});}finally{setBusy('');}}}><LogOut size={15}/>退出登录</button>:<button className="button primary" disabled={!bridge||!!busy} onClick={login}>{busy==='login'?<LoaderCircle className="spin" size={16}/>:<ExternalLink size={16}/>}官方账号登录</button>}</div><label className="field model-field"><span>Codex 模型</span><input value={codexModel} onChange={e=>setCodexModel(e.target.value)} placeholder="auto" disabled={!!busy}/><small>auto 使用 Codex 默认模型；也可填写账号支持的模型名称。</small></label><div className="setting-note"><CircleHelp size={14}/>使用权限与额度取决于你的 OpenAI 账号和订阅。</div></div>:<div className="provider-config"><label className="field"><span>DeepSeek API Key {settings.hasDeepseekKey&&<span className="saved-badge"><ShieldCheck size={12}/>已有密钥</span>}</span><input type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder={settings.hasDeepseekKey?'已保存密钥；留空则保持不变':'输入你的 DeepSeek API Key'} autoComplete="off" spellCheck={false} disabled={!bridge||!!busy}/><small>密钥仅在桌面应用中保存，不会显示在对话或导出记录里。</small></label><label className="field model-field"><span>DeepSeek 模型</span><input value={deepseekModel} onChange={e=>setDeepseekModel(e.target.value)} placeholder="deepseek-flash" disabled={!!busy}/><small>填写 DeepSeek 官方 API 支持的模型 ID。</small></label><div className="setting-note"><KeyRound size={14}/>可在 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">DeepSeek 开放平台<ExternalLink size={12}/></a>创建密钥，API 使用按平台规则计费。</div></div>}
      {result&&<div className={`connection-result ${result.ok===true?'success':result.ok===null?'neutral':'error'}`} role="status">{result.ok===true?<CheckCircle2 size={18}/>:result.ok===null?<LoaderCircle className="spin" size={18}/>:<CircleHelp size={18}/>}<span>{result.message}</span></div>}
      <div className="settings-actions"><span><ShieldCheck size={14}/>学习内容会发送至你选择的 AI 服务</span><button className="button secondary" disabled={!bridge||!!busy} onClick={test}>{busy==='test'?<LoaderCircle className="spin" size={15}/>:<Wifi size={15}/>}测试连接</button><button className="button primary" disabled={!bridge||!!busy} onClick={async()=>{setBusy('save');setResult(null);await save();setBusy('');}}>{busy==='save'?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>}保存设置</button></div>
    </section><div className="settings-bottom-note"><Leaf size={17}/><div><strong>循序渐进，才学得扎实。</strong><p>温习提供学习辅助。教材内容与学校进度可能不同，AI 讲解请结合课本核对。建议小学生在家长陪伴下使用。</p></div></div>
  </>;
}
