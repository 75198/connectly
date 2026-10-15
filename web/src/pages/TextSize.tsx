import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toast } from '../api';
import { Icon } from '../components/ui';
import { applyTextScale, currentScale, SIZES } from '../lib/textsize';

export function TextSize() {
  const [v, setV] = useState(currentScale()); const [saving, setSaving] = useState(false);
  const label = SIZES.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a)).k;
  const set = (x: number) => { setV(x); applyTextScale(x); };
  const save = async (x = v) => { setSaving(true); try { await api('/me/prefs', { method: 'PATCH', json: { text_scale: x === 1 ? null : x } }); toast('Text size saved'); } catch (e: any) { toast(e.message, 'err'); } finally { setSaving(false); } };
  return <div className="stack">
    <div className="row"><Link to="/settings" className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">Text size</h1></div>
    <section className="card stack">
      <div className="tspreview" aria-live="polite"><b>Ada Lovelace</b><p>Golden hour in Lagos 🌅 This is how posts, messages and menus will look.</p><small className="meta">2 h · Public</small></div>
      <div className="tsslider"><span className="tsa sm" aria-hidden="true">A</span>
        <input type="range" min={0.85} max={1.4} step={0.05} value={v} aria-label="Text size" aria-valuetext={label} onChange={(e) => set(Number(e.target.value))} onPointerUp={() => save()} onKeyUp={() => save()} />
        <span className="tsa lg" aria-hidden="true">A</span></div>
      <div className="segmented">{SIZES.map((s) => <button key={s.k} type="button" className={label === s.k ? 'on' : ''} onClick={() => { set(s.v); save(s.v); }}>{s.k}</button>)}</div>
      <p className="meta">Applies across the app on this account. Your phone’s text size and browser zoom still apply too.{saving ? ' Saving…' : ''}</p>
    </section>
  </div>;
}
