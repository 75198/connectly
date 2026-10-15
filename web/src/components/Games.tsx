// In-chat games (round 8): quiz, truth or dare, tic-tac-toe. State lives on the server; cards poll while visible.
import { useEffect, useState } from 'react';
import { api, haptic, toast } from '../api';
import { useSession } from '../session';
import { Sheet } from './ui';

export function GamePicker({ cid, onClose, onStarted }: { cid: number; onClose: () => void; onStarted: (m: any) => void }) {
  const start = async (kind: string) => { try { const r = await api<{ message: any }>(`/conversations/${cid}/games`, { json: { kind } }); haptic(); onStarted(r.message); } catch (e: any) { toast(e.message, 'err'); } };
  const G = [['quiz', '🧠', 'Quiz', 'Five quick questions. Most right answers wins.'], ['truth_dare', '🎲', 'Truth or dare', 'Take turns. Pick truth, dare or pass.'], ['tictactoe', '⭕', 'Tic-tac-toe', 'Classic three in a row for two players.']];
  return <Sheet title="Play a game" onClose={onClose}><div className="list">{G.map(([k, e, n, d]) => <button key={k} className="row optrow gamepick" onClick={() => start(k)}><span className="gameicon">{e}</span><span className="grow"><b>{n}</b><small className="meta">{d}</small></span></button>)}</div></Sheet>;
}

export function GameCard({ gameId }: { gameId: number }) {
  const { me } = useSession(); const [g, setG] = useState<any>(null); const [err, setErr] = useState('');
  useEffect(() => { let stop = false; const load = () => api(`/games/${gameId}`).then((x) => !stop && setG(x)).catch((e) => setErr(e.message)); load(); const i = setInterval(load, 3000); return () => { stop = true; clearInterval(i); }; }, [gameId]);
  const move = async (body: any) => { try { setG(await api(`/games/${gameId}/move`, { json: body })); haptic(); } catch (e: any) { toast(e.message, 'err'); } };
  if (err) return <div className="bubble">{err}</div>;
  if (!g) return <div className="gamecard"><div className="spinner sm" /></div>;
  if (g.kind === 'tictactoe') {
    const myMark = g.x === me!.id ? 'x' : g.o === me!.id ? 'o' : null; const status = g.winner ? (g.winner === myMark ? 'You won! 🎉' : myMark ? 'You lost' : `${g.winner.toUpperCase()} wins`) : g.draw ? 'It’s a draw' : !g.o && g.x !== me!.id ? 'Tap a square to join' : g.next === myMark ? 'Your turn' : 'Waiting for the other player';
    return <div className="gamecard"><b>⭕ Tic-tac-toe</b><div className="ttt">{g.board.map((c: string | null, i: number) => <button key={i} className={c || ''} disabled={!!c || !!g.winner || g.draw} onClick={() => move({ cell: i })}>{c === 'x' ? '✕' : c === 'o' ? '◯' : ''}</button>)}</div><small className="meta">{status}</small></div>;
  }
  if (g.kind === 'quiz') {
    const mine = g.scores?.[me!.id] || 0;
    if (g.done) { const best = Math.max(...Object.values(g.scores as Record<string, number>)); return <div className="gamecard"><b>🧠 Quiz finished</b><p>{mine === best ? 'You top the board! 🏆' : 'Good game!'}</p><small className="meta">Your score: {mine} of {g.total}</small></div>; }
    return <div className="gamecard"><b>🧠 Question {g.index + 1} of {g.total}</b><p>{g.question.text}</p>
      <div className="quizopts">{g.question.options.map((o: string, i: number) => <button key={i} className={g.my_answer === i ? 'on' : ''} disabled={g.my_answer !== null} onClick={() => move({ answer: i })}>{o}</button>)}</div>
      <small className="meta">{g.my_answer !== null ? 'Waiting for others…' : 'Pick an answer'}{g.last ? ` · Last answer: ${['A', 'B', 'C', 'D'][g.last.correct]}` : ''}</small>
      {g.my_answer !== null && <button className="linkish" onClick={() => move({ answer: g.my_answer, next: true })} hidden>Next</button>}</div>;
  }
  const myTurn = g.turn === me!.id;
  return <div className="gamecard"><b>🎲 Truth or dare</b>{g.prompt ? <p className={`tdprompt ${g.type}`}><small>{g.type === 'truth' ? 'TRUTH' : 'DARE'}</small>{g.prompt}</p> : <p className="meta">{myTurn ? 'Your turn. Choose one.' : 'Waiting for the next player…'}</p>}
    {myTurn && <div className="row"><button className="btn ghost grow" onClick={() => move({ action: 'truth' })}>Truth</button><button className="btn ghost grow" onClick={() => move({ action: 'dare' })}>Dare</button><button className="btn ghost" onClick={() => move({ action: 'pass' })}>{g.prompt ? 'Done' : 'Pass'}</button></div>}</div>;
}
