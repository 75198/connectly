import { useNavigate } from 'react-router-dom';
import { Composer } from '../components/Composer';
import { PostList, usePosts } from '../components/PostList';

export function Feed() {
  const feed = usePosts('/feed');
  return <div className="stack"><Composer onPosted={(p) => feed.setItems((x) => [p, ...x])} />
    <PostList feed={feed} empty="No posts yet. Share the first one!" /></div>;
}
export function Compose() {
  const nav = useNavigate();
  return <div className="stack"><h1 className="pagetitle">Create post</h1><Composer autoFocus onPosted={() => nav('/')} /></div>;
}
