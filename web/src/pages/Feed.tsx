import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Composer } from '../components/Composer';
import { PostList, usePosts } from '../components/PostList';
import { Icon } from '../components/ui';
import { getFeatures } from '../api';

function useReels() { const [on, setOn] = useState(false); useEffect(() => { getFeatures().then((f) => setOn(f.reels)); }, []); return on; }

export function Feed() {
  const feed = usePosts('/feed'); const reels = useReels();
  return <div className="stack">
    {reels && <Link to="/reels" className="card reelsbanner"><span className="reelsbadge"><Icon name="reel" /></span><span className="grow"><b>Reels</b><small className="meta">Watch short videos from your community</small></span><Icon name="chev" /></Link>}
    <Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />
    <PostList feed={feed} empty="No posts yet. Share the first one!" /></div>;
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
    <Composer autoFocus onPosted={() => nav('/')} /></div>;
}
