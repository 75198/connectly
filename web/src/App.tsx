import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { Icon, Logo, Avatar } from './components/ui';
import { Login, Register, Forgot, Verify } from './pages/Auth';
import { Feed, Compose } from './pages/Feed';
import { Profile, EditProfile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';
import { Search } from './pages/Search';

export function App() { return <SessionProvider><Router /></SessionProvider>; }

function Router() {
  const { me, loading } = useSession(); const loc = useLocation();
  if (loading) return <div className="splash"><Logo size={64} /></div>;
  if (!me) return <Routes>
    <Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} />
    <Route path="/forgot" element={<Forgot />} />
    <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
  </Routes>;
  if (!me.email_verified) return <Verify />;
  return <Layout><Routes>
    <Route path="/" element={<Feed />} /><Route path="/compose" element={<Compose />} /><Route path="/search" element={<Search />} />
    <Route path="/u/:username" element={<Profile />} /><Route path="/settings" element={<Settings />} />
    <Route path="/settings/profile" element={<EditProfile />} /><Route path="/admin" element={<Admin />} />
    <Route path="/login" element={<Navigate to="/" replace />} /><Route path="/register" element={<Navigate to="/" replace />} />
    <Route path="*" element={<div className="card empty">Page not found. <NavLink to="/">Go home</NavLink></div>} />
  </Routes></Layout>;
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
      <NavLink to={`/u/${me!.username}`} className="mecard"><Avatar user={me!} size={36} /><span><b>{me!.display_name}</b><small>@{me!.username}</small></span></NavLink>
    </aside>
    <main className="content">{children}</main>
    <nav className="bottomnav">{items.filter((i) => i.to !== '/admin').map((i) => <NavLink key={i.to} to={i.to} end={i.end} aria-label={i.label}><Icon name={i.icon} /><span>{i.label}</span></NavLink>)}</nav>
  </div>;
}
