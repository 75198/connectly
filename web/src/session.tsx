import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, User } from './api';
import { applyTheme, ThemeMode } from './brand';

type Ctx = { me: User | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void>; theme: ThemeMode; toggleTheme: () => void };
const SessionCtx = createContext<Ctx>(null!);
export const useSession = () => useContext(SessionCtx);

const initialTheme = (): ThemeMode => (localStorage.getItem('cx-theme') as ThemeMode) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const refresh = useCallback(async () => {
    try { setMe(await api<User>('/me')); } catch { setMe(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setMe(null); };
  const toggleTheme = () => setTheme((t) => { const n = t === 'dark' ? 'light' : 'dark'; localStorage.setItem('cx-theme', n); return n; });
  return <SessionCtx.Provider value={{ me, loading, refresh, logout, theme, toggleTheme }}>{children}</SessionCtx.Provider>;
}
