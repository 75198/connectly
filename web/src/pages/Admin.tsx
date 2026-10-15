import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';

type AU = { id: number; username: string; display_name: string; email: string; roles: string[]; created_at: string };
type PR = { id: number; username: string; email: string; reset_url: string; expires_at: string };
export function Admin() {
  const { me } = useSession();
  const [users, setUsers] = useState<AU[]>([]); const [resets, setResets] = useState<PR[]>([]); const [err, setErr] = useState('');
  const load = () => Promise.all([api<{ items: AU[] }>('/admin/users'), api<{ items: PR[] }>('/admin/password-resets')]).then(([u, r]) => { setUsers(u.items); setResets(r.items); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!me?.roles?.includes('admin')) return <div className="card empty">Admins only.</div>;
  const setRole = async (u: AU, role: string, on: boolean) => { try { await api(on ? `/admin/users/${u.id}/roles` : `/admin/users/${u.id}/roles/${role}`, on ? { json: { role } } : { method: 'DELETE' }); load(); } catch (e: any) { setErr(e.message); } };
  return <div className="stack">
    <h1 className="pagetitle">Admin</h1>
    {err && <p className="error card">{err}</p>}
    <section className="card"><h3>Pending password-reset links</h3>
      <p className="notice">Email delivery is not configured yet. Send these links to the user yourself (they expire after 1 hour).</p>
      {resets.length === 0 ? <p className="meta">None right now.</p> : resets.map((r) => <div key={r.id} className="resetrow"><b>@{r.username}</b> <span className="meta">{r.email}</span><input readOnly value={r.reset_url} onFocus={(e) => e.target.select()} /></div>)}
    </section>
    <section className="card"><h3>Users ({users.length})</h3>
      <div className="tablewrap"><table><thead><tr><th>User</th><th>Email</th><th>Roles</th><th></th></tr></thead><tbody>
        {users.map((u) => <tr key={u.id}><td><Link to={`/u/${u.username}`}>@{u.username}</Link></td><td>{u.email}</td><td>{u.roles.join(', ') || '—'}</td>
          <td>{u.id !== me.id && (u.roles.includes('admin') ? <button className="chip" onClick={() => setRole(u, 'admin', false)}>Remove admin</button> : <button className="chip" onClick={() => confirm(`Make @${u.username} an admin?`) && setRole(u, 'admin', true)}>Make admin</button>)}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
