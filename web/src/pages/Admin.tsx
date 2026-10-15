import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';
import { AdminLive } from '../components/LiveRow';

type AU = { id: number; username: string; full_name: string; email: string; roles: string[]; created_at: string };
type Rep = { id: number; target_type: 'post' | 'user'; reason: string; status: string; resolution: string; created_at: string; post_id: number | null; post_body: string | null; post_hidden_at: string | null;
  reporter: { id: number; username: string }; target_user: { id: number; username: string; full_name: string; suspended_at: string | null } | null; reports_against_user: number };
type St = { smtp_configured: boolean; note: string };
export function Admin() {
  const { me } = useSession();
  const [users, setUsers] = useState<AU[]>([]); const [status, setStatus] = useState<St | null>(null); const [err, setErr] = useState('');
  const [reports, setReports] = useState<Rep[]>([]); const [rstatus, setRstatus] = useState('open');
  const loadReports = (st = rstatus) => api<{ items: Rep[] }>(`/admin/reports?status=${st}`).then((r) => setReports(r.items)).catch((e) => setErr(e.message));
  const load = () => { loadReports(); return Promise.all([api<{ items: AU[] }>('/admin/users'), api<St>('/admin/status')]).then(([u, r]) => { setUsers(u.items); setStatus(r); }).catch((e) => setErr(e.message)); };
  const act = async (path: string, ask?: string, json: unknown = {}) => { if (ask && !confirm(ask)) return; try { await api(path, { json }); load(); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { load(); }, []);
  if (!me?.roles?.includes('admin')) return <div className="card empty">Admins only.</div>;
  const setRole = async (u: AU, role: string, on: boolean) => { try { await api(on ? `/admin/users/${u.id}/roles` : `/admin/users/${u.id}/roles/${role}`, on ? { json: { role } } : { method: 'DELETE' }); load(); } catch (e: any) { setErr(e.message); } };
  return <div className="stack"><AdminLive />
    <h1 className="pagetitle">Admin</h1>
    {err && <p className="error card">{err}</p>}
    {status && <section className="card"><h3>Email delivery</h3><p className={status.smtp_configured ? 'success' : 'notice'}>{status.note}</p></section>}
    <section className="card"><div className="row between"><h3>Moderation queue</h3>
        <select value={rstatus} onChange={(e) => { setRstatus(e.target.value); loadReports(e.target.value); }} aria-label="Report status"><option value="open">Open</option><option value="actioned">Actioned</option><option value="dismissed">Dismissed</option><option value="all">All</option></select></div>
      {reports.length === 0 ? <p className="meta">No {rstatus === 'all' ? '' : rstatus + ' '}reports.</p> : <div className="stack">
        {reports.map((r) => <div key={r.id} className="card">
          <div className="meta">#{r.id} · {r.target_type === 'post' ? 'Post' : 'Account'} reported by @{r.reporter.username} · {new Date(r.created_at).toLocaleString()} · {r.status}{r.resolution && ` (${r.resolution})`}</div>
          <p><b>Reason:</b> {r.reason}</p>
          {r.target_user && <p>Account: <Link to={`/u/${r.target_user.username}`}>@{r.target_user.username}</Link> ({r.target_user.full_name}) · {r.reports_against_user} report{r.reports_against_user === 1 ? '' : 's'} total{r.target_user.suspended_at && ' · suspended'}</p>}
          {r.post_body !== null && <blockquote className="meta">{r.post_body || '(photo only)'}{r.post_hidden_at && ' · hidden'}</blockquote>}
          <div className="row">
            {r.post_id && (r.post_hidden_at ? <button className="chip" onClick={() => act(`/admin/posts/${r.post_id}/unhide`)}>Unhide post</button> : <button className="chip" onClick={() => act(`/admin/posts/${r.post_id}/hide`, 'Hide this post from everyone? You can unhide it later.')}>Hide post</button>)}
            {r.target_user && (r.target_user.suspended_at ? <button className="chip" onClick={() => act(`/admin/users/${r.target_user!.id}/unsuspend`)}>Unsuspend</button> : <button className="chip" onClick={() => act(`/admin/users/${r.target_user!.id}/suspend`, `Suspend @${r.target_user!.username}? They will be signed out and can’t log in until unsuspended.`, { reason: r.reason.slice(0, 300) })}>Suspend user</button>)}
            {r.status === 'open' && <button className="chip" onClick={() => act(`/admin/reports/${r.id}/dismiss`)}>Dismiss</button>}
          </div>
        </div>)}
      </div>}
    </section>
    <section className="card"><h3>Users ({users.length})</h3>
      <div className="tablewrap"><table><thead><tr><th>User</th><th>Email</th><th>Verified</th><th>Roles</th><th></th></tr></thead><tbody>
        {users.map((u) => <tr key={u.id}><td><Link to={`/u/${u.username}`}>@{u.username}</Link></td><td>{u.email}</td><td>{(u as any).email_verified ? '✓' : '—'}</td><td>{u.roles.join(', ') || '—'}{(u as any).suspended_at && ' · suspended'}</td>
          <td>{u.id !== me.id && (u.roles.includes('admin') ? <button className="chip" onClick={() => setRole(u, 'admin', false)}>Remove admin</button> : <button className="chip" onClick={() => confirm(`Make @${u.username} an admin?`) && setRole(u, 'admin', true)}>Make admin</button>)}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
