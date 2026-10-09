/*
 * Escape Room Command Center high score client.
 *
 * The ERCC API docs are served by your own ERCC install (Settings -> enable API -> "Open API Documentation"),
 * so the exact endpoint/fields can't be known up front. Configure ERCC_BASE_URL / ERCC_SCORES_PATH in .env.
 * normalize() below accepts a variety of common field names; adjust it once you see the real response.
 * With no ERCC_BASE_URL set, demo data is returned so the kiosk UI can be tested.
 */

const CACHE_MS = 60_000;
let cache = { at: 0, data: null };

export const erccConfigured = () => !!process.env.ERCC_BASE_URL;

const pick = (o, keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
};

function toSeconds(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    const parts = v.split(':').map(Number);
    if (parts.length >= 2 && parts.every((n) => !Number.isNaN(n))) return parts.reduce((a, n) => a * 60 + n, 0);
  }
  return null;
}

function normalize(item) {
  const secs = toSeconds(pick(item, ['time', 'duration', 'seconds', 'elapsed', 'elapsedTime', 'escapeTime', 'completionTime', 'score']));
  return {
    team: String(pick(item, ['team', 'teamName', 'team_name', 'name', 'groupName']) ?? 'Unknown team'),
    seconds: secs,
    room: String(pick(item, ['room', 'roomName', 'room_name']) ?? ''),
    players: pick(item, ['players', 'playerCount', 'player_count', 'numberOfPlayers']) ?? null,
    date: pick(item, ['date', 'createdAt', 'created_at', 'completedAt', 'startTime']) ?? null,
  };
}

const DEMO = [
  ['The Great Escapists', 2712, 'Room One', 5], ['Lock Stock', 2890, 'Room One', 4], ['Puzzle Pirates', 3015, 'Room Two', 6],
  ['Key Masters', 3120, 'Room Two', 3], ['Brain Trust', 3244, 'Room One', 6], ['Clue Crew', 3301, 'Room Two', 4],
  ['Exit Strategy', 3377, 'Room One', 5], ['Mystery Inc', 3450, 'Room Two', 5], ['Escape Goats', 3522, 'Room One', 7],
  ['The Lockpickers', 3590, 'Room Two', 2],
].map(([team, seconds, room, players]) => ({ team, seconds, room, players, date: null }));

export async function getHighScores() {
  if (!erccConfigured()) return { demo: true, scores: DEMO };
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

  const url = process.env.ERCC_BASE_URL.replace(/\/$/, '') + (process.env.ERCC_SCORES_PATH || '/highscores');
  const headers = { Accept: 'application/json' };
  if (process.env.ERCC_AUTH_HEADER) headers[process.env.ERCC_AUTH_HEADER] = process.env.ERCC_AUTH_VALUE || '';
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`ERCC responded ${r.status}`);
    const json = await r.json();
    const list = Array.isArray(json) ? json : pick(json, ['data', 'scores', 'highscores', 'highScores', 'items', 'results']) ?? [];
    const scores = list.map(normalize);
    if (scores.every((s) => s.seconds !== null)) scores.sort((a, b) => a.seconds - b.seconds);
    cache = { at: Date.now(), data: { demo: false, scores } };
    return cache.data;
  } catch (e) {
    console.error('[ercc]', e.message);
    if (cache.data) return cache.data; // serve stale scores rather than an error screen
    throw e;
  }
}
