import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, User } from './api';
import { applyTheme, ThemeMode } from './brand';

export type ThemePref = ThemeMode | 'system';
type Ctx = { me: User | null; loading: boolean; refresh: () => Promise<void>; logout: (save?: boolean) => Promise<void>; theme: ThemeMode; toggleTheme: () => void; themePref: ThemePref; setThemePref: (p: ThemePref) => void };
const SessionCtx = createContext<Ctx>(null!);
export const useSession = () => useContext(SessionCtx);

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
const initialPref = (): ThemePref => (localStorage.getItem('cx-theme') as ThemePref) || 'system';
const resolve = (p: ThemePref, sysDark: boolean): ThemeMode => (p === 'system' ? (sysDark ? 'dark' : 'light') : p);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [themePref, setPref] = useState<ThemePref>(initialPref);
  const [sysDark, setSysDark] = useState(!!mq?.matches);
  useEffect(() => { if (!mq) return; const f = () => setSysDark(mq.matches); mq.addEventListener?.('change', f); return () => mq.removeEventListener?.('change', f); }, []);
  const theme = resolve(themePref, sysDark);
  useEffect(() => applyTheme(theme), [theme]);
  const refresh = useCallback(async () => {
    try { const u = await api<User>('/me'); setMe(u); if (u.theme_pref) { setPref(u.theme_pref); localStorage.setItem('cx-theme', u.theme_pref); } } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = async (save = false) => { await api('/auth/logout', { json: { save } }); setMe(null); };
  // Saved on this device and on the account, so it follows you to other devices.
  const setThemePref = (p: ThemePref) => { setPref(p); localStorage.setItem('cx-theme', p); if (me) api('/me/settings', { method: 'PATCH', json: { theme_pref: p } }).catch(() => {}); };
  const toggleTheme = () => setThemePref(theme === 'dark' ? 'light' : 'dark');
  return <SessionCtx.Provider value={{ me, loading, refresh, logout, theme, toggleTheme, themePref, setThemePref }}>{children}</SessionCtx.Provider>;
}
