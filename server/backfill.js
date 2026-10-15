// Content backfill (flag FEATURE_BACKFILL) so Home and Reels never look empty:
// - short vertical clips cut from Blender open movies (CC BY 3.0, credited) bundled in /backfill
// - public-domain / CC films from the Internet Archive, shown via the official archive.org embed player
// - suggested accounts (public, active, matched to onboarding interests)
import { q } from './db.js';
import { config } from './config.js';

const BY = 'CC BY 3.0'; const BYURL = 'https://creativecommons.org/licenses/by/3.0/';
export const CLIPS = [
  { id: 'bbb-1', title: 'Big Buck Bunny', credit: 'Blender Foundation · peach.blender.org', license: BY, license_url: BYURL, source_url: 'https://archive.org/details/BigBuckBunny_124' },
  { id: 'sintel-1', title: 'Sintel', credit: 'Blender Foundation · durian.blender.org', license: BY, license_url: BYURL, source_url: 'https://archive.org/details/Sintel' },
  { id: 'ed-1', title: 'Elephants Dream', credit: 'Orange Open Movie Project / Blender Foundation', license: BY, license_url: BYURL, source_url: 'https://archive.org/details/ElephantsDream' },
  { id: 'bbb-2', title: 'Big Buck Bunny', credit: 'Blender Foundation · peach.blender.org', license: BY, license_url: BYURL, source_url: 'https://archive.org/details/BigBuckBunny_124' },
  { id: 'sintel-2', title: 'Sintel', credit: 'Blender Foundation · durian.blender.org', license: BY, license_url: BYURL, source_url: 'https://archive.org/details/Sintel' },
  { id: 'ed-2', title: 'Elephants Dream', credit: 'Orange Open Movie Project / Blender Foundation', license: BY, license_url: BYURL, source_url: 'https://archive.org/details/ElephantsDream' },
].map((c) => ({ ...c, video: `/backfill/${c.id}.mp4`, poster: `/backfill/${c.id}.jpg`, adapted: 'Cropped to a 14-second vertical clip' }));
const PD = 'Public domain'; const PDURL = 'https://creativecommons.org/publicdomain/mark/1.0/';
export const FILMS = [
  { id: 'Sita_Sings_the_Blues', title: 'Sita Sings the Blues', year: 2008, tags: ['animation', 'music', 'art'], license: 'CC0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', credit: 'Nina Paley' },
  { id: 'TheGeneral1926', title: 'The General', year: 1926, tags: ['movies', 'comedy', 'history'], license: PD, license_url: PDURL, credit: 'Buster Keaton' },
  { id: 'Popeye_forPresident', title: 'Popeye for President', year: 1956, tags: ['animation', 'comedy'], license: PD, license_url: PDURL, credit: 'Famous Studios' },
  { id: 'his_girl_friday', title: 'His Girl Friday', year: 1940, tags: ['movies', 'comedy'], license: PD, license_url: PDURL, credit: 'Howard Hawks' },
  { id: 'BigBuckBunny_124', title: 'Big Buck Bunny', year: 2008, tags: ['animation', 'tech', 'art'], license: BY, license_url: BYURL, credit: 'Blender Foundation' },
  { id: 'Sintel', title: 'Sintel', year: 2010, tags: ['animation', 'movies', 'fantasy'], license: BY, license_url: BYURL, credit: 'Blender Foundation' },
  { id: 'The_Pied_Piper_of_Hamelin', title: 'The Pied Piper of Hamelin', year: 1957, tags: ['movies', 'music', 'family'], license: PD, license_url: PDURL, credit: 'NBC / Peter Rodgers Organization' },
  { id: 'HisNewJobCharlesChaplin-1915', title: 'His New Job', year: 1915, tags: ['movies', 'comedy', 'history'], license: PD, license_url: PDURL, credit: 'Charlie Chaplin' },
].map((f) => ({ ...f, embed: `https://archive.org/embed/${f.id}`, thumb: `https://archive.org/services/img/${f.id}`, source: 'Internet Archive', source_url: `https://archive.org/details/${f.id}` }));

export function registerBackfill(api, { requireAuth }) {
  const on = (_q, res, next) => (config.features.backfill ? next() : res.status(404).json({ error: 'Not found' }));
  api.get('/backfill', requireAuth, on, async (req, res) => {
    const { rows: [me] } = await q('SELECT interests FROM users WHERE id = $1', [req.user.id]);
    const ints = (me?.interests || []).map((x) => String(x).toLowerCase());
    // Suggested accounts: public, verified email, active recently, not followed; interest overlap first.
    const { rows: people } = await q(`SELECT u.id, u.username, u.full_name, u.avatar_path, u.bio, u.verified_at IS NOT NULL AS verified,
        (SELECT count(*)::int FROM follows f WHERE f.followee_id = u.id) AS followers,
        (SELECT count(*)::int FROM unnest(u.interests) i WHERE lower(i) = ANY($2)) AS overlap
      FROM users u WHERE u.id <> $1 AND u.email_verified_at IS NOT NULL AND u.deactivated_at IS NULL AND u.suspended_at IS NULL AND NOT u.is_private
        AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
        AND EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.visibility = 'public' AND p.deleted_at IS NULL)
      ORDER BY overlap DESC, followers DESC, u.id DESC LIMIT 12`, [req.user.id, ints]);
    const films = [...FILMS].sort((a, b) => b.tags.filter((t) => ints.some((i) => i.includes(t))).length - a.tags.filter((t) => ints.some((i) => i.includes(t))).length);
    res.set('Cache-Control', 'private, max-age=300').json({ clips: CLIPS, films, suggested: people });
  });
}
