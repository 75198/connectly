// App-wide text size. Everything is sized in rem, so we only set the root font size:
// base (browser default or iOS Dynamic Type) × 17/16 × the user's choice. Browser zoom keeps working on top.
const KEY = 'cx-text-scale';
let base = 16;
function measureBase() {
  // iOS Safari only exposes Dynamic Type through the -apple-system-body font; measure it when available.
  try {
    const d = document.createElement('div'); d.style.cssText = 'position:absolute;visibility:hidden;font:-apple-system-body'; document.body.appendChild(d);
    const ios = getComputedStyle(d).fontSize; d.style.font = ''; d.style.fontSize = 'medium'; const med = getComputedStyle(d).fontSize; d.remove();
    const supportsDyn = CSS.supports('font', '-apple-system-body');
    base = supportsDyn ? (parseFloat(ios) || 17) * (16 / 17) : parseFloat(med) || 16;
  } catch { base = 16; }
}
export const SIZES = [{ k: 'Small', v: 0.9 }, { k: 'Default', v: 1 }, { k: 'Large', v: 1.15 }, { k: 'Extra large', v: 1.3 }];
export function currentScale() { return Number(localStorage.getItem(KEY)) || 1; }
export function applyTextScale(scale: number | null, save = true) {
  const s = scale && scale >= 0.8 && scale <= 1.5 ? scale : 1;
  if (save) { if (scale) localStorage.setItem(KEY, String(s)); else localStorage.removeItem(KEY); }
  document.documentElement.style.fontSize = `${(base * 17 / 16 * s).toFixed(2)}px`;
  document.documentElement.style.setProperty('--ts', String(s));
}
if (typeof document !== 'undefined') {
  const init = () => { measureBase(); applyTextScale(currentScale(), false); };
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
}
