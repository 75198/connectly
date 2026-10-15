import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './session';
import { Icon, Logo, Avatar } from './components/ui';
import { api, getFeatures } from './api';
import { WELCOME_KEY } from './pages/Welcome';
import { I18nProvider, useT } from './lib/i18n';
import { sfx } from './lib/sounds';

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
const FindAccount = lazy(() => Auth().then((m) => ({ default: m.FindAccount })));
const SettingsSection = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsSection })));
const Hub = lazy(() => import('./pages/Hub').then((m) => ({ default: m.Hub })));
const Social = () => import('./pages/Social');
const Notifications = lazy(() => Social().then((m) => ({ default: m.Notifications })));
const Friends = lazy(() => Social().then((m) => ({ default: m.Friends })));
const PostPage = lazy(() => Social().then((m) => ({ default: m.PostPage })));
const CreateSpace = lazy(() => import('./pages/Spaces').then((m) => ({ default: m.CreateSpace })));
const SpaceView = lazy(() => import('./pages/Spaces').then((m) => ({ default: m.SpaceView })));
const Mk = () => import('./pages/Market');
const Market = lazy(() => Mk().then((m) => ({ default: m.Market })));
const NewListing = lazy(() => Mk().then((m) => ({ default: m.NewListing })));
const ListingView = lazy(() => Mk().then((m) => ({ default: m.ListingView })));
const Hero = lazy(() => import('./pages/Hero').then((m) => ({ default: m.Hero })));
const Welcome = lazy(() => import('./pages/Welcome').then((m) => ({ default: m.Welcome })));
const Reels = lazy(() => import('./pages/Reels').then((m) => ({ default: m.Reels })));
const NewReel = lazy(() => import('./pages/Reels').then((m) => ({ default: m.NewReel })));
const MyPosts = lazy(() => import('./pages/MyPosts').then((m) => ({ default: m.MyPosts })));
const Assistant = lazy(() => import('./pages/Assistant').then((m) => ({ default: m.Assistant })));
const GoLive = lazy(() => import('./pages/Live').then((m) => ({ default: m.GoLive })));
const WatchLive = lazy(() => import('./pages/Live').then((m) => ({ default: m.WatchLive })));
const PlansPage = lazy(() => import('./pages/Plans').then((m) => ({ default: m.PlansPage })));
const ManageSubscription = lazy(() => import('./pages/Plans').then((m) => ({ default: m.ManageSubscription })));
const Msg = () => import('./pages/Messages');
const Inbox = lazy(() => Msg().then((m) => ({ default: m.Inbox })));
const Chat = lazy(() => Msg().then((m) => ({ default: m.Chat })));
const Call = lazy(() => import('./pages/Call').then((m) => ({ default: m.Call })));
const Dc = () => import('./pages/Discover');
const TagPage = lazy(() => Dc().then((m) => ({ default: m.TagPage })));
const SoundPage = lazy(() => Dc().then((m) => ({ default: m.SoundPage })));
const Challenges = lazy(() => Dc().then((m) => ({ default: m.Challenges })));
const Events = lazy(() => Dc().then((m) => ({ default: m.Events })));
const NewEvent = lazy(() => Dc().then((m) => ({ default: m.NewEvent })));
const EventPage = lazy(() => Dc().then((m) => ({ default: m.EventPage })));
const Memories = lazy(() => Dc().then((m) => ({ default: m.Memories })));
const StreakPage = lazy(() => Dc().then((m) => ({ default: m.StreakPage })));
const Wallet = lazy(() => Dc().then((m) => ({ default: m.Wallet })));
const Insights = lazy(() => Dc().then((m) => ({ default: m.Insights })));
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })));

function AiLink() {
  const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((f) => setOn(!!f.ai_support)); }, []);
  return on ? <Link to="/assistant" className="btn icon ghost" aria-label="Connectly AI"><span className="aiorb xs">✦</span></Link> : null;
}
function I18nGate({ children }: { children: React.ReactNode }) {
  const { me } = useSession(); const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((f) => setOn(!!f.i18n)); }, []);
  return <I18nProvider enabled={on} accountLang={me?.locale}>{children}</I18nProvider>;
}
export function App() { return <SessionProvider><I18nGate><Router /><Toaster /></I18nGate></SessionProvider>; }

function Toaster() {
  const [t, setT] = useState<{ text: string; kind: string; id: number } | null>(null);
  useEffect(() => { let timer = 0; const f = (e: Event) => { const d = (e as CustomEvent).detail; setT({ ...d, id: Date.now() }); clearTimeout(timer); timer = window.setTimeout(() => setT(null), 3200); }; window.addEventListener('cx-toast', f); return () => window.removeEventListener('cx-toast', f); }, []);
  return <div className="toastwrap" role="status" aria-live="polite">{t && <div key={t.id} className={`toast ${t.kind}`}>{t.kind === 'err' ? '⚠️' : '✓'} {t.text}</div>}</div>;
}

const Loading = () => <div className="splash"><div className="spinner" /></div>;

function Router() {
  const { me, loading } = useSession(); const loc = useLocation();
  const [welcome, setWelcome] = useState(() => sessionStorage.getItem(WELCOME_KEY) === '1');
  useEffect(() => { if (me && !me.onboarded) setWelcome(false); else if (me) setWelcome(sessionStorage.getItem(WELCOME_KEY) === '1'); }, [me]);
  if (loading) return <div className="splash"><Logo size={64} /></div>;
  const legal = [<Route key="t" path="/terms" element={<Terms />} />, <Route key="p" path="/privacy" element={<Privacy />} />];
  if (!me) return <Suspense fallback={<Loading />}><Routes>
    {legal}
    <Route path="/" element={<Hero />} /><Route path="/welcome" element={<Hero />} />
    <Route path="/login" element={<Login />} /><Route path="/signup" element={<Signup />} />
    <Route path="/register" element={<Navigate to="/signup" replace />} /><Route path="/forgot" element={<Forgot />} /><Route path="/find" element={<FindAccount />} />
    <Route path="*" element={<Navigate to="/login" replace state={{ from: loc.pathname }} />} />
  </Routes></Suspense>;
  if (!me.onboarded && !['/terms', '/privacy'].includes(loc.pathname)) return <Suspense fallback={<Loading />}><Onboarding /></Suspense>;
  if (welcome && !['/terms', '/privacy'].includes(loc.pathname)) return <Suspense fallback={<Loading />}><Welcome onDone={() => { sessionStorage.removeItem(WELCOME_KEY); setWelcome(false); }} /></Suspense>;
  if (/^\/live\/(new|\d+)$/.test(loc.pathname)) return <Suspense fallback={<Loading />}><Routes><Route path="/live/new" element={<GoLive />} /><Route path="/live/:id" element={<WatchLive />} /></Routes></Suspense>;
  if (/^\/messages\/\d+$/.test(loc.pathname)) return <Suspense fallback={<Loading />}><Routes><Route path="/messages/:id" element={<Chat />} /></Routes></Suspense>;
  if (/^\/call\/\d+$/.test(loc.pathname)) return <Suspense fallback={<Loading />}><Routes><Route path="/call/:id" element={<Call />} /></Routes></Suspense>;
  if (loc.pathname === '/assistant') return <Suspense fallback={<Loading />}><Assistant /></Suspense>;
  if (/^\/reels(\/\d+)?$/.test(loc.pathname)) return <Suspense fallback={<Loading />}><Routes><Route path="/reels" element={<Reels />} /><Route path="/reels/:id" element={<Reels />} /></Routes></Suspense>;
  return <Layout><Suspense fallback={<Loading />}><Routes>
    {legal}
    <Route path="/" element={<Feed />} /><Route path="/compose" element={<Compose />} /><Route path="/search" element={<Search />} /><Route path="/reels/new" element={<NewReel />} />
    <Route path="/u/:username" element={<Profile />} /><Route path="/settings" element={<Settings />} />
    <Route path="/settings/profile" element={<EditProfile />} /><Route path="/settings/plans" element={<PlansPage />} /><Route path="/settings/subscription" element={<ManageSubscription />} /><Route path="/settings/:section" element={<SettingsSection />} />
    <Route path="/me" element={<Hub />} /><Route path="/me/:tab" element={<MyPosts />} /><Route path="/notifications" element={<Notifications />} /><Route path="/friends" element={<Friends />} /><Route path="/u/:username/:list" element={<Friends />} />
    <Route path="/post/:id" element={<PostPage />} /><Route path="/create/:kind" element={<CreateSpace />} /><Route path="/s/:slug" element={<SpaceView />} />
    <Route path="/messages" element={<Inbox />} /><Route path="/tag/:tag" element={<TagPage />} /><Route path="/sound/:id" element={<SoundPage />} /><Route path="/challenges" element={<Challenges />} />
    <Route path="/events" element={<Events />} /><Route path="/events/new" element={<NewEvent />} /><Route path="/events/:id" element={<EventPage />} /><Route path="/memories" element={<Memories />} /><Route path="/me/streak" element={<StreakPage />} /><Route path="/me/coins" element={<Wallet />} /><Route path="/me/insights" element={<Insights />} />
    <Route path="/market" element={<Market />} /><Route path="/market/new" element={<NewListing />} /><Route path="/market/:id" element={<ListingView />} />
    {me.roles?.includes('admin') && <Route path="/admin" element={<Admin />} />}
    {['/login', '/signup', '/register', '/forgot', '/find', '/welcome'].map((p) => <Route key={p} path={p} element={<Navigate to="/" replace />} />)}
    <Route path="*" element={<div className="card empty">Page not found. <NavLink to="/">Go home</NavLink></div>} />
  </Routes></Suspense></Layout>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const { me, theme, toggleTheme } = useSession();
  const unread = me!.unread_notifications || 0; const t = useT();
  const [dm, setDm] = useState(false); const [dmUnread, setDmUnread] = useState(0);
  useEffect(() => { getFeatures().then((f) => setDm(!!f.messages)); }, []);
  useEffect(() => { if (!dm) return; let prev = -1; const tick = () => api<{ unread: number }>('/conversations/unread').then((r) => { if (prev >= 0 && r.unread > prev) sfx('received'); prev = r.unread; setDmUnread(r.unread); }).catch(() => {}); tick(); const i = setInterval(tick, 15000); return () => clearInterval(i); }, [dm]);
  const prevN = useRef(unread); useEffect(() => { if (unread > prevN.current) sfx('notify'); prevN.current = unread; }, [unread]);
  const Dm = ({ label }: { label?: boolean }) => dm ? <NavLink to="/messages" className={label ? '' : 'btn icon ghost bellbtn'} aria-label={t('messages')}><Icon name="chat" />{label && <span>{t('messages')}</span>}{dmUnread > 0 && <b className="badge">{dmUnread > 99 ? '99+' : dmUnread}</b>}</NavLink> : null;
  const items = [
    { to: '/', label: t('home'), icon: 'home' as const, end: true },
    { to: '/search', label: t('search'), icon: 'search' as const },
    { to: '/compose', label: t('create'), icon: 'plus' as const, create: true },
    { to: '/market', label: t('marketplace'), icon: 'shop' as const },
    { to: '/me', label: t('profile'), icon: 'user' as const },
  ];
  const Bell = ({ label }: { label?: boolean }) => <NavLink to="/notifications" className={label ? '' : 'btn icon ghost bellbtn'} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
    <Icon name="bell" />{label && <span>Notifications</span>}{unread > 0 && <b className="badge">{unread > 99 ? '99+' : unread}</b>}</NavLink>;
  const loc = useLocation(); const home = loc.pathname === '/';
  return <div className={`layout ${home ? 'home' : 'sub'}`}>
    {home && <header className="topbar"><NavLink to="/"><Logo size={30} /></NavLink>
      <span className="row topicons"><AiLink /><ReelsLink /><Dm /><Bell /></span></header>}
    <aside className="sidebar">
      <NavLink to="/" className="brandlink"><Logo size={36} /></NavLink>
      <nav>{items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} className={i.create ? 'createlink' : ''}><Icon name={i.icon} /><span>{i.label}</span></NavLink>)}
        <ReelsLink label />
        <Dm label />
        <Bell label />
        {me!.roles?.includes('admin') && <NavLink to="/admin"><Icon name="shield" /><span>Admin</span></NavLink>}</nav>
      <div className="grow" />
      <button className="navbtn" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /><span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>
      <NavLink to="/me" className="mecard"><Avatar user={me!} size={36} /><span><b>{me!.full_name}</b><small>@{me!.username}</small></span></NavLink>
    </aside>
    <main className="content"><div key={loc.pathname} className="page-enter">{children}</div></main>
    <nav className="bottomnav">{items.map((i) => <NavLink key={i.to} to={i.to} end={i.end} aria-label={i.label} className={i.create ? 'createbtn' : ''}><Icon name={i.icon} /><span>{i.label}</span></NavLink>)}</nav>
  </div>;
}

// Reels entry lives in the Home header (and the Create menu) so the bottom nav order stays
// Home, Search, Create, Marketplace, Profile.
function ReelsLink({ label }: { label?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => { getFeatures().then((f) => setOn(f.reels)); }, []);
  if (!on) return null;
  return <Link to="/reels" className={label ? '' : 'btn icon ghost'} aria-label="Reels"><Icon name="reel" />{label && <span>Reels</span>}</Link>;
}
