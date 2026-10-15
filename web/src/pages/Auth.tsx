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
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false);
  const f = useForm(async () => { await api('/auth/forgot', { json: { email } }); setSent(true); });
  return <Shell title="Reset your password">
    {sent ? <div className="stack"><p>If that email is registered, a reset link has been created.</p>
      <p className="notice">Email delivery isn't set up yet on this server, so the link isn't emailed. Ask the site admin — they can see pending reset links in the Admin page.</p></div>
      : <form className="stack" onSubmit={f.submit}><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {f.err && <p className="error">{f.err}</p>}<button className="btn primary block" disabled={f.busy}>Get reset link</button></form>}
    <p className="center"><Link to="/login">Back to log in</Link></p>
  </Shell>;
}

export function Reset() {
  const [sp] = useSearchParams(); const nav = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const f = useForm(async () => { if (pw !== pw2) throw new Error('Passwords do not match'); await api('/auth/reset', { json: { token: sp.get('token') || '', password: pw } }); nav('/login'); alert('Password changed. Please log in.'); });
  return <Shell title="Choose a new password">
    <form className="stack" onSubmit={f.submit}>
      <label>New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" /></label>
      <label>Confirm password<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} minLength={8} required autoComplete="new-password" /></label>
      {f.err && <p className="error">{f.err}</p>}<button className="btn primary block" disabled={f.busy}>Save password</button>
    </form>
  </Shell>;
}
