import { Router } from 'express';
import { db, getSettings, setSetting, SETTING_KEYS } from '../db.js';
import {
  HttpError, STATUSES, createBooking, listBookings, slotsFor, updateBooking, describe, toMin, localNow,
} from '../bookings.js';
import {
  endSession, hashPassword, newTopic, rateLimit, requireAdmin, requireAuth, startSession, verifyPassword,
} from '../auth.js';
import { deliver, twilioConfigured, notifyStaff } from '../notify.js';
import { erccConfigured } from '../ercc.js';

const r = Router();
const bool = (v) => (v ? 1 : 0);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ---- auth ----
r.post('/login', rateLimit(10, 5 * 60_000), (req, res) => {
  const { email, password } = req.body || {};
  const st = db.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').get(str(email).toLowerCase());
  if (!st || !verifyPassword(String(password || ''), st.password_hash)) throw new HttpError(401, 'Incorrect email or password.');
  startSession(res, st.id);
  res.json({ id: st.id, name: st.name, role: st.role });
});
r.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

r.use(requireAuth);

r.get('/me', (req, res) => res.json({ ...req.staff, today: localNow().date }));

// ---- bookings ----
r.get('/bookings', (req, res) => {
  const from = str(req.query.from);
  res.json(listBookings(from, str(req.query.to) || from));
});
r.post('/bookings', (req, res) => {
  const b = createBooking(req.body, { source: 'staff', staffId: req.staff.id });
  res.status(201).json(b);
});
r.put('/bookings/:id', (req, res) => res.json(updateBooking(+req.params.id, req.body || {})));
r.post('/bookings/:id/status', (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  const b = updateBooking(+req.params.id, { status });
  if (status === 'checked_in') notifyStaff('Guest checked in (by staff)', describe(b));
  res.json(b);
});
r.get('/availability', (req, res) => {
  res.json(slotsFor(+req.query.difficultyId, str(req.query.date), { staff: true, excludeId: +req.query.excludeId || 0 }));
});
r.get('/rooms', (_req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY sort, id').all().map((room) => ({
    ...room, hours: JSON.parse(room.hours),
    difficulties: db.prepare('SELECT * FROM difficulties WHERE room_id = ? ORDER BY id').all(room.id),
  }));
  res.json(rooms);
});

// ---- admin-only below ----
r.use(requireAdmin);

function cleanHours(h) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const v = h?.[d];
    if (Array.isArray(v) && toMin(v[0]) !== null && toMin(v[1]) !== null && toMin(v[0]) < toMin(v[1])) out[d] = [v[0], v[1]];
  }
  return JSON.stringify(out);
}

r.post('/rooms', (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) throw new HttpError(400, 'Room name is required.');
  const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM rooms').get().n;
  const id = db.prepare('INSERT INTO rooms (name, description, hours, active, sort) VALUES (?,?,?,?,?)').run(
    str(b.name, 80), str(b.description, 500), cleanHours(b.hours), bool(b.active ?? true), sort,
  ).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});
r.put('/rooms/:id', (req, res) => {
  const b = req.body || {};
  if (!str(b.name)) throw new HttpError(400, 'Room name is required.');
  db.prepare('UPDATE rooms SET name=?, description=?, hours=?, active=? WHERE id=?').run(
    str(b.name, 80), str(b.description, 500), cleanHours(b.hours), bool(b.active), +req.params.id,
  );
  res.json({ ok: true });
});

function diffFields(b) {
  const n = (v, lo, hi, label) => {
    const x = parseInt(v, 10);
    if (!(x >= lo && x <= hi)) throw new HttpError(400, `${label} must be between ${lo} and ${hi}.`);
    return x;
  };
  if (!str(b.name)) throw new HttpError(400, 'Difficulty name is required.');
  const min = n(b.min_players, 1, 50, 'Min players');
  const max = n(b.max_players, min, 50, 'Max players');
  return [str(b.name, 60), n(b.duration_min, 5, 600, 'Duration'), n(b.buffer_min, 0, 240, 'Reset time'), min, max, bool(b.active ?? true), str(b.ercc_ref, 100)];
}
r.post('/rooms/:id/difficulties', (req, res) => {
  const id = db.prepare('INSERT INTO difficulties (room_id, name, duration_min, buffer_min, min_players, max_players, active, ercc_ref) VALUES (?,?,?,?,?,?,?,?)')
    .run(+req.params.id, ...diffFields(req.body || {})).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});
r.put('/difficulties/:id', (req, res) => {
  db.prepare('UPDATE difficulties SET name=?, duration_min=?, buffer_min=?, min_players=?, max_players=?, active=?, ercc_ref=? WHERE id=?')
    .run(...diffFields(req.body || {}), +req.params.id);
  res.json({ ok: true });
});

// ---- staff ----
r.get('/staff', (_req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, phone, notify_sms, notify_push, ntfy_topic, active FROM staff ORDER BY active DESC, name').all());
});
r.post('/staff', (req, res) => {
  const b = req.body || {};
  const email = str(b.email).toLowerCase();
  if (!str(b.name) || !email) throw new HttpError(400, 'Name and email are required.');
  if (String(b.password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(email)) throw new HttpError(409, 'A staff member with that email already exists.');
  const id = db.prepare('INSERT INTO staff (name, email, password_hash, role, phone, notify_sms, notify_push, ntfy_topic) VALUES (?,?,?,?,?,?,?,?)').run(
    str(b.name, 80), email, hashPassword(String(b.password)), b.role === 'admin' ? 'admin' : 'staff', str(b.phone, 30),
    bool(b.notify_sms), bool(b.notify_push ?? true), newTopic(),
  ).lastInsertRowid;
  res.status(201).json({ id: Number(id) });
});
r.put('/staff/:id', (req, res) => {
  const id = +req.params.id;
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  if (!cur) throw new HttpError(404, 'Staff member not found.');
  const role = b.role === 'admin' ? 'admin' : 'staff';
  const active = bool(b.active);
  if (id === req.staff.id && (!active || role !== 'admin')) throw new HttpError(400, "You can't deactivate or demote your own account.");
  if (b.password && String(b.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  db.prepare('UPDATE staff SET name=?, email=?, role=?, phone=?, notify_sms=?, notify_push=?, active=?, password_hash=? WHERE id=?').run(
    str(b.name, 80) || cur.name, str(b.email).toLowerCase() || cur.email, role, str(b.phone, 30), bool(b.notify_sms), bool(b.notify_push), active,
    b.password ? hashPassword(String(b.password)) : cur.password_hash, id,
  );
  if (!active) db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(id); // removed staff are logged out immediately
  res.json({ ok: true });
});
r.post('/staff/:id/test', (req, res, next) => {
  const before = db.prepare('SELECT COALESCE(MAX(id),0) m FROM notifications').get().m;
  deliver('Test notification', 'If you can read this, alerts work for you.', +req.params.id).then(() => {
    res.json({ results: db.prepare('SELECT ok, detail, channel FROM notifications WHERE id > ?').all(before) });
  }, next);
});

// ---- settings / status / log ----
r.get('/settings', (_req, res) => {
  res.json({
    settings: getSettings(),
    status: { twilio: twilioConfigured(), ercc: erccConfigured(), ntfy_server: process.env.NTFY_SERVER || 'https://ntfy.sh', timezone: process.env.TIMEZONE || 'America/New_York' },
  });
});
r.put('/settings', (req, res) => {
  const b = req.body || {};
  for (const k of SETTING_KEYS) if (b[k] !== undefined) setSetting(k, str(b[k], 500));
  res.json({ ok: true });
});
r.get('/notifications', (_req, res) => {
  res.json(db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 100').all());
});

export default r;
