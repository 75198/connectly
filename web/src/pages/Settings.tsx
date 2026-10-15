import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { Icon } from '../components/ui';

export function Settings() {
  const { me, logout, theme, toggleTheme } = useSession(); const nav = useNavigate();
  if (!me) return null;
  return <div className="stack">
    <h1 className="pagetitle">Menu</h1>
    <div className="card list">
      <Link to="/settings/profile"><Icon name="user" /> Edit profile, name &amp; username</Link>
      <button onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
      <Link to="/terms"><Icon name="shield" /> Terms &amp; Conditions</Link>
      <Link to="/privacy"><Icon name="lock" /> Privacy Policy</Link>
      {me.roles?.includes('admin') && <Link to="/admin"><Icon name="shield" /> Admin</Link>}
      <button className="danger" onClick={async () => { await logout(); nav('/login'); }}><Icon name="logout" /> Log out</button>
    </div>
    <div className="card"><h3>Coming in the next milestone</h3><p className="meta">Friends &amp; follows, notifications, sharing, reporting and messaging are being built and will appear here when ready.</p></div>
    <p className="meta center">Signed in as @{me.username} · {me.email || me.phone}</p>
  </div>;
}
