import React, { useState } from 'react';
import { ArrowRight, BookOpen, CircleHelp, GraduationCap, Leaf, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import { GRADES } from './curriculum.js';

export default function AccountGate({ bridge, state, onAuthenticated }) {
  const accounts = state.accounts || [];
  const [creating, setCreating] = useState(!accounts.length);
  const [selected, setSelected] = useState(accounts[0]?.id || '');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState(4);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function changeMode(next) { setCreating(next); setPassword(''); setConfirmation(''); setError(''); }
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (creating && password !== confirmation) { setError('两次密码不一致，请重新确认。'); return; }
    setBusy(true); setError('');
    try {
      const next = creating
        ? await bridge.createAccount({ username: username.trim(), name: name.trim(), grade: Number(grade), password })
        : await bridge.loginAccount({ accountId: selected, password });
      if (!next?.activeAccount) throw new Error('登录尚未完成，请重试。');
      setPassword(''); setConfirmation(''); onAuthenticated(next);
    } catch (e) { setError(e.message || '暂时无法登录，请重试。'); }
    finally { setBusy(false); }
  }

  return <main className="account-screen">
    <div className="account-intro"><div className="account-brand"><img src="./icon.png" alt=""/><span>温习<span className="brand-dot">.</span></span></div><div className="eyebrow"><Leaf size={14}/> 每个人，都有自己的学习空间</div><h1>把你的成长，<br/>一页一页收好。</h1><p>在同一台电脑上，为每位同学建立独立账号。<br/>试卷、错题和学习足迹，分别保存在自己的档案里。</p><div className="account-benefits"><span><BookOpen size={18}/>单元试卷与统考归档</span><span><GraduationCap size={18}/>按年级陪伴学习</span><span><ShieldCheck size={18}/>密码登录个人档案</span></div></div>
    <section className="account-card"><div className="eyebrow">我的学习档案</div><h2>{creating ? '建立一个新账号' : '欢迎回来，继续进步'}</h2><p className="account-description">{creating ? '学习账号保存在这台电脑上。请记住用户名和密码。' : '选择自己的账号，输入密码后进入学习空间。'}</p>
      {!!accounts.length && <div className="segmented account-tabs"><button type="button" disabled={busy} className={!creating ? 'selected' : ''} onClick={() => changeMode(false)}>登录账号</button><button type="button" disabled={busy} className={creating ? 'selected' : ''} onClick={() => changeMode(true)}><Plus size={14}/>新建账号</button></div>}
      <form onSubmit={submit}><fieldset disabled={busy}>
        {creating ? <><label className="field"><span>用户名</span><input autoComplete="username" required maxLength={40} value={username} placeholder="例如 xiaoyu" onChange={e => setUsername(e.target.value)}/></label><div className="account-fields"><label className="field"><span>学生姓名 / 昵称</span><input required maxLength={20} value={name} placeholder="怎么称呼你" onChange={e => setName(e.target.value)}/></label><label className="field"><span>年级</span><select value={grade} onChange={e => setGrade(e.target.value)}>{GRADES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></label></div></> : <label className="field"><span>选择学习账号</span><select value={selected} required onChange={e => { setSelected(e.target.value); setPassword(''); setError(''); }}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.username}</option>)}</select></label>}
        <label className="field"><span>登录密码</span><input type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 6 : undefined} maxLength={128} value={password} placeholder={creating ? '至少 6 位字符' : '输入这个账号的密码'} onChange={e => setPassword(e.target.value)}/></label>
        {creating && <label className="field"><span>确认密码</span><input type="password" autoComplete="new-password" required maxLength={128} value={confirmation} placeholder="再输入一次密码" onChange={e => setConfirmation(e.target.value)}/></label>}
        {error && <div className="connection-result error" role="alert"><CircleHelp size={18}/><span>{error}</span></div>}
        <button type="submit" className="button primary account-submit">{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowRight size={17}/>} {busy ? '正在打开档案…' : creating ? '建立账号并开始' : '登录我的学习空间'}</button>
      </fieldset></form>
      {creating && state.hasLegacyData && <div className="account-legacy"><BookOpen size={16}/><span>检测到旧版学习记录。首个账号会接收这些记录，原数据会保留备份。</span></div>}
      <p className="account-footnote"><ShieldCheck size={13}/>学习账号用于区分本机档案；进入后可单独配置 AI 连接。</p>
    </section>
  </main>;
}
