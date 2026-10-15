import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, looksLikePhone } from '../api';
import { brand } from '../brand';
import { useSession } from '../session';
import { Avatar, Logo } from '../components/ui';
import { IdentifierInput } from '../components/Identifier';

// Full-screen white page with the logo centred at the top (signup + onboarding), with a slide between steps.
export function FlowShell({ stepKey, back, children }: { stepKey: string | number; back?: boolean; children: React.ReactNode }) {
  return <div className="flow"><header className="flowlogo"><img src={brand.logoUrl} width={52} height={52} alt={brand.name} /><i className="flowline" aria-hidden /></header>
    <main key={stepKey} className={`flowstep ${back ? 'slide-back' : 'slide-fwd'}`}>{children}</main></div>;
}
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

type Saved = { id: number; username: string; full_name: string; avatar_path: string | null };
function SavedAccounts() {
  const { refresh } = useSession(); const nav = useNavigate();
  const [items, setItems] = useState<Saved[]>([]); const [err, setErr] = useState('');
  useEffect(() => { api<{ items: Saved[] }>('/auth/saved').then((r) => setItems(r.items)).catch(() => {}); }, []);
  if (!items.length) return null;
  return <div className="stack savedaccts"><p className="meta">Saved on this device</p>
    {items.map((a) => <div key={a.id} className="hubrow card">
      <button className="person grow plain" onClick={async () => { setErr(''); try { await api('/auth/saved/login', { json: { user_id: a.id } }); await refresh(); nav('/'); } catch (e: any) { setErr(e.message); setItems((x) => x.filter((y) => y.id !== a.id)); } }}>
        <Avatar user={a} size={44} /><span><b>{a.full_name}</b><small className="meta">@{a.username}</small></span></button>
      <button className="btn icon ghost" aria-label={`Remove ${a.full_name} from this device`} onClick={async () => { await api(`/auth/saved/${a.id}`, { method: 'DELETE' }); setItems((x) => x.filter((y) => y.id !== a.id)); }}>×</button>
    </div>)}
    {err && <p className="error">{err}</p>}<hr /></div>;
}

export function Login() {
  const { refresh } = useSession(); const nav = useNavigate();
  const [sp] = useSearchParams();
  const [login, setLogin] = useState(sp.get('u') || ''); const [country, setCountry] = useState('NG'); const [password, setPassword] = useState('');
  const [two, setTwo] = useState<{ ticket: string; methods: string[]; email_hint: string | null } | null>(null); const [method, setMethod] = useState('totp'); const [code2, setCode2] = useState('');
  const f = useForm(async () => {
    if (two) { await api('/auth/login/two-step', { json: { ticket: two.ticket, method, code: code2 } }); await refresh(); nav('/'); return; }
    try { const r = await api<{ reactivated?: boolean; two_step?: boolean; ticket: string; methods: string[]; email_hint: string | null }>('/auth/login', { json: { login, password, country } });
      if (r.two_step) { setTwo(r); setMethod(r.methods.includes('totp') ? 'totp' : 'email'); return; }
      if (r.reactivated) alert('Welcome back! Your account has been reactivated.'); }
    catch (e) { if (e instanceof ApiError && e.status === 403) { nav(`/signup?verify=${encodeURIComponent(login)}&country=${country}`); return; } throw e; }
    await refresh(); nav('/');
  });
  if (two) return <AuthShell title="Confirm it’s you">
    <form className="stack" onSubmit={f.submit}>
      <p className="meta">{method === 'totp' ? 'Enter the 6-digit code from your authenticator app.' : `We sent a code to ${two.email_hint}.`}</p>
      <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code2} onChange={(e) => setCode2(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="6-digit code" placeholder="6-digit code" className="codefield" />
      {f.err && <p className="error" role="alert">{f.err}</p>}
      <button className="btn primary block" disabled={f.busy || code2.length !== 6}>{f.busy ? 'Checking…' : 'Continue'}</button>
      {two.methods.length > 1 && <button type="button" className="linkish" onClick={() => { setMethod(method === 'totp' ? 'email' : 'totp'); setCode2(''); }}>{method === 'totp' ? 'Use an email code instead' : 'Use my authenticator app instead'}</button>}
      {method === 'email' && <button type="button" className="linkish" onClick={() => api('/auth/login/two-step/resend', { json: { ticket: two.ticket } }).then(() => alert('New code sent')).catch((e) => alert(e.message))}>Send a new code</button>}
      <button type="button" className="linkish" onClick={() => { setTwo(null); setCode2(''); }}>Back to log in</button>
    </form></AuthShell>;
  return <AuthShell title="Log in">
    <SavedAccounts />
    <form className="stack" onSubmit={f.submit}>
      <IdentifierInput value={login} onChange={setLogin} country={country} onCountry={setCountry} autoFocus />
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {f.err && <p className="error" role="alert">{f.err}</p>}
      <button className="btn primary block" disabled={f.busy}>{f.busy ? 'Logging in…' : 'Log in'}</button>
    </form>
    <p className="center"><Link to="/forgot">Forgot password?</Link> · <Link to="/find">Find your account</Link></p><hr />
    <p className="center">New to {brand.name}? <Link to="/signup">Create an account</Link></p>
  </AuthShell>;
}

type Acct = { id: number; username: string; full_name: string; avatar_path: string | null; deactivated: boolean };
// Shared by "Forgot password" and "Find your account": send code -> enter code -> list accounts.
function CodeAccounts({ purpose, title, intro, allowUsername }: { purpose: 'reset_password' | 'find_account'; title: string; intro: string; allowUsername?: boolean }) {
  const nav = useNavigate();
  const [identifier, setIdentifier] = useState(''); const [country, setCountry] = useState('NG');
  const [step, setStep] = useState<'id' | 'code' | 'pick' | 'password'>('id');
  const [code, setCode] = useState(''); const [info, setInfo] = useState('');
  const [data, setData] = useState<{ ticket: string; sent_to: string; login_identifier: string; accounts: Acct[] } | null>(null);
  const [chosen, setChosen] = useState<Acct | null>(null); const [pw, setPw] = useState('');
  const send = useForm(async () => { const r = await api<{ message: string }>(purpose === 'reset_password' ? '/auth/forgot' : '/auth/find', { json: { identifier, country } }); setInfo(r.message); setStep('code'); });
  const check = useForm(async () => {
    const r = await api<typeof data>('/auth/code-accounts', { json: { identifier, country, code, purpose } });
    setData(r); if (purpose === 'reset_password' && r!.accounts.length === 1) { setChosen(r!.accounts[0]); setStep('password'); } else setStep('pick');
  });
  const reset = useForm(async () => { await api('/auth/reset', { json: { ticket: data!.ticket, user_id: chosen!.id, password: pw } }); alert('Password changed. Please log in.'); nav('/login'); });
  return <AuthShell title={title}>
    {step === 'id' && <form className="stack" onSubmit={send.submit}>
      <p className="meta">{intro}</p>
      {allowUsername
        ? <label>Email, phone number or username<input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus maxLength={200} /></label>
        : <IdentifierInput value={identifier} onChange={setIdentifier} country={country} onCountry={setCountry} autoFocus />}
      {send.err && <p className="error" role="alert">{send.err}</p>}<button className="btn primary block" disabled={send.busy || !identifier}>Send code</button></form>}
    {step === 'code' && <form className="stack" onSubmit={check.submit}>
      <p className="meta">{info}</p>
      <label>6-digit code<CodeInput value={code} onChange={setCode} /></label>
      {check.err && <p className="error" role="alert">{check.err}</p>}
      <button className="btn primary block" disabled={check.busy || code.length !== 6}>Continue</button>
      <button type="button" className="linkish" onClick={() => send.submit()}>Send a new code</button>
      {send.err && <p className="error">{send.err}</p>}
    </form>}
    {step === 'pick' && data && <div className="stack">
      <p className="meta">Accounts linked to {data.sent_to}:</p>
      <div className="card list">{data.accounts.map((a) => <div key={a.id} className="person acctrow"><Avatar user={a} size={44} /><span className="grow"><b>{a.full_name}</b><small className="meta">@{a.username}{a.deactivated ? ' · deactivated' : ''}</small></span>
        {purpose === 'reset_password' ? <button className="btn primary" onClick={() => { setChosen(a); setStep('password'); }}>Reset</button>
          : <span className="row"><button className="btn ghost" onClick={() => { setChosen(a); setStep('password'); }}>Reset password</button><Link className="btn primary" to={`/login?u=${encodeURIComponent(data.login_identifier)}`}>Log in</Link></span>}
      </div>)}</div>
    </div>}
    {step === 'password' && chosen && <form className="stack" onSubmit={reset.submit}>
      <div className="person"><Avatar user={chosen} size={44} /><span><b>{chosen.full_name}</b><small className="meta">@{chosen.username}</small></span></div>
      <label>New password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required autoComplete="new-password" autoFocus /></label>
      {reset.err && <p className="error" role="alert">{reset.err}</p>}
      <button className="btn primary block" disabled={reset.busy || pw.length < 8}>Change password</button>
    </form>}
    <p className="center"><Link to="/login">Back to log in</Link></p>
  </AuthShell>;
}
export const Forgot = () => <CodeAccounts purpose="reset_password" title="Reset your password" intro="Enter the email or phone number on your account. We’ll send you a 6-digit code." />;
export const FindAccount = () => <CodeAccounts purpose="find_account" title="Find your account" intro="Search by email, phone number or username. We’ll send a code to the email or phone on file, then show the accounts linked to it." allowUsername />;
