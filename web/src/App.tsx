import { lazy, Suspense } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { Icon, Logo, Avatar } from './components/ui';

// Route-level code splitting keeps the first download small on slow networks.
const Auth = () => import('./pages/Auth');
const Login = lazy(() => Auth().then((m) => ({ default: m.Login })));
const Forgot = lazy(() => Auth().then((m) => ({ default: m.Forgot })));
const Signup = lazy(() => import('./pages/Signup').then((m) => ({ default: m.Signup })));
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })));
const Feed = lazy(() => import('./pages/Feed').then((m) => ({ default: m.Feed })));
const Compose = lazy(() => import('./pages/Feed').then((m) => ({ default: m.Compose })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const EditProfile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.EditProfile })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })));

export function App() { return <SessionProvider><Router /></SessionProvider>; }

const Loading = () => <div className="splash"><div className="spinner" /></div>;

function Router() {
  const { me, loading } = useSession(); const loc = useLocation();
  if (loading) return <div className="splash"><Logo size={64} /></div>;
  const legal = [<Route key="t" path="/terms" element={<Terms />} />, <Route key="p" path="/privacy" element={<Privacy />} />];
  if (!me) return <Suspense fallback={<Loading />}><Routes>
    {legal}
    <Route path="/login" element={<Login />} /><Route path="/signup" element={<Signup />} />
    <Route path="/register" element={<Navigate to="/signup" replace />} /><Route path="/forgot" element={<Forgot />} />
    <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
  </Routes></Suspense>;
  if (!me.onboarded && !['/terms', '/privacy'].includes(loc.pathname)) return <Suspense fallback={<Loading />}><Onboarding /></Suspense>;
  return <Layout><Suspense fallback={<Loading />}><Routes>
    {legal}
    <Route path="/" element={<Feed />} /><Route path="/compose" element={<Compose />} /><Route path="/search" element={<Search />} />
    <Route path="/u/:username" element={<Profile />} /><Route path="/settings" element={<Settings />} />
    <Route path="/settings/profile" element={<EditProfile />} /><Route path="/admin" element={<Admin />} />
    {['/login', '/signup', '/register', '/forgot'].map((p) => <Route key={p} path={p} element={<Navigate to="/" replace />} />)}
    <Route path="*" element={<div className="card empty">Page not found. <NavLink to="/">Go home</NavLink></div>} />
  </Routes></Suspense></Layout>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const { me, theme, toggleTheme } = useSession();
  const items = [
    { to: '/', label: 'Home', icon: 'home' as const, end: true },
    { to: '/search', label: 'Search', icon: 'search' as const },
    { to: '/compose', label: 'Create', icon: 'plus' as const },
    { to: `/u/${me!.username}`, label: 'Profile', icon: 'user' as const },
    ...(me!.roles?.includes('admin') ? [{ to: '/admin', label: 'Admin', icon: 'shield' as const }] : []),
    { to: '/settings', label: 'Menu', icon: 'gear' as const },
  ];
  return <div className="layout">
    <header className="topbar"><NavLink to="/"><Logo size={30} /></NavLink>
      <button className="btn icon ghost" onClick={toggleTheme} aria-label="Toggle dark mode"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button></header>
    <aside className="sidebar">
      <NavLink to="/" className="brandlink"><Logo size={36} /></NavLink>
      <nav>{items.map((i) => <NavLink key={i.to} to={i.to} end={i.end}><Icon name={i.icon} /><span>{i.label}</span></NavLink>)}</nav>
      <div className="grow" />
      <button className="navbtn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /><span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>
      <NavLink to={`/u/${me!.username}`} className="mecard"><Avatar user={me!} size={36} /><span><b>{me!.full_name}</b><small>@{me!.username}</small></span></NavLink>
    </aside>
    <main className="content">{children}</main>
    <nav className="bottomnav">{items.filter((i) => i.to !== '/admin').map((i) => <NavLink key={i.to} to={i.to} end={i.end} aria-label={i.label}><Icon name={i.icon} /><span>{i.label}</span></NavLink>)}</nav>
  </div>;
}
