import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Comment, Post, timeAgo } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, UserLink, VIS_ICON, VIS_LABEL } from './ui';

export function PostCard({ post, onChange, onDelete }: { post: Post; onChange: (p: Post) => void; onDelete: (id: number) => void }) {
  const { me } = useSession();
  const mine = me?.id === post.author.id;
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body); const [dvis, setDvis] = useState(post.visibility);
  const [showComments, setShowComments] = useState(false);
  const [err, setErr] = useState('');

  async function toggleLike() {
    const was = post.liked_by_me;
    onChange({ ...post, liked_by_me: !was, like_count: post.like_count + (was ? -1 : 1) });
    try { const r = await api<{ liked_by_me: boolean; like_count: number }>(`/posts/${post.id}/like`, { method: was ? 'DELETE' : 'PUT' }); onChange({ ...post, ...r }); }
    catch (e: any) { onChange(post); setErr(e.message); }
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { onChange(await api<Post>(`/posts/${post.id}`, { method: 'PATCH', json: { body: draft, visibility: dvis } })); setEditing(false); }
    catch (e: any) { setErr(e.message); }
  }
  async function del() {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    try { await api(`/posts/${post.id}`, { method: 'DELETE' }); onDelete(post.id); } catch (e: any) { setErr(e.message); }
  }
  return (
    <article className="card post">
      <header className="row between">
        <div className="row">
          <Link to={`/u/${post.author.username}`}><Avatar user={post.author} /></Link>
          <div><UserLink user={post.author} />
            <div className="meta"><time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>{timeAgo(post.created_at)}</time>{post.updated_at !== post.created_at && ' · edited'} · <span title={VIS_LABEL[post.visibility]} className="vis"><Icon name={VIS_ICON[post.visibility]} /></span></div>
          </div>
        </div>
        {mine && <div className="menuwrap"><button className="btn icon ghost" aria-label="Post options" onClick={() => setMenu(!menu)}><Icon name="more" /></button>
          {menu && <div className="menu" onMouseLeave={() => setMenu(false)}><button onClick={() => { setEditing(true); setMenu(false); }}>Edit post</button><button className="danger" onClick={() => { setMenu(false); del(); }}>Delete post</button></div>}</div>}
      </header>
      {editing ? (
        <form onSubmit={save} className="stack">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={5000} />
          <div className="row between"><select value={dvis} onChange={(e) => setDvis(e.target.value as any)}><option value="public">🌍 Public</option><option value="friends">👥 Friends</option><option value="private">🔒 Only me</option></select>
            <div className="row"><button type="button" className="btn ghost" onClick={() => { setEditing(false); setDraft(post.body); }}>Cancel</button><button className="btn primary">Save</button></div></div>
        </form>
      ) : post.body && <p className="body">{post.body}</p>}
      {post.image_path && <img className="postimg" src={post.image_path} alt="" loading="lazy" />}
      {err && <p className="error">{err}</p>}
      <div className="counts meta">{post.like_count > 0 && <span>❤️ {post.like_count}</span>}<span className="grow" />{post.comment_count > 0 && <button className="linkish" onClick={() => setShowComments(true)}>{post.comment_count} comment{post.comment_count === 1 ? '' : 's'}</button>}</div>
      <div className="actions">
        <button className={`btn ghost ${post.liked_by_me ? 'liked' : ''}`} onClick={toggleLike} aria-pressed={post.liked_by_me}><Icon name={post.liked_by_me ? 'heartFill' : 'heart'} /> {post.liked_by_me ? 'Liked' : 'Like'}</button>
        <button className="btn ghost" onClick={() => setShowComments(!showComments)}><Icon name="chat" /> Comment</button>
      </div>
      {showComments && <Comments post={post} onCount={(n) => onChange({ ...post, comment_count: n })} />}
    </article>
  );
}

function Comments({ post, onCount }: { post: Post; onCount: (n: number) => void }) {
  const { me } = useSession();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [err, setErr] = useState('');
  const load = async () => { const r = await api<{ items: Comment[] }>(`/posts/${post.id}/comments`); setItems(r.items); onCount(r.items.length); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [post.id]);
  async function add(body: string, parent_id?: number) {
    await api(`/posts/${post.id}/comments`, { json: { body, parent_id } }); setReplyTo(null); await load();
  }
  async function remove(c: Comment) { if (!confirm('Delete this comment?')) return; try { await api(`/comments/${c.id}`, { method: 'DELETE' }); await load(); } catch (e: any) { setErr(e.message); } }
  if (!items) return <p className="meta pad">{err || 'Loading comments…'}</p>;
  const top = items.filter((c) => !c.parent_id);
  const one = (c: Comment, isReply = false) => (
    <div key={c.id} className={`comment ${isReply ? 'reply' : ''}`}>
      <Avatar user={c.author} size={30} />
      <div className="grow"><div className="bubble"><UserLink user={c.author} /><p>{c.body}</p></div>
        <div className="meta row small"><time title={new Date(c.created_at).toLocaleString()}>{timeAgo(c.created_at)}</time>
          <button className="linkish" onClick={() => setReplyTo(c)}>Reply</button>
          {(me?.id === c.author.id || me?.id === post.author.id) && <button className="linkish" onClick={() => remove(c)}>Delete</button>}</div>
      </div>
    </div>
  );
  return (
    <div className="comments">
      {err && <p className="error">{err}</p>}
      {top.map((c) => <div key={c.id}>{one(c)}{items.filter((r) => r.parent_id === c.id).map((r) => one(r, true))}</div>)}
      {replyTo && <div className="meta small">Replying to {replyTo.author.display_name} · <button className="linkish" onClick={() => setReplyTo(null)}>cancel</button></div>}
      <CommentBox key={replyTo?.id ?? 0} placeholder={replyTo ? 'Write a reply…' : 'Write a comment…'} onSubmit={(b) => add(b, replyTo?.id)} />
    </div>
  );
}
function CommentBox({ onSubmit, placeholder }: { onSubmit: (b: string) => Promise<void>; placeholder: string }) {
  const [v, setV] = useState(''); const [err, setErr] = useState('');
  return <form className="row commentbox" onSubmit={async (e) => { e.preventDefault(); if (!v.trim()) return; try { await onSubmit(v); setV(''); } catch (x: any) { setErr(x.message); } }}>
    <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} maxLength={2000} autoFocus={placeholder.includes('reply')} /><button className="btn primary" disabled={!v.trim()}>Send</button>{err && <span className="error">{err}</span>}
  </form>;
}
