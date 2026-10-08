import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { ArrowLeft, ArrowRight, BarChart3, BookOpenCheck, Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, Download, Eye, EyeOff, FilePlus2, KeyRound, LogOut, MonitorPlay, Pencil, Plus, Radio, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, Users, X } from 'lucide-react';

type Mode = 'LIVE' | 'SELF_PACED';
type Status = 'DRAFT' | 'ACTIVE' | 'CLOSED';
type Option = { id?: string; text: string; isCorrect?: boolean; correct?: boolean };
type Question = { id?: string; prompt: string; marks: number; options: Option[] };
type Quiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; showResults: boolean; currentQuestionIndex: number; currentAnswerRevealed: boolean; questions?: Question[]; _count?: { questions: number; attempts: number } };
type Student = { id: string; name: string; active: boolean; _count: { attempts: number } };
type User = { role: 'admin' | 'student'; name?: string; email?: string };
type QuizDraft = { title: string; mode: Mode; minutes: number; showResults: boolean; questions: Question[] };
type StudentQuiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; questionCount: number; attempt: { status: string; deadlineAt: string | null; score: number | null } | null };
type ActiveQuiz = { id: string; title: string; mode: Mode; status: Status; timeLimitSeconds: number | null; showResults: boolean; currentQuestionIndex: number; currentAnswerRevealed: boolean; questions: Question[]; attempt: { status: string; deadlineAt: string | null; score: number | null; answers: { questionId: string; optionId: string }[] } | null };
type Result = { id: string; name: string; status: string; submittedAt: string | null; score: number | null; totalMarks: number; answers: { question: string; response: string; correct: boolean; marks: number }[] };
type LiveStats = { answered: number; participants: number; distribution: { optionId: string; count: number }[]; responses: { name: string; optionId: string; text: string }[] };

const emptyQuestion = (): Question => ({ prompt: '', marks: 1, options: [{ text: '', isCorrect: true }, { text: '', isCorrect: false }] });
const newDraft = (): QuizDraft => ({ title: '', mode: 'LIVE', minutes: 20, showResults: true, questions: [emptyQuestion()] });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data as T;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'admin' | 'student'>('student');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api<{ user: User }>('/api/auth/me').then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  async function signIn(values: { email?: string; password?: string; passkey?: string }) {
    setError('');
    try {
      const result = await api<{ user: User }>(`/api/auth/${authMode}`, { method: 'POST', body: JSON.stringify(values) });
      setUser(result.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in.'); }
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setError('');
  }

  if (loading) return <div className="loading-screen"><span className="brand-mark"><BookOpenCheck size={21} /></span><span>Getting your classroom ready</span></div>;
  if (!user) return <Login mode={authMode} onMode={setAuthMode} onSubmit={signIn} error={error} />;
  return user.role === 'admin'
    ? <TeacherApp user={user} onSignOut={signOut} notice={notice} setNotice={setNotice} />
    : <StudentApp user={user} onSignOut={signOut} notice={notice} setNotice={setNotice} />;
}

function Login({ mode, onMode, onSubmit, error }: { mode: 'admin' | 'student'; onMode: (mode: 'admin' | 'student') => void; onSubmit: (values: { email?: string; password?: string; passkey?: string }) => void; error: string }) {
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passkey, setPasskey] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit(mode === 'admin' ? { email, password } : { passkey });
    setBusy(false);
  }
  return <main className="login-layout">
    <section className="login-side">
      <div className="login-brand"><span className="brand-mark"><BookOpenCheck size={21} /></span><span>LiveQuiz</span></div>
      <div className="login-copy"><div className="eyebrow"><span className="eyebrow-line" /> A better rhythm for learning</div><h1>Make every<br />answer <em>count.</em></h1><p>Thoughtful quizzes for lively classrooms and focused practice.</p><div className="login-note"><Sparkles size={17} /><span>One room. Everyone in.</span></div></div>
      <div className="login-footer"><span>Built for curious minds</span><span>01 / 02</span></div>
    </section>
    <section className="login-main">
      <div className="login-card">
        <span className="overline">Welcome to class</span><h2>{mode === 'student' ? 'Ready when you are.' : 'Your classroom, in sync.'}</h2><p className="muted">{mode === 'student' ? 'Enter the passkey your teacher shared with you.' : 'Sign in to prepare a quiz or bring the class together.'}</p>
        <div className="segmented login-switch"><button className={mode === 'student' ? 'selected' : ''} onClick={() => onMode('student')} type="button">Student</button><button className={mode === 'admin' ? 'selected' : ''} onClick={() => onMode('admin')} type="button">Teacher</button></div>
        <form onSubmit={submit} className="form-stack">
          {mode === 'student' ? <label className="field"><span>Your passkey</span><div className="input-with-icon"><KeyRound size={17} /><input autoFocus required value={passkey} onChange={(event) => setPasskey(event.target.value.toUpperCase())} placeholder="Enter your 16-character code" autoCapitalize="characters" autoComplete="one-time-code" /></div></label> : <><label className="field"><span>Email address</span><input autoFocus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@school.com" autoComplete="username" /></label><label className="field"><span>Password</span><input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" /></label></>}
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy ? 'Joining...' : mode === 'student' ? <>Join classroom <ArrowRight size={17} /></> : <>Sign in <ArrowRight size={17} /></>}</button>
        </form>
        <div className="secure-note"><ShieldCheck size={15} /><span>{mode === 'student' ? 'Your answers stay private to you and your teacher.' : 'Protected teacher access'}</span></div>
      </div>
      <div className="login-bottom">Live lessons <span /> Self-paced practice <span /> Clear results</div>
    </section>
  </main>;
}

function TeacherApp({ user, onSignOut, notice, setNotice }: { user: User; onSignOut: () => void; notice: string; setNotice: (text: string) => void }) {
  const [tab, setTab] = useState<'overview' | 'quizzes' | 'students' | 'results'>('overview');
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [distribution, setDistribution] = useState<{ question: string; options: { text: string; correct: boolean; count: number }[] }[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const [quizData, studentData] = await Promise.all([api<{ quizzes: Quiz[] }>('/api/quizzes'), api<{ students: Student[] }>('/api/students')]);
      setQuizzes(quizData.quizzes);
      setStudents(studentData.students);
      if (!selectedQuiz && quizData.quizzes[0]) setSelectedQuiz(quizData.quizzes[0].id);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to load your dashboard.'); }
    finally { setRefreshing(false); }
  }

  async function loadResults(id: string) {
    if (!id) return;
    try {
      const data = await api<{ results: Result[]; distribution: typeof distribution }>(`/api/quizzes/${id}/results`);
      setResults(data.results);
      setDistribution(data.distribution);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to load results.'); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (tab === 'results' && selectedQuiz) void loadResults(selectedQuiz); }, [tab, selectedQuiz]);
  useEffect(() => {
    const openResults = (event: Event) => {
      const quizId = (event as CustomEvent<string>).detail;
      if (quizId) { setSelectedQuiz(quizId); setTab('results'); }
    };
    document.addEventListener('open-results', openResults);
    return () => document.removeEventListener('open-results', openResults);
  }, []);
  useEffect(() => {
    if (notice) { const timeout = window.setTimeout(() => setNotice(''), 3400); return () => window.clearTimeout(timeout); }
  }, [notice]);

  const activeCount = quizzes.filter((quiz) => quiz.status === 'ACTIVE').length;
  const totalAttempts = quizzes.reduce((sum, quiz) => sum + (quiz._count?.attempts ?? 0), 0);
  const liveQuiz = quizzes.find((quiz) => quiz.id === selectedQuiz);

  function exportCsv() {
    const lines = [['Student', 'Status', 'Score', 'Out of', 'Submitted at'], ...results.map((result) => [result.name, result.status, result.score ?? '', result.totalMarks, result.submittedAt ? new Date(result.submittedAt).toLocaleString() : ''])];
    const csv = lines.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `${(quizzes.find((quiz) => quiz.id === selectedQuiz)?.title ?? 'quiz-results').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-results.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><span className="brand-mark"><BookOpenCheck size={19} /></span><span>LiveQuiz</span><span className="brand-dot" /></div>
      <div className="sidebar-label">TEACHER SPACE</div>
      <nav className="side-nav" aria-label="Teacher navigation">
        <NavItem active={tab === 'overview'} icon={<BarChart3 size={17} />} label="Overview" onClick={() => setTab('overview')} />
        <NavItem active={tab === 'quizzes'} icon={<BookOpenCheck size={17} />} label="Quizzes" count={quizzes.length} onClick={() => setTab('quizzes')} />
        <NavItem active={tab === 'students'} icon={<Users size={17} />} label="Students" count={students.length} onClick={() => setTab('students')} />
        <NavItem active={tab === 'results'} icon={<CheckCircle2 size={17} />} label="Results" onClick={() => setTab('results')} />
      </nav>
      <div className="sidebar-bottom"><div className="teacher-profile"><div className="avatar avatar-green">{(user.email ?? 'T').slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.email?.split('@')[0]}</strong><span>Teacher account</span></div><button className="icon-button quiet" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div><div className="sidebar-footnote">A little progress, every day.</div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="breadcrumb">Your classroom <span>/</span> <strong>{tabLabel(tab)}</strong></div><div className="topbar-actions"><span className="today-label">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span><button className="icon-button" title="Refresh dashboard" aria-label="Refresh dashboard" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button><div className="avatar avatar-small">{(user.email ?? 'T').slice(0, 1).toUpperCase()}</div></div></header>
      <div className="content-area">
        {tab === 'overview' && <section className="view-enter"><div className="page-heading"><div><span className="overline">Your classroom at a glance</span><h1>Good to see you.</h1><p>Pick up where your students left off.</p></div><button className="button button-primary" onClick={() => setTab('quizzes')}><Plus size={17} /> Create a quiz</button></div>
          <div className="metrics-grid"><Metric label="Quizzes made" value={quizzes.length} icon={<BookOpenCheck size={17} />} tint="sage" /><Metric label="In progress" value={activeCount} icon={<Radio size={17} />} tint="coral" /><Metric label="Student attempts" value={totalAttempts} icon={<Users size={17} />} tint="blue" /></div>
          <div className="section-heading"><div><h2>Recent quizzes</h2><p>Your latest classroom activities</p></div><button className="text-button" onClick={() => setTab('quizzes')}>All quizzes <ArrowRight size={15} /></button></div>
          <QuizList quizzes={quizzes.slice(0, 4)} onEdit={(quiz) => { setSelectedQuiz(quiz.id); setTab('quizzes'); }} onSelect={(quiz) => { setSelectedQuiz(quiz.id); setTab(quiz.mode === 'LIVE' ? 'quizzes' : 'results'); }} onRefresh={refresh} setNotice={setNotice} />
        </section>}
        {tab === 'quizzes' && <QuizManager quizzes={quizzes} selectedQuiz={selectedQuiz} setSelectedQuiz={setSelectedQuiz} liveQuiz={liveQuiz} refresh={refresh} setNotice={setNotice} />}
        {tab === 'students' && <StudentManager students={students} refresh={refresh} setNotice={setNotice} />}
        {tab === 'results' && <ResultsPanel quizzes={quizzes} selectedQuiz={selectedQuiz} setSelectedQuiz={setSelectedQuiz} results={results} distribution={distribution} onExport={exportCsv} />}
      </div>
      {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}
    </main>
  </div>;
}

function tabLabel(tab: string) { return ({ overview: 'Overview', quizzes: 'Quizzes', students: 'Students', results: 'Results' } as Record<string, string>)[tab] ?? tab; }
function NavItem({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}</button>; }
function Metric({ label, value, icon, tint }: { label: string; value: number; icon: React.ReactNode; tint: string }) { return <div className="metric"><div className={`metric-icon ${tint}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div><div className="metric-trend">↗</div></div>; }

function QuizList({ quizzes, onEdit, onSelect, onRefresh, setNotice }: { quizzes: Quiz[]; onEdit: (quiz: Quiz) => void; onSelect: (quiz: Quiz) => void; onRefresh: () => Promise<void>; setNotice: (text: string) => void }) {
  async function remove(quiz: Quiz) {
    if (!window.confirm(`Delete “${quiz.title}” and all its results?`)) return;
    try { await api(`/api/quizzes/${quiz.id}`, { method: 'DELETE' }); setNotice('Quiz deleted.'); await onRefresh(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to delete quiz.'); }
  }
  if (!quizzes.length) return <div className="empty-state"><span className="empty-icon"><FilePlus2 size={22} /></span><h3>Your first quiz starts here.</h3><p>Build a live classroom round or a timed practice quiz.</p><button className="button button-primary" onClick={() => onEdit({ id: '', title: '', mode: 'LIVE', status: 'DRAFT', currentQuestionIndex: 0, currentAnswerRevealed: false, timeLimitSeconds: null, showResults: true })}><Plus size={16} /> Create a quiz</button></div>;
  return <div className="quiz-list">{quizzes.map((quiz) => <article className="quiz-row" key={quiz.id}><div className={`quiz-mode-icon ${quiz.mode === 'LIVE' ? 'mode-live' : 'mode-timed'}`}>{quiz.mode === 'LIVE' ? <Radio size={19} /> : <Clock3 size={19} />}</div><button className="quiz-row-main" onClick={() => onSelect(quiz)}><strong>{quiz.title}</strong><span>{quiz.mode === 'LIVE' ? 'Live classroom' : `${Math.round((quiz.timeLimitSeconds ?? 0) / 60)} min · Self-paced`} <i /> {quiz._count?.questions ?? 0} questions <i /> {quiz._count?.attempts ?? 0} attempts</span></button><StatusPill status={quiz.status} /><div className="quiz-row-actions"><button className="icon-button" title="Edit quiz" aria-label={`Edit ${quiz.title}`} disabled={quiz.status === 'ACTIVE' || (quiz._count?.attempts ?? 0) > 0} onClick={() => onEdit(quiz)}><Pencil size={15} /></button><button className="icon-button danger-hover" title="Delete quiz" aria-label={`Delete ${quiz.title}`} onClick={() => void remove(quiz)}><Trash2 size={15} /></button></div></article>)}</div>;
}
function StatusPill({ status }: { status: Status }) { return <span className={`status-pill status-${status.toLowerCase()}`}><i />{status === 'ACTIVE' ? 'Live' : status === 'CLOSED' ? 'Finished' : 'Draft'}</span>; }

function QuizManager({ quizzes, selectedQuiz, setSelectedQuiz, liveQuiz, refresh, setNotice }: { quizzes: Quiz[]; selectedQuiz: string; setSelectedQuiz: (id: string) => void; liveQuiz?: Quiz; refresh: () => Promise<void>; setNotice: (text: string) => void }) {
  const [draft, setDraft] = useState<QuizDraft | null>(null);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<LiveStats>({ answered: 0, participants: 0, distribution: [], responses: [] });
  const socketRef = useRef<Socket | null>(null);
  const [liveState, setLiveState] = useState<{ status: Status; currentQuestionIndex: number; currentAnswerRevealed: boolean; questionCount: number; question: Question | null } | null>(null);

  useEffect(() => {
    if (!liveQuiz || liveQuiz.mode !== 'LIVE' || liveQuiz.status !== 'ACTIVE') { setLiveState(null); return; }
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('watch:quiz', liveQuiz.id));
    socket.on('quiz:stats', setStats);
    socket.on('quiz:state', (state) => setLiveState(state));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [liveQuiz?.id, liveQuiz?.status]);

  async function startEdit(quiz?: Quiz) {
    if (!quiz?.id) { setEditingId(''); setDraft(newDraft()); return; }
    try {
      const data = await api<{ quiz: Quiz }>(`/api/quizzes/${quiz.id}/detail`);
      const full = data.quiz;
      setEditingId(full.id);
      setDraft({ title: full.title, mode: full.mode, minutes: Math.max(1, Math.round((full.timeLimitSeconds ?? 1200) / 60)), showResults: full.showResults, questions: full.questions ?? [emptyQuestion()] });
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to open this quiz.'); }
  }

  function updateQuestion(index: number, updater: (question: Question) => Question) {
    if (!draft) return;
    setDraft({ ...draft, questions: draft.questions.map((question, questionIndex) => questionIndex === index ? updater(question) : question) });
  }

  async function saveQuiz(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const body = { title: draft.title, mode: draft.mode, timeLimitSeconds: draft.mode === 'SELF_PACED' ? draft.minutes * 60 : null, showResults: draft.showResults, questions: draft.questions };
      await api(editingId ? `/api/quizzes/${editingId}` : '/api/quizzes', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      setDraft(null); setNotice(editingId ? 'Quiz updated.' : 'Quiz created.'); await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to save quiz.'); }
    finally { setSaving(false); }
  }

  async function control(action: 'start' | 'next' | 'reveal' | 'stop') {
    if (!liveQuiz) return;
    try { await api(`/api/quizzes/${liveQuiz.id}/control`, { method: 'PATCH', body: JSON.stringify({ action }) }); await refresh(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update this quiz.'); }
  }

  async function setTimedStatus(quiz: Quiz, action: 'start' | 'stop') {
    try { await api(`/api/quizzes/${quiz.id}/status`, { method: 'PATCH', body: JSON.stringify({ action }) }); await refresh(); setNotice(action === 'start' ? 'Practice quiz is open.' : 'Practice quiz closed.'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update this quiz.'); }
  }

  if (draft) return <section className="view-enter"><div className="page-heading compact-heading"><div><button className="back-link" onClick={() => setDraft(null)}><ArrowLeft size={15} /> All quizzes</button><h1>{editingId ? 'Edit your quiz' : 'Build a quiz'}</h1><p>Keep each question clear and focused.</p></div><button className="button button-primary" onClick={(event) => void saveQuiz(event as unknown as React.FormEvent)} disabled={saving}>{saving ? 'Saving...' : <><Check size={16} /> Save quiz</>}</button></div>
    <form className="editor-layout" onSubmit={saveQuiz}>
      <div className="editor-main">
        <div className="form-panel"><div className="panel-title"><span className="step-count">01</span><div><h2>Quiz details</h2><p>Give your quiz a name students will recognize.</p></div></div><label className="field"><span>Quiz title</span><input required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Fractions, round one" /></label><div className="field"><span>How will students take it?</span><div className="mode-choice"><button type="button" className={draft.mode === 'LIVE' ? 'chosen' : ''} onClick={() => setDraft({ ...draft, mode: 'LIVE' })}><Radio size={18} /><span><strong>Live classroom</strong><small>One question at a time</small></span>{draft.mode === 'LIVE' && <Check size={16} />}</button><button type="button" className={draft.mode === 'SELF_PACED' ? 'chosen' : ''} onClick={() => setDraft({ ...draft, mode: 'SELF_PACED' })}><Clock3 size={18} /><span><strong>Timed practice</strong><small>Students move at their pace</small></span>{draft.mode === 'SELF_PACED' && <Check size={16} />}</button></div></div>{draft.mode === 'SELF_PACED' && <label className="field short-field"><span>Time limit</span><div className="input-suffix"><input type="number" min={1} max={1440} value={draft.minutes} onChange={(event) => setDraft({ ...draft, minutes: Number(event.target.value) })} /><span>minutes</span></div></label>}<label className="check-row"><input type="checkbox" checked={draft.showResults} onChange={(event) => setDraft({ ...draft, showResults: event.target.checked })} /><span><strong>Show results to students</strong><small>Share scores after submission.</small></span></label></div>
        {draft.questions.map((question, index) => <div className="form-panel question-editor" key={index}><div className="panel-title"><span className="step-count">{String(index + 2).padStart(2, '0')}</span><div><h2>Question {index + 1}</h2><p>One correct answer per question.</p></div>{draft.questions.length > 1 && <button type="button" className="icon-button danger-hover panel-remove" title="Remove question" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, questionIndex) => questionIndex !== index) })}><Trash2 size={16} /></button>}</div><label className="field"><span>Question</span><textarea required maxLength={1000} rows={2} value={question.prompt} onChange={(event) => updateQuestion(index, (value) => ({ ...value, prompt: event.target.value }))} placeholder="Write a question..." /></label><div className="options-heading"><span>Answer options</span><span>Mark the correct answer</span></div><div className="option-editor-list">{question.options.map((option, optionIndex) => <div className={`option-editor ${option.isCorrect ? 'correct-option' : ''}`} key={optionIndex}><button type="button" className={`correct-radio ${option.isCorrect ? 'checked' : ''}`} aria-label={`Mark option ${optionIndex + 1} as correct`} onClick={() => updateQuestion(index, (value) => ({ ...value, options: value.options.map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === optionIndex })) }))}>{option.isCorrect && <Check size={12} />}</button><span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span><input required maxLength={300} value={option.text} onChange={(event) => updateQuestion(index, (value) => ({ ...value, options: value.options.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, text: event.target.value } : item) }))} placeholder={`Option ${optionIndex + 1}`} />{question.options.length > 2 && <button type="button" className="mini-icon" aria-label="Remove option" onClick={() => updateQuestion(index, (value) => ({ ...value, options: value.options.filter((_, itemIndex) => itemIndex !== optionIndex).map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === 0 ? item.isCorrect || !value.options.some((entry) => entry.isCorrect) : item.isCorrect })) }))}><X size={14} /></button>}</div>)}</div><div className="question-footer"><button type="button" className="text-button add-option" disabled={question.options.length >= 8} onClick={() => updateQuestion(index, (value) => ({ ...value, options: [...value.options, { text: '', isCorrect: false }] }))}><Plus size={14} /> Add option</button><label className="marks-field">Points <input type="number" min={1} max={100} value={question.marks} onChange={(event) => updateQuestion(index, (value) => ({ ...value, marks: Number(event.target.value) }))} /></label></div></div>)}
        <button type="button" className="add-question" onClick={() => setDraft({ ...draft, questions: [...draft.questions, emptyQuestion()] })}><span><Plus size={16} /></span> Add another question</button>
      </div>
      <aside className="editor-aside"><div className="aside-note"><span><CircleHelp size={17} /></span><strong>A clear question goes a long way.</strong><p>Keep wording simple, and use answer options that are easy to scan on a phone.</p></div><div className="summary-box"><span className="overline">Quiz summary</span><div><BookOpenCheck size={15} /> {draft.questions.length} question{draft.questions.length === 1 ? '' : 's'}</div><div>{draft.mode === 'LIVE' ? <Radio size={15} /> : <Clock3 size={15} />} {draft.mode === 'LIVE' ? 'Live classroom' : `${draft.minutes} minute timer`}</div></div></aside>
    </form>
  </section>;

  return <section className="view-enter"><div className="page-heading"><div><span className="overline">Prepare, play, reflect</span><h1>Your quizzes.</h1><p>Build a new round or keep an eye on one in progress.</p></div><button className="button button-primary" onClick={() => void startEdit()}><Plus size={17} /> Create a quiz</button></div>
    <div className="manager-grid"><div className="manager-list"><div className="section-heading small-section"><div><h2>Quiz library <span className="heading-count">{quizzes.length}</span></h2><p>All your classroom activities</p></div></div><QuizList quizzes={quizzes} onEdit={(quiz) => void startEdit(quiz)} onSelect={(quiz) => setSelectedQuiz(quiz.id)} onRefresh={refresh} setNotice={setNotice} /></div>
    <div className="live-panel"><div className="live-panel-head"><span className="overline">Classroom monitor</span><span className="live-indicator">{liveQuiz?.status === 'ACTIVE' && liveQuiz.mode === 'LIVE' ? <><i /> Live now</> : 'Ready when you are'}</span></div><label className="field monitor-select"><span>Select a quiz</span><select value={selectedQuiz} onChange={(event) => setSelectedQuiz(event.target.value)}><option value="">Choose a quiz...</option>{quizzes.map((quiz) => <option key={quiz.id} value={quiz.id}>{quiz.title}</option>)}</select><ChevronDown size={15} /></label>{liveQuiz ? <>
      {liveQuiz.mode === 'LIVE' ? <><div className="monitor-question"><div className="monitor-question-meta"><span>QUESTION {String((liveState?.currentQuestionIndex ?? liveQuiz.currentQuestionIndex) + 1).padStart(2, '0')} <span>/ {liveState?.questionCount ?? liveQuiz._count?.questions ?? 0}</span></span><span className="answer-counter"><Users size={13} /> {stats.answered} answered</span></div><h3>{liveState?.question?.prompt ?? liveQuiz.questions?.[liveQuiz.currentQuestionIndex]?.prompt ?? (liveQuiz.status === 'DRAFT' ? 'Start the quiz to reveal question one.' : 'The quiz is complete.')}</h3></div>{liveQuiz.status === 'ACTIVE' && <div className="distribution-list">{(liveState?.question?.options ?? liveQuiz.questions?.[liveQuiz.currentQuestionIndex]?.options ?? []).map((option, index) => { const count = stats.distribution.find((entry) => entry.optionId === option.id)?.count ?? 0; const total = Math.max(1, stats.answered); return <div className="distribution-row" key={option.id ?? index}><div className="distribution-label"><span>{option.text}</span><strong>{count}</strong></div><div className="bar-track"><div className="bar-fill" style={{ width: `${count / total * 100}%` }} /></div></div>; })}{stats.responses.length > 0 && <div className="live-responses"><span className="live-responses-title">Student responses</span>{[...stats.responses].reverse().slice(0, 6).map((response, index) => <div className="live-response" key={`${response.name}-${index}`}><strong>{response.name}</strong><span>{response.text}</span></div>)}</div>}{liveState?.currentAnswerRevealed && <div className="reveal-note"><CheckCircle2 size={15} /> Correct answer is visible to students</div>}</div>}
      <div className="monitor-actions">{liveQuiz.status === 'DRAFT' ? <button className="button button-primary button-wide" onClick={() => void control('start')}><Radio size={16} /> Start live quiz</button> : liveQuiz.status === 'ACTIVE' ? <><button className="button button-secondary" onClick={() => void control(liveState?.currentAnswerRevealed ? 'next' : 'reveal')}>{liveState?.currentAnswerRevealed ? <><ArrowRight size={16} /> Next question</> : <><Eye size={16} /> Reveal answer</>}</button><button className="button button-quiet" onClick={() => void control('stop')}><X size={16} /> End quiz</button></> : <div className="finished-note"><CheckCircle2 size={16} /> This live quiz has finished</div>}</div></> : <div className="timed-monitor"><div className="timed-icon"><Clock3 size={22} /></div><h3>{liveQuiz.title}</h3><p>{Math.round((liveQuiz.timeLimitSeconds ?? 0) / 60)} minutes · {liveQuiz._count?.questions ?? 0} questions</p>{liveQuiz.status === 'DRAFT' ? <button className="button button-primary button-wide" onClick={() => void setTimedStatus(liveQuiz, 'start')}><BookOpenCheck size={16} /> Open practice quiz</button> : liveQuiz.status === 'ACTIVE' ? <button className="button button-quiet button-wide" onClick={() => void setTimedStatus(liveQuiz, 'stop')}><X size={16} /> Close quiz</button> : <span className="finished-note"><CheckCircle2 size={16} /> Practice quiz closed</span>}<button className="text-button monitor-results" onClick={() => document.dispatchEvent(new CustomEvent('open-results', { detail: liveQuiz.id }))}>View student results <ArrowRight size={14} /></button></div>}
    </> : <div className="monitor-empty"><MonitorPlay size={29} /><strong>Your next lesson, at a glance.</strong><p>Choose a quiz to start a live round or open timed practice.</p></div>}</div></div>
  </section>;
}

function StudentManager({ students, refresh, setNotice }: { students: Student[]; refresh: () => Promise<void>; setNotice: (text: string) => void }) {
  const [name, setName] = useState('');
  const [createdPasskey, setCreatedPasskey] = useState('');
  const [creating, setCreating] = useState(false);
  async function addStudent(event: React.FormEvent) {
    event.preventDefault(); setCreating(true);
    try { const data = await api<{ passkey: string }>('/api/students', { method: 'POST', body: JSON.stringify({ name }) }); setCreatedPasskey(data.passkey); setName(''); await refresh(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to add student.'); }
    finally { setCreating(false); }
  }
  async function updateStudent(student: Student, action: 'disable' | 'enable' | 'reset') {
    try {
      const data = await api<{ passkey?: string }>(`/api/students/${student.id}`, { method: 'PATCH', body: JSON.stringify(action === 'reset' ? { resetPasskey: true } : { active: action === 'enable' }) });
      if (data.passkey) setCreatedPasskey(data.passkey);
      setNotice(action === 'reset' ? 'New passkey created. Share it with the student.' : `Student ${action === 'disable' ? 'disabled' : 'enabled'}.`);
      await refresh();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update student.'); }
  }
  async function renameStudent(student: Student) {
    const name = window.prompt('Student name', student.name)?.trim();
    if (!name || name === student.name) return;
    try { await api(`/api/students/${student.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await refresh(); setNotice('Student name updated.'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to update student name.'); }
  }
  async function removeStudent(student: Student) {
    if (!window.confirm(`Remove ${student.name} and their attempt history?`)) return;
    try { await api(`/api/students/${student.id}`, { method: 'DELETE' }); await refresh(); setNotice('Student removed.'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Unable to remove student.'); }
  }
  return <section className="view-enter"><div className="page-heading"><div><span className="overline">Your people</span><h1>Students.</h1><p>Passkeys make it easy to join, no accounts to remember.</p></div><span className="student-total"><Users size={16} /> {students.length} students</span></div>
    <div className="student-layout"><div className="roster-panel"><div className="panel-heading"><div><h2>Class roster</h2><p>Manage student access and passkeys</p></div><button className="icon-button" title="Refresh students" onClick={() => void refresh()}><RefreshCw size={16} /></button></div>{students.length ? <div className="roster-list">{students.map((student, index) => <div className={`roster-row ${!student.active ? 'inactive-row' : ''}`} key={student.id}><div className={`avatar avatar-roster avatar-color-${index % 4}`}>{student.name.slice(0, 1).toUpperCase()}</div><div className="roster-name"><strong>{student.name}</strong><span>{student._count.attempts} quiz attempts · {student.active ? 'Active' : 'Access paused'}</span></div><div className="roster-actions"><button className="icon-button" title="Edit student name" aria-label={`Edit ${student.name}`} onClick={() => void renameStudent(student)}><Pencil size={15} /></button><button className="icon-button" title="Create a new passkey" aria-label={`Reset ${student.name}'s passkey`} onClick={() => void updateStudent(student, 'reset')}><RefreshCw size={15} /></button><button className="icon-button" title={student.active ? 'Pause access' : 'Restore access'} aria-label={`${student.active ? 'Disable' : 'Enable'} ${student.name}`} onClick={() => void updateStudent(student, student.active ? 'disable' : 'enable')}>{student.active ? <EyeOff size={15} /> : <Eye size={15} />}</button><button className="icon-button danger-hover" title="Remove student" aria-label={`Remove ${student.name}`} onClick={() => void removeStudent(student)}><Trash2 size={15} /></button></div></div>)}</div> : <div className="roster-empty">No students yet. Add your first student to get started.</div>}</div>
      <aside className="add-student-panel"><span className="overline">Add to your class</span><h2>A name and a passkey.</h2><p>We’ll create a unique code they can use to join any active quiz.</p><form onSubmit={addStudent} className="form-stack"><label className="field"><span>Student name</span><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Maya Chen" /></label><button className="button button-primary button-wide" disabled={creating}>{creating ? 'Creating...' : <><Plus size={16} /> Add student</>}</button></form>{createdPasskey && <div className="passkey-reveal"><span>Share this passkey</span><strong>{createdPasskey}</strong><small>Shown once. Reset it here if it gets lost.</small><button className="text-button" onClick={() => { void navigator.clipboard?.writeText(createdPasskey); setNotice('Passkey copied.'); }}>Copy passkey <Download size={14} /></button></div>}<div className="privacy-callout"><ShieldCheck size={16} /><span>Passkeys are private to each student. Their answers are never shown to other students.</span></div></aside>
    </div>
  </section>;
}

function ResultsPanel({ quizzes, selectedQuiz, setSelectedQuiz, results, distribution, onExport }: { quizzes: Quiz[]; selectedQuiz: string; setSelectedQuiz: (id: string) => void; results: Result[]; distribution: { question: string; options: { text: string; correct: boolean; count: number }[] }[]; onExport: () => void }) {
  const quiz = quizzes.find((entry) => entry.id === selectedQuiz);
  const submitted = results.filter((result) => result.status === 'SUBMITTED');
  const average = submitted.length ? Math.round(submitted.reduce((sum, result) => sum + (result.score ?? 0) / Math.max(1, result.totalMarks) * 100, 0) / submitted.length) : 0;
  const [expanded, setExpanded] = useState('');
  return <section className="view-enter"><div className="page-heading"><div><span className="overline">What your class knows</span><h1>Results.</h1><p>Scores, individual answers and question-by-question patterns.</p></div><div className="result-heading-actions"><label className="select-wrap"><select value={selectedQuiz} onChange={(event) => setSelectedQuiz(event.target.value)}><option value="">Choose a quiz...</option>{quizzes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={15} /></label><button className="button button-secondary" onClick={onExport} disabled={!results.length}><Download size={16} /> Export CSV</button></div></div>{quiz ? <><div className="results-metrics"><Metric label="Students started" value={results.length} icon={<Users size={17} />} tint="sage" /><Metric label="Submitted" value={submitted.length} icon={<CheckCircle2 size={17} />} tint="blue" /><Metric label="Class average" value={`${average}%`} icon={<BarChart3 size={17} />} tint="coral" /></div><div className="results-layout"><div className="results-table-panel"><div className="panel-heading"><div><h2>Student scores</h2><p>{quiz.title} · {results.length} participants</p></div></div>{results.length ? <div className="results-list">{results.map((result, index) => <div className="result-student" key={result.id}><button className="result-summary" onClick={() => setExpanded(expanded === result.id ? '' : result.id)}><span className={`avatar avatar-roster avatar-color-${index % 4}`}>{result.name.slice(0, 1).toUpperCase()}</span><span className="result-name"><strong>{result.name}</strong><small>{result.status === 'SUBMITTED' ? 'Submitted' : 'In progress'}</small></span><strong className="result-score">{result.score === null ? '—' : `${result.score} / ${result.totalMarks}`}</strong><ChevronDown size={16} className={expanded === result.id ? 'rotate-chevron' : ''} /></button>{expanded === result.id && <div className="answer-review">{result.answers.length ? result.answers.map((answer, answerIndex) => <div className="answer-review-row" key={answerIndex}><span className={`answer-mark ${answer.correct ? 'mark-correct' : 'mark-wrong'}`}>{answer.correct ? <Check size={13} /> : <X size={13} />}</span><div><strong>{answer.question}</strong><span>{answer.response} · {answer.correct ? `${answer.marks} point${answer.marks === 1 ? '' : 's'}` : 'Incorrect'}</span></div></div>) : <span className="muted">No answers saved.</span>}</div>}</div>)}</div> : <div className="roster-empty">No one has joined this quiz yet.</div>}</div><div className="distribution-panel"><div className="panel-heading"><div><h2>Answer patterns</h2><p>Responses across the class</p></div></div>{distribution.length ? distribution.map((question, index) => { const count = question.options.reduce((sum, option) => sum + option.count, 0); return <div className="result-distribution" key={index}><div className="result-distribution-title"><span>Q{index + 1}</span><strong>{question.question}</strong></div>{question.options.map((option, optionIndex) => <div className="result-option" key={optionIndex}><div><span>{option.text}</span><strong>{option.count}</strong></div><div className="bar-track"><div className={`bar-fill ${option.correct ? 'bar-correct' : ''}`} style={{ width: `${count ? option.count / count * 100 : 0}%` }} /></div></div>)}</div>; }) : <div className="roster-empty">Question patterns will appear here.</div>}</div></div></> : <div className="empty-state"><span className="empty-icon"><BarChart3 size={22} /></span><h3>Choose a quiz to see its story.</h3><p>Individual scores and response patterns will appear here.</p></div>}</section>;
}

function StudentApp({ user, onSignOut, notice, setNotice }: { user: User; onSignOut: () => void; notice: string; setNotice: (text: string) => void }) {
  const [quizzes, setQuizzes] = useState<StudentQuiz[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<ActiveQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const submittedRef = useRef(false);

  async function loadQuizzes() {
    setLoading(true);
    try { const data = await api<{ quizzes: StudentQuiz[] }>('/api/student/quizzes'); setQuizzes(data.quizzes); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load quizzes.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadQuizzes(); }, []);
  useEffect(() => {
    if (activeQuiz) return;
    const timer = window.setInterval(() => {
      void api<{ quizzes: StudentQuiz[] }>('/api/student/quizzes').then((data) => setQuizzes(data.quizzes)).catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeQuiz?.id]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(''), 3000); return () => window.clearTimeout(timer); } }, [notice]);

  async function joinQuiz(quizId: string) {
    setError('');
    try {
      const data = await api<{ quiz: ActiveQuiz }>(`/api/student/quizzes/${quizId}`);
      setActiveQuiz(data.quiz);
      setAnswers(Object.fromEntries((data.quiz.attempt?.answers ?? []).map((answer) => [answer.questionId, answer.optionId])));
      setQuestionIndex(data.quiz.currentQuestionIndex);
      submittedRef.current = data.quiz.attempt?.status === 'SUBMITTED';
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to join this quiz.'); }
  }

  useEffect(() => {
    if (!activeQuiz || activeQuiz.status !== 'ACTIVE') return;
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('watch:quiz', activeQuiz.id));
    socket.on('quiz:state', (state: { status: Status; currentQuestionIndex: number; currentAnswerRevealed: boolean; question: Question | null }) => {
      if (activeQuiz.mode === 'LIVE') setActiveQuiz((current) => current ? { ...current, status: state.status, currentQuestionIndex: state.currentQuestionIndex, currentAnswerRevealed: state.currentAnswerRevealed, questions: state.question ? [state.question] : [] } : current);
      if (state.status === 'CLOSED') {
        void api<{ quiz: ActiveQuiz }>(`/api/student/quizzes/${activeQuiz.id}`).then(({ quiz }) => {
          setActiveQuiz(quiz);
          submittedRef.current = quiz.attempt?.status === 'SUBMITTED';
        }).catch(() => undefined);
        void loadQuizzes();
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [activeQuiz?.id, activeQuiz?.status]);

  useEffect(() => {
    if (!activeQuiz?.attempt?.deadlineAt || activeQuiz.attempt.status !== 'IN_PROGRESS') { setRemaining(null); return; }
    const update = () => setRemaining(Math.max(0, Math.ceil((new Date(activeQuiz.attempt!.deadlineAt!).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeQuiz?.attempt?.deadlineAt, activeQuiz?.attempt?.status]);

  const currentQuestion = activeQuiz?.mode === 'LIVE' ? activeQuiz.questions[0] : activeQuiz?.questions[questionIndex];
  const isSubmitted = activeQuiz?.attempt?.status === 'SUBMITTED';

  async function saveAnswer(questionId: string, optionId: string) {
    if (!activeQuiz || isSubmitted) return;
    setAnswers((current) => ({ ...current, [questionId]: optionId }));
    setSaving(true);
    try { await api(`/api/student/quizzes/${activeQuiz.id}/answers`, { method: 'PUT', body: JSON.stringify({ questionId, optionId }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Your answer could not be saved.'); }
    finally { setSaving(false); }
  }

  async function submitQuiz() {
    if (!activeQuiz || submitting || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const data = await api<{ score: number | null }>(`/api/student/quizzes/${activeQuiz.id}/submit`, { method: 'POST' });
      setActiveQuiz((current) => current ? { ...current, attempt: current.attempt ? { ...current.attempt, status: 'SUBMITTED', score: data.score, submittedAt: new Date().toISOString() } : null } : current);
      await loadQuizzes();
    } catch (cause) { submittedRef.current = false; setError(cause instanceof Error ? cause.message : 'Unable to submit your quiz.'); }
    finally { setSubmitting(false); }
  }

  useEffect(() => { if (remaining === 0 && activeQuiz?.mode === 'SELF_PACED' && !isSubmitted) void submitQuiz(); }, [remaining, activeQuiz?.mode, isSubmitted]);

  if (activeQuiz) {
    const questionList = activeQuiz.questions;
    const total = activeQuiz.mode === 'LIVE' ? Math.max(activeQuiz.currentQuestionIndex + 1, questionList.length) : questionList.length;
    return <main className="student-shell"><header className="student-topbar"><div className="student-brand"><span className="brand-mark"><BookOpenCheck size={18} /></span><span>LiveQuiz</span></div><div className="student-top-right"><span className="student-name"><span className="avatar avatar-small">{user.name?.slice(0, 1).toUpperCase()}</span>{user.name}</span><button className="icon-button" title="Leave quiz" aria-label="Leave quiz" onClick={() => { setActiveQuiz(null); void loadQuizzes(); }}><LogOut size={16} /></button></div></header>
      <div className="student-quiz-wrap">{isSubmitted ? <div className="submitted-card"><div className="submitted-icon"><Check size={26} /></div><span className="overline">All done</span><h1>Nice work, {user.name?.split(' ')[0]}.</h1><p>Your answers have been sent to your teacher.</p>{activeQuiz.showResults && activeQuiz.attempt?.score !== null && activeQuiz.attempt?.score !== undefined && <div className="score-display"><strong>{activeQuiz.attempt.score}</strong><span>points</span></div>}<button className="button button-secondary" onClick={() => { setActiveQuiz(null); void loadQuizzes(); }}>Back to classroom <ArrowRight size={15} /></button></div> : activeQuiz.status === 'CLOSED' && activeQuiz.mode === 'LIVE' ? <div className="submitted-card"><div className="submitted-icon"><Check size={26} /></div><span className="overline">That’s a wrap</span><h1>Quiz complete.</h1><p>Your teacher has finished this live round.</p><button className="button button-secondary" onClick={() => { setActiveQuiz(null); void loadQuizzes(); }}>Back to classroom <ArrowRight size={15} /></button></div> : <>
        <div className="student-quiz-heading"><div><span className="overline">{activeQuiz.mode === 'LIVE' ? <><i className="live-dot" /> Live classroom</> : 'Self-paced practice'}</span><h1>{activeQuiz.title}</h1></div>{activeQuiz.mode === 'SELF_PACED' && <div className={`timer-chip ${remaining !== null && remaining < 60 ? 'timer-warning' : ''}`}><Clock3 size={16} /><span>{remaining === null ? '--:--' : `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`}</span></div>}</div>
        <div className="student-progress"><span>Question {activeQuiz.mode === 'LIVE' ? activeQuiz.currentQuestionIndex + 1 : questionIndex + 1} <i>of {activeQuiz.mode === 'LIVE' ? total : questionList.length}</i></span><div className="progress-track"><div style={{ width: `${(activeQuiz.mode === 'LIVE' ? (activeQuiz.currentQuestionIndex + 1) / total : (questionIndex + 1) / questionList.length) * 100}%` }} /></div><span className="saved-label">{saving ? 'Saving...' : answers[currentQuestion?.id ?? ''] ? 'Answer saved' : 'Not answered'}</span></div>
        {currentQuestion ? <div className="student-question-card"><div className="question-card-top"><span>QUESTION {String(activeQuiz.mode === 'LIVE' ? activeQuiz.currentQuestionIndex + 1 : questionIndex + 1).padStart(2, '0')}</span><span>{currentQuestion.marks} point{currentQuestion.marks === 1 ? '' : 's'}</span></div><h2>{currentQuestion.prompt}</h2><div className="student-options">{currentQuestion.options.map((option, index) => { const chosen = answers[currentQuestion.id ?? ''] === option.id; const correct = Boolean(option.isCorrect); return <button key={option.id ?? index} className={`student-option ${chosen ? 'option-selected' : ''} ${activeQuiz.currentAnswerRevealed && correct ? 'option-revealed' : ''}`} onClick={() => void saveAnswer(currentQuestion.id!, option.id!)} disabled={activeQuiz.currentAnswerRevealed || saving}><span className="student-option-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span>{chosen && <span className="option-check"><Check size={15} /></span>}{activeQuiz.currentAnswerRevealed && correct && <span className="correct-label">Correct</span>}</button>; })}</div>{activeQuiz.currentAnswerRevealed && <div className="answer-revealed-note"><CheckCircle2 size={15} /> Your teacher revealed the answer</div>}</div> : <div className="waiting-card"><div className="waiting-pulse"><Radio size={22} /></div><h2>You're in.</h2><p>Your teacher will bring up the first question in a moment.</p><span className="waiting-label"><i /> Waiting for the teacher</span></div>}
        {activeQuiz.mode === 'SELF_PACED' ? <><div className="question-jump"><span>Jump to</span>{questionList.map((question, index) => <button className={`${questionIndex === index ? 'jump-current' : ''} ${answers[question.id ?? ''] ? 'jump-answered' : ''}`} key={question.id ?? index} onClick={() => setQuestionIndex(index)}>{index + 1}</button>)}<span className="jump-legend"><i /> Answered</span></div><div className="student-nav"><button className="button button-secondary" onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} disabled={questionIndex === 0}><ArrowLeft size={16} /> Previous</button>{questionIndex < questionList.length - 1 ? <button className="button button-primary" onClick={() => setQuestionIndex(Math.min(questionList.length - 1, questionIndex + 1))}>Next question <ArrowRight size={16} /></button> : <button className="button button-primary" onClick={() => void submitQuiz()} disabled={submitting || saving}>{submitting ? 'Submitting...' : <>Submit quiz <Send size={15} /></>}</button>}</div></> : <div className="live-student-footer"><span><i className="live-dot" /> Your teacher controls the next question</span><span>Your answer is saved automatically</span></div>}
      </>}{error && <div className="inline-error student-error" role="alert">{error}<button onClick={() => setError('')}><X size={14} /></button></div>}</div><footer className="student-footer">Take a breath. You’ve got this.</footer></main>;
  }

  return <main className="student-home"><header className="student-topbar"><div className="student-brand"><span className="brand-mark"><BookOpenCheck size={18} /></span><span>LiveQuiz</span></div><div className="student-top-right"><span className="student-name"><span className="avatar avatar-small">{user.name?.slice(0, 1).toUpperCase()}</span>{user.name}</span><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div></header><section className="student-home-content"><div className="student-welcome"><div><span className="overline">Your classroom</span><h1>Hi, {user.name?.split(' ')[0]}.</h1><p>Ready to give it a go?</p></div><div className="welcome-mark"><Sparkles size={25} /></div></div>{error && <div className="inline-error">{error}</div>}{loading ? <div className="student-loading"><RefreshCw size={17} className="spin" /> Looking for an open quiz...</div> : quizzes.length ? <div className="student-quiz-list"><div className="section-heading"><div><h2>Open quizzes</h2><p>Your teacher has something ready for you</p></div><button className="icon-button" title="Refresh quizzes" onClick={() => void loadQuizzes()}><RefreshCw size={16} /></button></div>{quizzes.map((quiz) => <button className="student-quiz-tile" key={quiz.id} onClick={() => void joinQuiz(quiz.id)}><span className={`quiz-mode-icon ${quiz.mode === 'LIVE' ? 'mode-live' : 'mode-timed'}`}>{quiz.mode === 'LIVE' ? <Radio size={20} /> : <Clock3 size={20} />}</span><span className="student-tile-copy"><strong>{quiz.title}</strong><span>{quiz.mode === 'LIVE' ? 'Live classroom · Teacher-led' : `${Math.round((quiz.timeLimitSeconds ?? 0) / 60)} minutes · Self-paced`}</span></span><span className="tile-start">{quiz.attempt?.status === 'IN_PROGRESS' ? 'Continue' : 'Join'} <ArrowRight size={15} /></span></button>)}</div> : <div className="student-waiting-home"><div className="waiting-pulse"><BookOpenCheck size={22} /></div><h2>No open quizzes just yet.</h2><p>When your teacher opens a quiz, it will appear here. You can leave this page open.</p><button className="button button-secondary" onClick={() => void loadQuizzes()}><RefreshCw size={15} /> Check again</button></div>}<div className="student-home-tip"><ShieldCheck size={16} /> Your work is private and saved as you go.</div></section></main>;
}

export default App;
