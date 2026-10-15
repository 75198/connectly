import { api } from '../api';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Composer, ComposerForm } from '../components/Composer';
import { PostList, PullToRefresh, usePosts } from '../components/PostList';
import { StoriesBar } from '../components/Stories';
import { LiveRow } from '../components/LiveRow';
import { Icon } from '../components/ui';
import { getFeatures, useFeatures } from '../api';
import { useT } from '../lib/i18n';
import { MemoriesCard } from './Discover';
import { useNews } from '../components/News';
import { FeedFiller, feedExtra, useBackfill } from '../components/Backfill';
import { useSearchParams } from 'react-router-dom';

function useReels() { const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((f) => setOn(f.reels)); }, []); return on; }
function useLive() { const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((f) => setOn(!!f.live)); }, []); return on; }

export function Feed() {
  const f = useFeatures(); const t = useT(); const [mode, setMode] = useState<'foryou' | 'following'>(() => (localStorage.getItem('cx-feed') as any) || 'foryou');
  const forYou = !!f?.for_you && mode === 'foryou'; const news = useNews(!!f?.news, 10); const bf = useBackfill(!!f?.backfill);
  const feed = usePosts(f === null ? '/feed?wait=1' : forYou ? '/feed/for-you' : '/feed'); const reels = useReels(); const [k, setK] = useState(0);
  // Freshness: poll for newer posts every 60s (show a pill instead of jumping), and refresh when the app is reopened after 10+ minutes.
  const [fresh, setFresh] = useState(0); const topId = feed.items[0]?.id || 0;
  useEffect(() => { if (!topId) return; const i = setInterval(() => { if (document.hidden) return; api<{ items: { id: number }[] }>(`${forYou ? '/feed/for-you' : '/feed'}?limit=5`).then((r) => setFresh(r.items.filter((x) => x.id > topId).length)).catch(() => {}); }, 60000); return () => clearInterval(i); }, [topId, forYou]);
  useEffect(() => { let hiddenAt = 0; const v = () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) { window.scrollTo({ top: 0 }); feed.load(true); setFresh(0); setK((x) => x + 1); } }; document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v); }, [feed]);
  const pick = (m: 'foryou' | 'following') => { setMode(m); localStorage.setItem('cx-feed', m); };
  return <PullToRefresh onRefresh={async () => { await feed.load(true); setK((x) => x + 1); }}><div className="stack">
    <StoriesBar key={k} /><LiveRow key={`lr${k}`} />
    <MemoriesCard />
    <Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />
    {f?.for_you && <div className="feedtabs" role="tablist"><button role="tab" aria-selected={mode === 'foryou'} className={mode === 'foryou' ? 'on' : ''} onClick={() => pick('foryou')}>{t('forYou')}</button><button role="tab" aria-selected={mode === 'following'} className={mode === 'following' ? 'on' : ''} onClick={() => pick('following')}>{t('following')}</button></div>}
    {reels && <Link to="/reels" className="card reelsbanner"><span className="reelsbadge"><Icon name="reel" /></span><span className="grow"><b>Reels</b><small className="meta">Watch short videos from your community</small></span><Icon name="chev" /></Link>}
    {fresh > 0 && <button className="newpill" onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setFresh(0); feed.load(true); }}>↑ New posts</button>}
    <PostList feed={feed} empty={bf.films.length || news.length ? '' : 'No posts yet. Share the first one!'} interleave={(i) => feedExtra(i, news, bf.films, bf.suggested)} />
    {feed.done && feed.items.length < 6 && <FeedFiller news={news} films={bf.films} suggested={feed.items.length > 1 ? [] : bf.suggested} />}</div></PullToRefresh>;
}
export function Compose() {
  const nav = useNavigate(); const reels = useReels(); const live = useLive(); const f = useFeatures(); const [sp] = useSearchParams();
  return <div className="stack"><h1 className="pagetitle">Create</h1>
    <nav className="row wrap createmenu" aria-label="What do you want to create?">
      <span className="chip on"><Icon name="image" /> Post</span>
      {reels && <Link className="chip" to="/reels/new"><Icon name="reel" /> Reel</Link>}
      {live && <Link className="chip golivechip" to="/live/new"><span className="livedot" /> Go Live</Link>}
      {f?.events && <Link className="chip" to="/events/new">📅 Event</Link>}
      {f?.challenges && <Link className="chip" to="/challenges">🏆 Challenge</Link>}
      <Link className="chip" to="/market/new"><Icon name="shop" /> Listing</Link>
      <Link className="chip" to="/create/group"><Icon name="users" /> Group</Link>
    </nav>
    <div className="card"><ComposerForm initialText={sp.get('text') || ''} onPosted={(_p, pub) => nav(pub ? '/' : '/me/drafts')} /></div></div>;
}
