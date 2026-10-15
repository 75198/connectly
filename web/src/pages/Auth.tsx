import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { brand } from '../brand';
import { useSession } from '../session';
import { Logo } from '../components/ui';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="authpage"><div className="authhero"><Logo size={56} /><p>{brand.tagline}</p></div><div className="card authcard"><h1>{title}</h1>{children}</div></div>;
}
function useForm(fn: () => Promise<void>) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(''); setBusy(true); try { await fn(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  return { err, busy, submit };
}

export function Login() {
  const { refresh } = useSession(); const nav = useNavigate();
  const [login, setLogin] = useState(''); const [password, setPassword] = useState('');
  const f = useForm(async () => { await api('/auth/login', { json: { login, password } }); await refresh(); nav('/'); });
  return <Shell title="Log in">
    <form className="stack" onSubmit={f.submit}>
      <label>Username or email<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {f.err && <p className="error">{f.err}</p>}
      <button className="btn primary block" disabled={f.busy}>{f.busy ? 'Logging in…' : 'Log in'}</button>
    </form>
    <p className="center"><Link to="/forgot">Forgot password?</Link></p><hr />
    <p className="center">New to {brand.name}? <Link to="/register">Create an account</Link></p>
  </Shell>;
}

export function Register() {
  const { refresh } = useSession(); const nav = useNavigate();
  const [d, setD] = useState({ username: '', display_name: '', email: '', password: '' });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const f = useForm(async () => { await api('/auth/register', { json: d }); await refresh(); nav('/'); });
  return <Shell title="Create your account">
    <form className="stack" onSubmit={f.submit}>
      <label>Display name<input value={d.display_name} onChange={set('display_name')} maxLength={50} required autoComplete="name" /></label>
      <label>Username<input value={d.username} onChange={set('username')} pattern="[A-Za-z0-9_]{3,20}" title="3-20 letters, numbers or _" required autoCapitalize="none" autoComplete="username" /></label>
      <label>Email<input type="email" value={d.email} onChange={set('email')} required autoComplete="email" /></label>
      <label>Password<input type="password" value={d.password} onChange={set('password')} minLength={8} required autoComplete="new-password" /><small className="meta">At least 8 characters</small></label>
      {f.err && <p className="error">{f.err}</p>}
      <button className="btn primary block" disabled={f.busy}>{f.busy ? 'Creating…' : 'Sign up'}</button>
    </form>
    <p className="center">Already have an account? <Link to="/login">Log in</Link></p>
  </Shell>;
}

export function Forgot() {
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState(''); const [pw, setPw] = useState(''); const [info, setInfo] = useState('');
  const send = useForm(async () => { await api('/auth/forgot', { json: { email } }); setStep('code'); setInfo(`If ${email} is registered, we've emailed a 6-digit code.`); });
  const reset = useForm(async () => { await api('/auth/reset', { json: { email, code, password: pw } }); alert('Password changed. Please log in.'); nav('/login'); });
  return <Shell title="Reset your password">
    {step === 'email' ? <form className="stack" onSubmit={send.submit}>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
      {send.err && <p className="error">{send.err}</p>}<button className="btn primary block" disabled={send.busy}>Send code</button></form>
    : <form className="stack" onSubmit={reset.submit}>
      <p className="meta">{info}</p>
      <label>6-digit code<CodeInput value={code} onChange={setCode} /></label>
      <label>New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" /></label>
      {reset.err && <p className="error">{reset.err}</p>}
      <button className="btn primary block" disabled={reset.busy || code.length !== 6}>Change password</button>
      <button type="button" className="linkish" onClick={() => send.submit({ preventDefault() {} } as any)}>Send a new code</button>
      {send.err && <p className="error">{send.err}</p>}
    </form>}
    <p className="center"><Link to="/login">Back to log in</Link></p>
  </Shell>;
}

export function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="codeinput" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="••••••" required />;
}

export function Verify() {
  const { me, refresh, logout } = useSession();
  const [code, setCode] = useState(''); const [msg, setMsg] = useState('');
  const verify = useForm(async () => { await api('/auth/verify', { json: { code } }); await refresh(); });
  const resend = useForm(async () => { setMsg(''); await api('/auth/resend-verification', { method: 'POST' }); setMsg('A new code is on its way.'); });
  return <Shell title="Verify your email">
    <form className="stack" onSubmit={verify.submit}>
      <p>We sent a 6-digit code to <b>{me?.email}</b>. Enter it below to activate your account. The code expires in 10 minutes.</p>
      <CodeInput value={code} onChange={setCode} />
      {verify.err && <p className="error">{verify.err}</p>}
      <button className="btn primary block" disabled={verify.busy || code.length !== 6}>{verify.busy ? 'Checking…' : 'Verify'}</button>
    </form>
    <p className="center"><button className="linkish" disabled={resend.busy} onClick={resend.submit as any}>Resend code</button></p>
    {resend.err && <p className="error center">{resend.err}</p>}{msg && <p className="success center">{msg}</p>}
    <hr /><p className="center meta">Wrong email? <button className="linkish" onClick={logout}>Log out</button> and sign up again.</p>
  </Shell>;
}
