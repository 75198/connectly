import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, looksLikePhone } from '../api';
import { brand } from '../brand';
import { useSession } from '../session';
import { Logo } from '../components/ui';
import { IdentifierInput } from '../components/Identifier';

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="authpage"><div className="authhero"><Logo size={56} /><p>{brand.tagline}</p></div><div className="card authcard"><h1>{title}</h1>{children}</div></div>;
}
function useForm(fn: () => Promise<void>) {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e?: FormEvent) => { e?.preventDefault(); setErr(''); setBusy(true); try { await fn(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } };
  return { err, busy, submit };
}
export function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className="codeinput" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="••••••" aria-label="6-digit code" autoFocus required />;
}

export function Login() {
  const { refresh } = useSession(); const nav = useNavigate();
  const [login, setLogin] = useState(''); const [country, setCountry] = useState('NG'); const [password, setPassword] = useState('');
  const f = useForm(async () => {
    try { await api('/auth/login', { json: { login, password, country } }); }
    catch (e) { if (e instanceof ApiError && e.status === 403) { nav(`/signup?verify=${encodeURIComponent(login)}&country=${country}`); return; } throw e; }
    await refresh(); nav('/');
  });
  return <AuthShell title="Log in">
    <form className="stack" onSubmit={f.submit}>
      <IdentifierInput value={login} onChange={setLogin} country={country} onCountry={setCountry} autoFocus />
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {f.err && <p className="error" role="alert">{f.err}</p>}
      <button className="btn primary block" disabled={f.busy}>{f.busy ? 'Logging in…' : 'Log in'}</button>
    </form>
    <p className="center"><Link to="/forgot">Forgot password?</Link></p><hr />
    <p className="center">New to {brand.name}? <Link to="/signup">Create an account</Link></p>
  </AuthShell>;
}

export function Forgot() {
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState(''); const [country, setCountry] = useState('NG'); const [step, setStep] = useState<'id' | 'code'>('id');
  const [code, setCode] = useState(''); const [pw, setPw] = useState(''); const [info, setInfo] = useState('');
  const send = useForm(async () => { await api('/auth/forgot', { json: { identifier, country } }); setStep('code'); setInfo(`If an account exists for ${identifier}, we’ve sent a 6-digit code.`); });
  const reset = useForm(async () => { await api('/auth/reset', { json: { identifier, country, code, password: pw } }); alert('Password changed. Please log in.'); nav('/login'); });
  return <AuthShell title="Reset your password">
    {step === 'id' ? <form className="stack" onSubmit={send.submit}>
      <IdentifierInput value={identifier} onChange={setIdentifier} country={country} onCountry={setCountry} autoFocus />
      {looksLikePhone(identifier) && <p className="hint">Phone reset needs SMS, which isn’t available yet. Use your email if you have one.</p>}
      {send.err && <p className="error" role="alert">{send.err}</p>}<button className="btn primary block" disabled={send.busy}>Send code</button></form>
    : <form className="stack" onSubmit={reset.submit}>
      <p className="meta">{info}</p>
      <label>6-digit code<CodeInput value={code} onChange={setCode} /></label>
      <label>New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" /></label>
      {reset.err && <p className="error" role="alert">{reset.err}</p>}
      <button className="btn primary block" disabled={reset.busy || code.length !== 6 || pw.length < 8}>Change password</button>
      <button type="button" className="linkish" onClick={() => send.submit()}>Send a new code</button>
      {send.err && <p className="error">{send.err}</p>}
    </form>}
    <p className="center"><Link to="/login">Back to log in</Link></p>
  </AuthShell>;
}
