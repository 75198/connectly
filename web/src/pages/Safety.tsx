// Safety Center: one plain-language place for every safety and privacy control (reuses existing screens).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, timeAgo, toast, useFeatures } from '../api';
import { Icon } from '../components/ui';

const Item = ({ to, emoji, title, text }: { to: string; emoji: string; title: string; text: string }) =>
  <Link to={to} className="safetyitem"><span className="safetyicon">{emoji}</span><span className="grow"><b>{title}</b><small className="meta block">{text}</small></span><Icon name="chev" /></Link>;

export function SafetyCenter() {
  const f = useFeatures(); const [reports, setReports] = useState<any[] | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ items: any[] }>('/me/reports').then((r) => setReports(r.items)).catch(() => setReports([])); }, []);
  const exportData = async () => { setBusy(true); try { const r = await fetch('/api/me/export.zip', { credentials: 'same-origin' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Couldn’t prepare your data.');
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'connectly-data.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); toast('Your data is downloading'); }
    catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const status = (s: string) => ({ open: 'We’re reviewing it', actioned: 'Action taken', dismissed: 'Reviewed, no rule broken' } as Record<string, string>)[s] || s;
  return <div className="stack">
    <div className="card safetyhero"><span>🛡️</span><b>Safety Center</b><small>You’re in control of who sees your stuff and who can reach you. Here’s everything in one place.</small></div>
    <section className="card list"><h3>Who can reach you</h3>
      <Item to="/settings/privacy-center" emoji="💬" title="Messages, tags and mentions" text="Choose who can message, tag or @mention you, and who can comment." />
      <Item to="/settings/privacy-center" emoji="🔍" title="Who can find you" text="Turn finding you by email or phone number on or off, or make your account private." />
      <Item to="/settings/blocked" emoji="⛔" title="Blocked accounts" text="Blocked people can’t see your profile or contact you." />
      {f?.restrict_mute && <Item to="/settings/restricted" emoji="🤫" title="Restricted" text="Their comments only show to them, and their messages go to requests. They won’t know." />}
      {f?.restrict_mute && <Item to="/settings/muted" emoji="🔕" title="Muted" text="Hide someone’s posts and stories without unfollowing them." />}</section>
    <section className="card list"><h3>Comments and words</h3>
      <Item to="/settings/privacy-center" emoji="🙈" title="Hidden words" text="Offensive comments and messages are hidden automatically. Add your own words too." /></section>
    <section className="card list"><h3>Your account’s security</h3>
      <Item to="/settings/sessions" emoji="📱" title="Where you’re logged in" text="See your devices and log out of the ones you don’t recognise, or all others at once." />
      <Item to="/settings/security" emoji="🔐" title="Two-step login and login alerts" text="Get a code when someone logs in, and an alert for new devices." />
      <Item to="/settings/logins" emoji="🕒" title="Login history" text="When and how your account was used." /></section>
    <section className="card stack"><h3>Teens</h3><p className="meta">If you’re under 18, your account starts private and adults you don’t follow can’t message you. We ask for your birthday when you sign up so we can do this.</p></section>
    <section className="card stack"><h3>Reporting</h3><p className="meta">Tap ⋯ on any post, profile, comment, message or live video and choose Report. We’ll tell you when we’ve reviewed it. Reports are anonymous.</p>
      {reports && reports.length > 0 && <div className="list">{reports.slice(0, 10).map((r) => <div key={r.id} className="row between"><span>{r.target_type === 'post' ? 'Post' : r.target_type === 'comment' ? 'Comment' : 'Account'} · {timeAgo(r.created_at)}</span><b className={`rstatus ${r.status}`}>{status(r.status)}</b></div>)}</div>}</section>
    <section className="card list"><h3>Your data</h3>
      {f?.data_export && <button className="safetyitem" onClick={exportData} disabled={busy}><span className="safetyicon">📦</span><span className="grow"><b>{busy ? 'Preparing your data…' : 'Download your data'}</b><small className="meta block">A copy of your profile, posts, comments, messages and photos.</small></span></button>}
      <Item to="/settings/deactivate" emoji="🗑️" title="Delete your account" text={f?.safety_center ? 'Deleted for good after 30 days. Log in again before then to cancel.' : 'Remove your account and everything in it.'} />
      <Item to="/privacy" emoji="📄" title="Privacy Policy" text="What we collect and why, in plain language." />
      <Item to="/terms" emoji="📜" title="Terms" text="The rules for using Connectly." /></section>
  </div>;
}
