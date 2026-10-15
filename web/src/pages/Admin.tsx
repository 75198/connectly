import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../session';

type AU = { id: number; username: string; display_name: string; email: string; roles: string[]; created_at: string };
type St = { smtp_configured: boolean; note: string };
export function Admin() {
  const { me } = useSession();
  const [users, setUsers] = useState<AU[]>([]); const [status, setStatus] = useState<St | null>(null); const [err, setErr] = useState('');
  const load = () => Promise.all([api<{ items: AU[] }>('/admin/users'), api<St>('/admin/status')]).then(([u, r]) => { setUsers(u.items); setStatus(r); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!me?.roles?.includes('admin')) return <div className="card empty">Admins only.</div>;
  const setRole = async (u: AU, role: string, on: boolean) => { try { await api(on ? `/admin/users/${u.id}/roles` : `/admin/users/${u.id}/roles/${role}`, on ? { json: { role } } : { method: 'DELETE' }); load(); } catch (e: any) { setErr(e.message); } };
  return <div className="stack">
    <h1 className="pagetitle">Admin</h1>
    {err && <p className="error card">{err}</p>}
    {status && <section className="card"><h3>Email delivery</h3><p className={status.smtp_configured ? 'success' : 'notice'}>{status.note}</p></section>}
    <section className="card"><h3>Users ({users.length})</h3>
      <div className="tablewrap"><table><thead><tr><th>User</th><th>Email</th><th>Verified</th><th>Roles</th><th></th></tr></thead><tbody>
        {users.map((u) => <tr key={u.id}><td><Link to={`/u/${u.username}`}>@{u.username}</Link></td><td>{u.email}</td><td>{(u as any).email_verified ? '✓' : '—'}</td><td>{u.roles.join(', ') || '—'}</td>
          <td>{u.id !== me.id && (u.roles.includes('admin') ? <button className="chip" onClick={() => setRole(u, 'admin', false)}>Remove admin</button> : <button className="chip" onClick={() => confirm(`Make @${u.username} an admin?`) && setRole(u, 'admin', true)}>Make admin</button>)}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
