import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getFeatures, KIND_LABEL } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, Sheet } from '../components/ui';

type MySpace = { id: number; kind: 'page' | 'group' | 'community'; slug: string; name: string; photo_path: string | null; role: string };

// The Profile tab: your profile, pages (act as), create, groups, privacy & settings, sign out.
export function Hub() {
  const { me, refresh, logout } = useSession(); const nav = useNavigate();
  const [spaces, setSpaces] = useState<MySpace[] | null>(null); const [err, setErr] = useState(''); const [signout, setSignout] = useState(false);
  const [ai, setAi] = useState(false); useEffect(() => { getFeatures().then((f) => setAi(!!f.ai_support)); }, []);
  useEffect(() => { api<{ items: MySpace[] }>('/me/spaces').then((r) => setSpaces(r.items)).catch((e) => setErr(e.message)); }, []);
  if (!me) return null;
  const pages = spaces?.filter((s) => s.kind === 'page' && ['owner', 'admin'].includes(s.role)) || [];
  const groups = spaces?.filter((s) => s.kind === 'group') || [];
  const comms = spaces?.filter((s) => s.kind === 'community') || [];
  const followed = spaces?.filter((s) => s.kind === 'page' && !['owner', 'admin'].includes(s.role)) || [];
  const act = async (space_id: number | null) => { try { await api('/me/acting', { json: { space_id } }); await refresh(); } catch (e: any) { setErr(e.message); } };
  const row = (s: MySpace, extra?: React.ReactNode) => <div key={s.id} className="hubrow"><Link to={`/s/${s.slug}`} className="person grow"><Avatar user={{ full_name: s.name, avatar_path: s.photo_path }} size={40} /><span><b>{s.name}</b><small className="meta">{KIND_LABEL[s.kind]}{s.role === 'owner' ? ' · Owner' : ''}</small></span></Link>{extra}</div>;
  const doSignout = async (save: boolean) => { await logout(save); nav('/login'); };
  return <div className="stack">
    <Link to={`/u/${me.username}`} className="card person hubme"><Avatar user={me} size={60} /><span className="grow"><b className="big">{me.full_name}</b><small className="meta">See your profile</small></span><Icon name="chev" /></Link>
    <Link to="/settings/profile" className="btn ghost block">Edit profile</Link>
    {me.acting_as && <div className="notice row between"><span>You’re acting as <b>{me.acting_as.name}</b></span><button className="btn ghost" onClick={() => act(null)}>Switch to {me.full_name.split(' ')[0]}</button></div>}
    {err && <p className="error card">{err}</p>}
    <section className="card"><h3>Your pages</h3>
      {spaces === null ? <div className="spinner" /> : pages.length === 0 ? <p className="meta">You don’t manage any pages yet.</p> : pages.map((s) => row(s, me.acting_as?.id === s.id
        ? <button className="chip" onClick={() => act(null)}>Acting as</button> : <button className="chip" onClick={() => act(s.id)}>Switch</button>))}
      <div className="row wrap pad"><Link className="btn ghost" to="/create/page"><Icon name="plus" /> Create page</Link><Link className="btn ghost" to="/create/group"><Icon name="plus" /> Create group</Link><Link className="btn ghost" to="/create/community"><Icon name="plus" /> Create community</Link></div>
    </section>
    {spaces !== null && groups.length > 0 && <section className="card"><h3>Your groups</h3>{groups.map((s) => row(s))}</section>}
    {spaces !== null && comms.length > 0 && <section className="card"><h3>Your communities</h3>{comms.map((s) => row(s))}</section>}
    {spaces !== null && followed.length > 0 && <section className="card"><h3>Pages you follow</h3>{followed.map((s) => row(s))}</section>}
    <div className="card list">
      <Link to="/friends"><Icon name="users" /> Friends</Link>
      <Link to="/me/saved"><Icon name="bookmark" /> Saved</Link>
      <Link to="/me/drafts"><Icon name="image" /> Drafts</Link>
      <Link to="/me/deleted"><Icon name="trash" /> Recently deleted</Link>
      <Link to="/notifications"><Icon name="bell" /> Notifications</Link>
      <Link to="/market?mine=1"><Icon name="shop" /> Your listings</Link>
      {ai && <Link to="/assistant"><Icon name="chat" /> Connectly AI</Link>}
      <Link to="/settings"><Icon name="gear" /> Privacy and settings</Link>
      {me.roles?.includes('admin') && <Link to="/admin"><Icon name="shield" /> Admin</Link>}
    </div>
    <button className="btn ghost block danger" onClick={() => setSignout(true)}><Icon name="logout" /> Sign out</button>
    {signout && <Sheet title="Sign out" onClose={() => setSignout(false)}>
      <div className="stack">
        <button className="btn primary block" onClick={() => doSignout(true)}>Save this account and sign out</button>
        <p className="hint center">Next time, log in with one tap on this device. You can remove it from the login screen or from “Where you’re logged in”.</p>
        <button className="btn ghost block" onClick={() => doSignout(false)}>Don’t save and sign out</button>
      </div>
    </Sheet>}
  </div>;
}
