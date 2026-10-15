import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, useFeatures } from '../api';
import { PostList, usePosts } from '../components/PostList';
import { Icon } from '../components/ui';

// Drafts, Recently deleted and Saved — reached from the Profile hub.
const TABS = [['drafts', 'Drafts'], ['deleted', 'Recently deleted'], ['saved', 'Saved']] as const;
export function MyPosts() {
  const { tab = 'drafts' } = useParams(); const t = TABS.some(([k]) => k === tab) ? tab : 'drafts';
  const [sp, setSp] = useSearchParams(); const coll = Number(sp.get('c')) || 0; const ff = useFeatures();
  const feed = usePosts(t === 'saved' && coll ? `/collections/${coll}/posts` : `/me/${t}`);
  const [colls, setColls] = useState<{ id: number; name: string; count: number; cover: string | null }[]>([]);
  useEffect(() => { if (t === 'saved' && ff?.collections) api<{ items: any[] }>('/collections').then((r) => setColls(r.items)).catch(() => {}); }, [t, ff?.collections]);
  return <div className="stack">
    <div className="row"><Link to="/me" className="btn icon ghost" aria-label="Back"><Icon name="back" /></Link><h1 className="pagetitle">Your posts</h1></div>
    <div className="segmented">{TABS.map(([k, l]) => <Link key={k} to={`/me/${k}`} className={t === k ? 'on' : ''} replace>{l}</Link>)}</div>
    {t === 'deleted' && <p className="meta pad">Deleted posts stay here for 30 days, then they’re removed for good.</p>}
    {t === 'saved' && colls.length > 0 && <div className="row wrap"><button className={`chip ${!coll ? 'on' : ''}`} onClick={() => setSp({})}>All posts</button>{colls.map((c) => <button key={c.id} className={`chip ${coll === c.id ? 'on' : ''}`} onClick={() => setSp({ c: String(c.id) })}>📁 {c.name}</button>)}</div>}
    <PostList key={t + coll} feed={feed} mode={t === 'drafts' ? 'draft' : t === 'deleted' ? 'deleted' : 'feed'}
      empty={t === 'drafts' ? 'No drafts. Use “Save draft” when creating a post.' : t === 'deleted' ? 'Nothing deleted in the last 30 days.' : 'No saved posts yet. Tap ⋯ on a post and choose Save post.'} />
  </div>;
}
