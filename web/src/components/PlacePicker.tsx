import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Place = { id: number; display: string };
// Autocomplete over the offline GeoNames dataset. Selecting fills city, state and country.
export function PlacePicker({ label, value, onPick }: { label: string; value: string; onPick: (p: Place | null) => void }) {
  const [text, setText] = useState(value); const [items, setItems] = useState<Place[]>([]); const [open, setOpen] = useState(false); const [active, setActive] = useState(0);
  const seq = useRef(0);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (!open || text.trim().length < 2 || text === value) { setItems([]); return; }
    const my = ++seq.current;
    const t = setTimeout(() => api<{ items: Place[] }>(`/places?q=${encodeURIComponent(text.trim())}`).then((r) => { if (my === seq.current) { setItems(r.items); setActive(0); } }).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [text, open]); // eslint-disable-line
  const pick = (p: Place) => { onPick(p); setText(p.display); setOpen(false); setItems([]); };
  return <label className="placepicker">{label}
    <div className="acwrap">
      <input value={text} onChange={(e) => { setText(e.target.value); setOpen(true); if (!e.target.value) onPick(null); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); } else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); } }}
        autoComplete="off" role="combobox" aria-expanded={items.length > 0} aria-autocomplete="list" />
      {open && items.length > 0 && <ul className="aclist" role="listbox">{items.map((p, i) => <li key={p.id} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>{p.display}</li>)}</ul>}
    </div>
  </label>;
}
