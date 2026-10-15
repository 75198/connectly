import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Composer, ComposerForm } from '../components/Composer';
import { PostList, PullToRefresh, usePosts } from '../components/PostList';
import { StoriesBar } from '../components/Stories';
import { Icon } from '../components/ui';
import { getFeatures } from '../api';

function useReels() { const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((f) => setOn(f.reels)); }, []); return on; }

export function Feed() {
  const feed = usePosts('/feed'); const reels = useReels(); const [k, setK] = useState(0);
  return <PullToRefresh onRefresh={async () => { await feed.load(true); setK((x) => x + 1); }}><div className="stack">
    <StoriesBar key={k} />
    <Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />
    {reels && <Link to="/reels" className="card reelsbanner"><span className="reelsbadge"><Icon name="reel" /></span><span className="grow"><b>Reels</b><small className="meta">Watch short videos from your community</small></span><Icon name="chev" /></Link>}
    <PostList feed={feed} empty="No posts yet. Share the first one!" /></div></PullToRefresh>;
}
export function Compose() {
  const nav = useNavigate(); const reels = useReels();
  return <div className="stack"><h1 className="pagetitle">Create</h1>
    <nav className="row wrap createmenu" aria-label="What do you want to create?">
      <span className="chip on"><Icon name="image" /> Post</span>
      {reels && <Link className="chip" to="/reels/new"><Icon name="reel" /> Reel</Link>}
      <Link className="chip" to="/market/new"><Icon name="shop" /> Listing</Link>
      <Link className="chip" to="/create/group"><Icon name="users" /> Group</Link>
    </nav>
    <div className="card"><ComposerForm onPosted={(_p, pub) => nav(pub ? '/' : '/me/drafts')} /></div></div>;
}
