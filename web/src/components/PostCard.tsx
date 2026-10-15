import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authorHref, Comment, Post, REACTIONS, Reaction, feelingEmoji, haptic, postTime, timeAgo, toast } from '../api';
import { useSession } from '../session';
import { Avatar, Icon, Sheet, UserLink, VIS_ICON, VIS_LABEL } from './ui';
import { EngagementSheet, trackShare, type EngTab } from './Engagement';

type Mode = 'feed' | 'draft' | 'deleted';
export function PostCard({ post, onChange, onDelete, mode = 'feed' }: { post: Post; onChange: (p: Post) => void; onDelete: (id: number) => void; mode?: Mode }) {
  const { me } = useSession();
  const mine = post.is_mine;
  const [menu, setMenu] = useState(false); const [confirmDel, setConfirmDel] = useState(false); const [share, setShare] = useState(false); const [eng, setEng] = useState<EngTab | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body); const [dvis, setDvis] = useState(post.visibility);
  const [showComments, setShowComments] = useState(false);
  const [picker, setPicker] = useState(false); const press = useRef<number>();
  const [err, setErr] = useState('');
  const myR = (post.my_reaction || (post.liked_by_me ? 'like' : null)) as Reaction | null;
  const rInfo = REACTIONS.find((r) => r.k === myR);

  async function react(r: Reaction | null) {
    setPicker(false); haptic();
    const was = !!myR; const prev = post;
    const counts = { ...(post.reactions || {}) }; if (myR) counts[myR] = Math.max(0, (counts[myR] || 1) - 1); if (r) counts[r] = (counts[r] || 0) + 1;
    onChange({ ...post, liked_by_me: !!r, my_reaction: r, reactions: counts, like_count: post.like_count + (r ? (was ? 0 : 1) : -1) });
    try { const res = await api<{ liked_by_me: boolean; like_count: number }>(`/posts/${post.id}/like`, r ? { method: 'PUT', json: { reaction: r } } : { method: 'DELETE' }); onChange({ ...post, ...res, my_reaction: r, reactions: counts }); }
    catch (e: any) { onChange(prev); setErr(e.message); }
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { onChange(await api<Post>(`/posts/${post.id}`, { method: 'PATCH', json: { body: draft, visibility: dvis } })); setEditing(false); toast('Post updated'); }
    catch (e: any) { setErr(e.message); }
  }
  async function report() {
    const reason = prompt('Why are you reporting this post? (spam, harassment, hate speech, scam…)');
    if (!reason || !reason.trim()) return;
    try { await api('/reports', { json: { target_type: 'post', post_id: post.id, reason: reason.trim() } }); toast('Thanks. Our moderators will review this post.'); } catch (e: any) { setErr(e.message); }
  }
  const act = async (fn: () => Promise<unknown>, msg: string, remove = true) => { setMenu(false); setConfirmDel(false); try { await fn(); toast(msg); haptic(); if (remove) onDelete(post.id); } catch (e: any) { setErr(e.message); } };
  const toDraft = () => act(() => api(`/posts/${post.id}/draft`, { method: 'POST' }), 'Moved to Drafts');
  const del = () => act(() => api(`/posts/${post.id}`, { method: 'DELETE' }), 'Moved to Recently deleted. You can restore it for 30 days.');
  const toggleSave = async () => { setMenu(false); try { const r = await api<{ saved_by_me: boolean }>(`/posts/${post.id}/save`, { method: post.saved_by_me ? 'DELETE' : 'PUT' }); onChange({ ...post, saved_by_me: r.saved_by_me }); toast(r.saved_by_me ? 'Saved' : 'Removed from Saved'); } catch (e: any) { setErr(e.message); } };
  const top = Object.entries(post.reactions || {}).filter(([, n]) => (n || 0) > 0).sort((a, b) => (b[1] || 0) - (a[1] || 0)).slice(0, 3).map(([k]) => REACTIONS.find((r) => r.k === k)?.e);
  const edited = new Date(post.updated_at).getTime() - new Date(post.created_at).getTime() > 1000;
  return (
    <article className={`card post ${mode !== 'feed' ? 'muted' : ''}`}>
      <header className="row between">
        <div className="row grow">
          <Link to={authorHref(post.author)}><Avatar user={post.author} size={42} /></Link>
          <div className="grow"><UserLink user={post.author} />
            {post.feeling && <span className="meta"> is feeling {feelingEmoji(post.feeling)} {post.feeling}</span>}
            {post.location_tag && <span className="meta"> at <b>{post.location_tag}</b></span>}
            {post.space && !post.author.space && <> <span className="meta">▸</span> <Link className="ulink" to={`/s/${post.space.slug}`}>{post.space.name}</Link></>}
            <div className="meta posttime"><time dateTime={post.created_at} title={new Date(post.created_at).toLocaleString()}>{mode === 'deleted' && post.deleted_at ? `Deleted ${postTime(post.deleted_at)}` : mode === 'draft' ? `Draft · saved ${postTime(post.updated_at)}` : postTime(post.created_at)}</time>
              {mode === 'feed' && edited && <> · <span title={`Edited ${new Date(post.updated_at).toLocaleString()}`}>Edited</span></>} · <span title={VIS_LABEL[post.visibility]} className="vis"><Icon name={VIS_ICON[post.visibility]} /></span></div>
          </div>
        </div>
        {mode === 'feed' && <div className="menuwrap"><button className="btn icon ghost" aria-label="Post options" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
          {menu && <><div className="menuscrim" onClick={() => setMenu(false)} /><div className="menu" role="menu">
            {mine && <button role="menuitem" onClick={() => { setEditing(true); setMenu(false); }}><Icon name="gear" /> Edit post</button>}
            {mine && post.kind !== 'reel' && <button role="menuitem" onClick={toDraft}><Icon name="image" /> Save as draft</button>}
            <button role="menuitem" onClick={toggleSave}><Icon name="bookmark" /> {post.saved_by_me ? 'Unsave post' : 'Save post'}</button>
            {!mine && me && !post.author.space && <button role="menuitem" onClick={() => { setMenu(false); report(); }}><Icon name="flag" /> Report post</button>}
            {mine && <button role="menuitem" className="danger" onClick={() => { setMenu(false); setConfirmDel(true); }}><Icon name="x" /> Delete post</button>}
          </div></>}</div>}
      </header>
      {editing ? (
        <form onSubmit={save} className="stack">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={5000} autoFocus />
          <div className="row between"><select value={dvis} onChange={(e) => setDvis(e.target.value as any)}><option value="public">🌍 Public</option><option value="friends">👥 Friends</option><option value="private">🔒 Only me</option></select>
            <div className="row"><button type="button" className="btn ghost" onClick={() => { setEditing(false); setDraft(post.body); }}>Cancel</button><button className="btn primary">Save</button></div></div>
        </form>
      ) : post.body && <p className="body">{post.body}</p>}
      {post.image_path && post.kind !== 'reel' && <img className="postimg" src={post.image_path} alt="" loading="lazy" decoding="async" />}
      {post.kind === 'reel' && post.poster_path && <Link to={`/reels/${post.id}`} className="reelthumb" aria-label="Watch reel"><img src={post.poster_path} alt="" loading="lazy" /><span><Icon name="play" /> Reel{post.view_count ? ` · ${post.view_count} views` : ''}</span></Link>}
      {err && <p className="error">{err}</p>}
      {mode === 'draft' && <div className="row"><button className="btn primary grow" onClick={() => act(() => api(`/posts/${post.id}/publish`, { method: 'POST' }), 'Published')}>Publish</button>
        <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn ghost danger" onClick={() => confirm('Delete this draft forever?') && act(() => api(`/posts/${post.id}/permanent`, { method: 'DELETE' }), 'Draft deleted')}>Delete</button></div>}
      {mode === 'deleted' && <div className="row"><button className="btn primary grow" onClick={() => act(() => api(`/posts/${post.id}/restore`, { method: 'POST' }), 'Post restored')}>Restore</button>
        <button className="btn ghost danger" onClick={() => confirm('Delete this post forever? This cannot be undone.') && act(() => api(`/posts/${post.id}/permanent`, { method: 'DELETE' }), 'Deleted forever')}>Delete forever</button></div>}
      {mode === 'feed' && <>
        <div className="counts meta">{post.like_count > 0 && <button className="rcount countbtn" aria-label="See who reacted" onClick={() => setEng('reactions')}>{(top.length ? top : ['👍']).map((e, i) => <i key={i}>{e}</i>)} {post.like_count}</button>}<span className="grow" />{post.comment_count > 0 && <button className="linkish" onClick={() => setEng('comments')}>{post.comment_count} comment{post.comment_count === 1 ? '' : 's'}</button>}{(post.share_count || 0) > 0 && <button className="linkish" onClick={() => setEng('shares')}>{post.share_count} share{post.share_count === 1 ? '' : 's'}</button>}</div>
        <div className="actions">
          <div className="reactwrap">
            {picker && <><div className="menuscrim" onClick={() => setPicker(false)} /><div className="reactbar" role="menu" aria-label="Reactions">{REACTIONS.map((r, i) => <button key={r.k} role="menuitem" style={{ animationDelay: `${i * 30}ms` }} aria-label={r.label} title={r.label} onClick={() => react(r.k)}>{r.e}</button>)}</div></>}
            <button className={`btn ghost ${myR ? `liked r-${myR}` : ''}`} aria-pressed={!!myR}
              onClick={() => react(myR ? null : 'like')} onContextMenu={(e) => { e.preventDefault(); setPicker(true); }}
              onPointerDown={() => { press.current = window.setTimeout(() => { setPicker(true); haptic(12); }, 450); }} onPointerUp={() => clearTimeout(press.current)} onPointerLeave={() => clearTimeout(press.current)}>
              {rInfo ? <span className="remoji">{rInfo.e}</span> : <Icon name="heart" />} {rInfo ? rInfo.label : 'Like'}</button>
            <button className="btn icon ghost reactmore" aria-label="Choose a reaction" onClick={() => setPicker(!picker)}>☺</button>
          </div>
          <button className="btn ghost" onClick={() => setShowComments(!showComments)}><Icon name="chat" /> Comment</button>
          <button className="btn ghost" onClick={() => setShare(true)}><Icon name="share" /> Share</button>
        </div>
        {showComments && <Comments post={post} onCount={(n) => onChange({ ...post, comment_count: n })} />}
      </>}
      {confirmDel && <Sheet title="Delete post?" onClose={() => setConfirmDel(false)}>
        <div className="stack"><p className="center"><b>Are you sure you want to delete this post?</b></p>
          <p className="meta center">It will move to Recently deleted, where you can restore it for 30 days. Want to change something instead? You can edit it.</p>
          <button className="btn ghost block" onClick={() => { setConfirmDel(false); setEditing(true); }}><Icon name="gear" /> Edit post instead</button>
          {post.kind !== 'reel' && <button className="btn ghost block" onClick={toDraft}>Move to Drafts</button>}
          <button className="btn block dangerbtn" onClick={del}>Delete</button>
          <button className="btn ghost block" onClick={() => setConfirmDel(false)}>Cancel</button></div></Sheet>}
      {eng && <EngagementSheet post={post} tab={eng} onClose={() => setEng(null)} />}
      {share && <ShareSheet onShared={(c) => { trackShare(post.id, c); onChange({ ...post, share_count: (post.share_count || 0) + 1 }); }} url={`${location.origin}${post.kind === 'reel' ? '/reels/' : '/post/'}${post.id}`} text={post.body.slice(0, 120)} onClose={() => setShare(false)} />}
    </article>
  );
}

export function ShareSheet({ url, text, onClose: close, onShared }: { url: string; text: string; onClose: () => void; onShared?: (channel: string) => void }) {
  const enc = encodeURIComponent; const msg = text ? `${text} ${url}` : url;
  const onClose = () => close(); const did = (c: string) => () => { onShared?.(c); close(); };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); } did('copy_link')(); };
  const native = async () => { try { await navigator.share({ title: 'Connectly', text, url }); did('native')(); } catch { onClose(); } };
  return <Sheet title="Share" onClose={onClose}><div className="sharegrid">
    {typeof navigator !== 'undefined' && 'share' in navigator && <button onClick={native}><span className="shareic" style={{ background: '#0F766E' }}><Icon name="share" /></span>Share via…</button>}
    <button onClick={copy}><span className="shareic" style={{ background: '#475569' }}>🔗</span>Copy link</button>
    <a href={`https://wa.me/?text=${enc(msg)}`} target="_blank" rel="noopener noreferrer" onClick={did('whatsapp')}><span className="shareic" style={{ background: '#25D366' }}>💬</span>WhatsApp</a>
    <a href={`https://twitter.com/intent/tweet?text=${enc(msg)}`} target="_blank" rel="noopener noreferrer" onClick={did('x')}><span className="shareic" style={{ background: '#000' }}>𝕏</span>X</a>
    <a href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`} target="_blank" rel="noopener noreferrer" onClick={did('facebook')}><span className="shareic" style={{ background: '#1877F2' }}>f</span>Facebook</a>
    <a href={`mailto:?subject=${enc('Look at this on Connectly')}&body=${enc(msg)}`} onClick={did('email')}><span className="shareic" style={{ background: '#F59E0B' }}>✉️</span>Email</a>
  </div></Sheet>;
}

export function Comments({ post, onCount }: { post: Post; onCount: (n: number) => void }) {
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
          {(c.is_mine || post.is_mine) && <button className="linkish" onClick={() => remove(c)}>Delete</button>}</div>
      </div>
    </div>
  );
  return (
    <div className="comments">
      {err && <p className="error">{err}</p>}
      {top.map((c) => <div key={c.id}>{one(c)}{items.filter((r) => r.parent_id === c.id).map((r) => one(r, true))}</div>)}
      {replyTo && <div className="meta small">Replying to {replyTo.author.full_name} · <button className="linkish" onClick={() => setReplyTo(null)}>cancel</button></div>}
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
