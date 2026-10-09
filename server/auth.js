import crypto from 'node:crypto';
import { db } from './db.js';
import { HttpError } from './bookings.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

export function startSession(res, staffId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, staff_id, expires_at) VALUES (?,?,?)').run(sha(token), staffId, Date.now() + SESSION_MS);
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
}
export function endSession(req, res) {
  const t = readCookie(req, 'sid');
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export function requireAuth(req, _res, next) {
  const t = readCookie(req, 'sid');
  const row = t && db.prepare(
    `SELECT s.* FROM sessions s JOIN staff st ON st.id = s.staff_id WHERE s.token_hash = ? AND s.expires_at > ? AND st.active = 1`,
  ).get(sha(t), Date.now());
  if (!row) return next(new HttpError(401, 'Please sign in.'));
  req.staff = db.prepare('SELECT id, name, email, role FROM staff WHERE id = ?').get(row.staff_id);
  next();
}
export function requireAdmin(req, _res, next) {
  if (req.staff?.role !== 'admin') return next(new HttpError(403, 'Admin access required.'));
  next();
}

/** Small in-memory limiter: `max` hits per `windowMs` per key. */
export function rateLimit(max, windowMs, keyFn = (req) => req.ip) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return next(new HttpError(429, 'Too many attempts. Please wait a moment.'));
    list.push(now);
    hits.set(key, list);
    next();
  };
}

export function ensureFirstAdmin() {
  if (db.prepare('SELECT COUNT(*) c FROM staff').get().c > 0) return;
  const email = process.env.ADMIN_EMAIL;
  const pw = process.env.ADMIN_PASSWORD;
  if (!email || !pw) {
    console.warn('No staff accounts exist. Set ADMIN_EMAIL/ADMIN_PASSWORD in .env or run "npm run create-admin".');
    return;
  }
  db.prepare('INSERT INTO staff (name, email, password_hash, role, ntfy_topic) VALUES (?,?,?,?,?)').run(
    process.env.ADMIN_NAME || 'Admin', email.toLowerCase(), hashPassword(pw), 'admin', newTopic(),
  );
  console.log(`Created first admin account: ${email}`);
}

export const newTopic = () => 'escape-' + crypto.randomBytes(8).toString('hex');
