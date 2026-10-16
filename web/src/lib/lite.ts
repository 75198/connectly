// Lite mode for cheap phones / slow networks: lower-res images, no autoplay, fewer animations, smaller pages.
// Pref: 'on' | 'off' | 'auto' (auto = Data Saver on, or a 2G/3G connection, or a low-memory device).
let pref: 'auto' | 'on' | 'off' = (localStorage.getItem('cx-lite') as any) || 'auto';
let featureOn = false;
const conn = () => (navigator as any).connection as { saveData?: boolean; effectiveType?: string; addEventListener?: any } | undefined;
export function autoSlow() { const c = conn(); return !!c?.saveData || /(^|-)2g|3g/.test(c?.effectiveType || '') || ((navigator as any).deviceMemory || 8) <= 1; }
export function isLite() { return featureOn && (pref === 'on' || (pref === 'auto' && autoSlow())); }
export function litePref() { return pref; }
function apply() { document.documentElement.classList.toggle('lite', isLite()); }
export function setLitePref(p: 'auto' | 'on' | 'off') { pref = p; localStorage.setItem('cx-lite', p); apply(); }
export function initLite(enabled: boolean, serverPref?: 'auto' | 'on' | 'off') { featureOn = enabled; if (serverPref && !localStorage.getItem('cx-lite')) pref = serverPref; apply(); conn()?.addEventListener?.('change', apply); }
// Lower-res copy of an uploaded image (server resizes + caches). Leaves other URLs alone.
export const liteSrc = (src?: string | null) => (src && isLite() && src.startsWith('/uploads/') && !/\.(mp4|webm|mov)$/i.test(src) ? `/api/img/lite?p=${encodeURIComponent(src)}` : src || '');
export const pageSize = (n: number) => (isLite() ? Math.min(n, 5) : n);
