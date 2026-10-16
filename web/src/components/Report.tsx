// One-tap report: pick a reason (Scam is fast-tracked to admins). The reporter is told when it's reviewed.
import { useState } from 'react';
import { api, toast } from '../api';
import { Sheet } from './ui';
const REASONS = [['Scam or fraud', '💸'], ['Pretending to be someone else', '🎭'], ['Spam', '📢'], ['Harassment or bullying', '😠'], ['Hate speech', '🚫'], ['Nudity or sexual content', '🔞'], ['Violence or threats', '⚠️'], ['Self-harm', '💔'], ['Something else', '💬']];
export function ReportSheet({ target, onClose }: { target: { target_type: 'post'; post_id: number } | { target_type: 'user'; username: string }; onClose: () => void }) {
  const [busy, setBusy] = useState(false); const [other, setOther] = useState(false); const [text, setText] = useState('');
  const send = async (reason: string) => { setBusy(true);
    try { await api('/reports', { json: { ...target, reason: reason.slice(0, 500) } }); toast(reason.startsWith('Scam') ? 'Thanks. Scam reports go straight to our team. We’ll let you know what happens.' : 'Thanks. We’ll review it and let you know.'); onClose(); }
    catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return <Sheet title="Report" onClose={onClose}>
    <p className="meta">Your report is anonymous. If someone is in immediate danger, call local emergency services.</p>
    {!other ? <div className="list">{REASONS.map(([r, e]) => <button key={r} disabled={busy} onClick={() => (r === 'Something else' ? setOther(true) : send(r))}><span>{e}</span> {r}</button>)}</div>
      : <><textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Tell us what’s wrong" maxLength={480} />
        <button className="btn primary block" disabled={busy || text.trim().length < 3} onClick={() => send(`Other: ${text.trim()}`)}>Send report</button></>}
  </Sheet>;
}
