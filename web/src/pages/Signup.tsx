import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ageFrom, looksLikePhone, NAME_RE } from '../api';
import { useSession } from '../session';
import { IdentifierInput } from '../components/Identifier';
import { FlowShell, CodeInput } from './Auth';
import { solvePow, Pow } from '../lib/pow';


export function Signup() {
  const { refresh } = useSession();
  const [sp] = useSearchParams();
  const resume = sp.get('verify');
  const [step, setStep] = useState(resume ? 4 : 0);
  const [identifier, setIdentifier] = useState(resume || ''); const [country, setCountry] = useState(sp.get('country') || 'NG');
  const [password, setPassword] = useState(''); const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState(''); const [terms, setTerms] = useState(false);
  const [code, setCode] = useState(''); const [sentTo, setSentTo] = useState(resume || '');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [signingIn, setSigningIn] = useState(false);
  const [same, setSame] = useState(false); const [back, setBack] = useState(false);
  const [phoneOk, setPhoneOk] = useState<boolean | null>(null);
  // Bot check (proof-of-work) starts quietly in the background once the first screen is done.
  const powRef = useRef<Promise<Pow> | null>(null);
  const startPow = () => { if (!powRef.current) powRef.current = solvePow().catch((e) => { powRef.current = null; throw e; }); };
  useEffect(() => { api<{ phone_signup: boolean }>('/auth/capabilities').then((c) => setPhoneOk(c.phone_signup)).catch(() => setPhoneOk(false)); }, []);
  const isPhone = looksLikePhone(identifier);
  const phoneBlocked = isPhone && phoneOk === false;
  const run = async (fn: () => Promise<void>) => { setErr(''); setMsg(''); setSame(false); setBusy(true); try { await fn(); } catch (e: any) { if (e.message?.startsWith('You already have an account')) setSame(true); setErr(e.message); } finally { setBusy(false); } };
  const go = (n: number) => { setBack(n < step); setErr(''); setSame(false); setStep(n); };

  const name = fullName.trim().replace(/\s+/g, ' ');
  const nameValid = name.length >= 2 && NAME_RE.test(name);
  const age = dob ? ageFrom(dob) : NaN;

  async function next(e: FormEvent) {
    e.preventDefault();
    if (step === 0) return run(async () => {
      if (password.length < 8) throw new Error('Password must be at least 8 characters');
      const r = await api<{ normalized: string }>('/auth/check-identifier', { json: { identifier, country, password } });
      setSentTo(r.normalized); startPow(); go(1);
    });
    if (step === 1) { if (!nameValid) return setErr('Use letters, spaces, hyphens or apostrophes only'); return go(2); }
    if (step === 2) {
      if (!dob || isNaN(age)) return setErr('Enter your date of birth');
      if (age < 13) return setErr('You must be at least 13 years old to use Connectly');
      if (age > 120) return setErr('Enter a real date of birth');
      return go(3);
    }
    if (step === 3) return run(async () => {
      if (!terms) throw new Error('Please agree to the Terms to continue');
      startPow();
      const pow = await powRef.current!; powRef.current = null; // each check works once
      const r = await api<{ sent_to: string }>('/auth/register', { json: { identifier, country, password, full_name: name, birth_date: dob, accept_terms: true, pow } });
      setSentTo(r.sent_to); go(4);
    });
    if (step === 4) return run(async () => {
      await api('/auth/verify', { json: { identifier: sentTo || identifier, country, code } });
      setSigningIn(true);
      await new Promise((r) => setTimeout(r, 600));
      await refresh(); // session cookie is now set -> app shows onboarding
    });
  }
  const resend = () => run(async () => { await api('/auth/resend', { json: { identifier: sentTo || identifier, country } }); setMsg('A new code is on its way.'); });

  if (signingIn) return <FlowShell stepKey="in"><div className="bignote"><div className="spinner" /><p>Signing you in…</p></div></FlowShell>;
  const titles = ['Create your account', 'What’s your name?', 'When’s your birthday?', 'Terms & Privacy', 'Enter your code'];
  return <FlowShell stepKey={step} back={back}>
    <h1 className="flowtitle">{titles[step]}</h1>
    <form className="stack" onSubmit={next} noValidate>
      {step === 0 && <>
        <IdentifierInput value={identifier} onChange={setIdentifier} country={country} onCountry={setCountry} autoFocus />
        {phoneBlocked && <p className="notice">Phone sign-up is coming soon. Please use your email address for now.</p>}
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" /><span className="hint">At least 8 characters</span></label>
      </>}
      {step === 1 && <label>Full name<input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus required maxLength={80} autoComplete="name" autoCapitalize="words" />
        <span className="hint">Use the name people know you by in real life. Your @username is created from it and can be changed later.</span>
        {nameValid && !name.includes(' ') && <span className="warn">Tip: include both your first and last name.</span>}</label>}
      {step === 2 && <label>Date of birth<input type="date" value={dob} onChange={(e) => setDob(e.target.value)} autoFocus required max={new Date().toISOString().slice(0, 10)} min="1900-01-01" />
        <span className="hint">You must be at least 13. Your birthday isn’t shown on your profile.</span></label>}
      {step === 3 && <label className="check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span>I agree to the <Link to="/terms" target="_blank">Terms &amp; Conditions</Link> and have read the <Link to="/privacy" target="_blank">Privacy Policy</Link>.</span></label>}
      {step === 4 && <>
        <p>We sent a 6-digit code to <b>{sentTo || identifier}</b>. It expires in 10 minutes.</p>
        <CodeInput value={code} onChange={setCode} />
      </>}
      {err && <p className="error" role="alert">{err}</p>}{msg && <p className="success">{msg}</p>}
      {same && <div className="row"><Link className="btn primary grow" to={`/login?u=${encodeURIComponent(identifier)}`}>Log in</Link><Link className="btn ghost grow" to="/find">Find account</Link></div>}
      <button className="btn primary block" disabled={busy || (step === 0 && (phoneBlocked || !identifier || !password)) || (step === 1 && !name) || (step === 2 && !dob) || (step === 3 && !terms) || (step === 4 && code.length !== 6)}>
        {busy ? (step === 3 ? 'Checking you’re not a bot…' : 'Please wait…') : step === 3 ? 'Create account' : step === 4 ? 'Verify' : 'Continue'}</button>
      {step > 0 && step < 4 && <button type="button" className="btn ghost block" onClick={() => go(step - 1)}>Back</button>}
      {step === 4 && <button type="button" className="linkish" disabled={busy} onClick={resend}>Resend code</button>}
    </form>
    {step === 0 && <p className="center flowfoot">Already have an account? <Link to="/login">Log in</Link></p>}
  </FlowShell>;
}
