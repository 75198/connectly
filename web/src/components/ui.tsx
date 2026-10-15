import { Link } from 'react-router-dom';
import { brand } from '../brand';
import { Author, authorHref } from '../api';

export function Logo({ size = 32, withName = true }: { size?: number; withName?: boolean }) {
  return <span className="logo"><img src={brand.logoUrl} width={size} height={size} alt="" />{withName && <b>{brand.name}</b>}</span>;
}
export function Avatar({ user, size = 40 }: { user: Pick<Author, 'full_name' | 'avatar_path'>; size?: number }) {
  if (user.avatar_path) return <img className="avatar" src={user.avatar_path} width={size} height={size} alt="" />;
  const initials = user.full_name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return <span className="avatar ph" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>{initials}</span>;
}
export function UserLink({ user }: { user: Author }) {
  return <Link to={authorHref(user)} className="ulink">{user.full_name}</Link>;
}
export function Icon({ name }: { name: 'home' | 'user' | 'plus' | 'gear' | 'shield' | 'sun' | 'moon' | 'heart' | 'heartFill' | 'chat' | 'globe' | 'users' | 'lock' | 'logout' | 'image' | 'more' | 'search' | 'bell' | 'pin' | 'shop' | 'flag' | 'x' | 'back' | 'chev' | 'reel' | 'share' | 'eye' | 'volume' | 'mute' | 'play' }) {
  const p: Record<string, JSX.Element> = {
    home: <path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
    plus: <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M12 8v8M8 12h8" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>,
    shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
    heart: <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 6a5.5 5.5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z" />,
    heartFill: <path fill="currentColor" d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 6a5.5 5.5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z" />,
    chat: <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4.5a3.5 3.5 0 010 7M18 14.5c2.5.5 4 2.5 4 5.5" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></>,
    logout: <path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 8l-4 4 4 4M6 12h11" />,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
    shop: <><path d="M4 9h16l-1.2 10.2a1 1 0 01-1 .8H6.2a1 1 0 01-1-.8z" /><path d="M8.5 9V7a3.5 3.5 0 017 0v2" /></>,
    flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    back: <path d="M15 5l-7 7 7 7" />,
    chev: <path d="M9 5l7 7-7 7" />,
    bell: <><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 003.4 0" /></>,
    pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
    reel: <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M3 8h18M8 3l3 5M14 3l3 5" /><path d="M10 11.5v5l4.5-2.5z" /></>,
    share: <><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" /><path d="M12 3v12M7 8l5-5 5 5" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    volume: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11" /></>,
    mute: <><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></>,
    play: <path fill="currentColor" d="M8 5v14l11-7z" />,
    more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}
export const VIS_LABEL = { public: 'Public', friends: 'Friends', private: 'Only me' } as const;
export const VIS_ICON = { public: 'globe', friends: 'users', private: 'lock' } as const;

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="sheetwrap" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
    <div className="sheet" onClick={(e) => e.stopPropagation()}><div className="sheethead"><h3>{title}</h3><button className="btn icon ghost" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>{children}</div>
  </div>;
}
export function Spinner() { return <div className="spinner" aria-label="Loading" />; }
