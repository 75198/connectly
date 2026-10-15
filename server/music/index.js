// Pluggable music catalog (round 8, FEATURE_MUSIC). A provider exposes { name, list() } returning tracks
// { external_id, title, artist, duration_seconds, url, license, source_url, mood }. Tracks are upserted into music_tracks
// on start, so posts/stories/reels reference a stable id. To add a licensed catalog later, write a provider module,
// register it in PROVIDERS and give it credentials via .env. Only bundled royalty-free tracks ship today (see docs/CREDITS.md).
import fs from 'node:fs';
import { q } from '../db.js';

const bundled = {
  name: 'bundled',
  async list() {
    const cat = JSON.parse(fs.readFileSync(new URL('./bundled-catalog.json', import.meta.url), 'utf8'));
    return cat.map((t) => ({ external_id: t.id, title: t.title, artist: t.artist, duration_seconds: t.duration, url: t.url, license: t.license, source_url: t.source_url, mood: t.mood }));
  },
};
export const PROVIDERS = [bundled];

export async function syncMusic() {
  let n = 0;
  for (const p of PROVIDERS) {
    for (const t of await p.list()) {
      await q(`INSERT INTO music_tracks (provider, external_id, title, artist, duration_seconds, url, license, source_url, mood) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (provider, external_id) DO UPDATE SET title = EXCLUDED.title, artist = EXCLUDED.artist, duration_seconds = EXCLUDED.duration_seconds, url = EXCLUDED.url, license = EXCLUDED.license, source_url = EXCLUDED.source_url, mood = EXCLUDED.mood`,
      [p.name, t.external_id, t.title, t.artist, t.duration_seconds, t.url, t.license, t.source_url, t.mood]);
      n++;
    }
  }
  return n;
}
