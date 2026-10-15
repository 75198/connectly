import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { brand } from '../brand';
import { Icon } from '../components/ui';

export const WELCOME_KEY = 'cx-show-welcome';
const HIGHLIGHTS = [
  { icon: 'image' as const, title: 'Share what’s happening', text: 'Post photos and updates for friends or everyone.', to: '/compose' },
  { icon: 'reel' as const, title: 'Watch & make reels', text: 'Short vertical videos, made for your phone.', to: '/reels' },
  { icon: 'shop' as const, title: 'Buy and sell nearby', text: 'Find great deals on Marketplace.', to: '/market' },
  { icon: 'users' as const, title: 'Join groups', text: 'Meet people who love what you love.', to: '/me' },
];

// Shown once, right after a new account finishes onboarding.
export function Welcome({ onDone }: { onDone: () => void }) {
  const { me } = useSession(); const nav = useNavigate();
  const first = (me?.full_name || '').trim().split(/\s+/)[0] || 'friend';
  const done = (to = '/') => { onDone(); nav(to, { replace: true }); };
  return <div className="flow welcome">
    <header className="flowlogo"><img className="welcomelogo" src={brand.logoUrl} width={64} height={64} alt={brand.name} /></header>
    <main className="flowstep">
      <h1 className="flowtitle welcometitle">Welcome, {first}!</h1>
      <p className="center meta welcomesub">Here’s what you can do on {brand.name}.</p>
      <div className="stack">
        {HIGHLIGHTS.map((h, i) => <Link key={h.to} to={h.to} className="welcomecard" style={{ animationDelay: `${0.35 + i * 0.15}s` }} onClick={(e) => { e.preventDefault(); done(h.to); }}>
          <span className="welcomeicon"><Icon name={h.icon} /></span><span><b>{h.title}</b><small>{h.text}</small></span></Link>)}
      </div>
      <button className="btn primary block welcomego" onClick={() => done('/')}>Go to my feed</button>
    </main>
  </div>;
}
