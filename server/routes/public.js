import { Router } from 'express';
import { db, getSettings } from '../db.js';
import {
  HttpError, createBooking, checkIn, describe, getBooking, getBookingByCode, listBookings, localNow, phoneDigits, slotsFor,
} from '../bookings.js';
import { notifyStaff } from '../notify.js';
import { getHighScores } from '../ercc.js';
import { rateLimit } from '../auth.js';

const r = Router();

r.get('/config', (_req, res) => {
  const s = getSettings();
  const rooms = db.prepare('SELECT id, name, description FROM rooms WHERE active = 1 ORDER BY sort, id').all().map((room) => ({
    ...room,
    difficulties: db.prepare(
      'SELECT id, name, duration_min, min_players, max_players FROM difficulties WHERE room_id = ? AND active = 1 ORDER BY id',
    ).all(room.id),
  })).filter((room) => room.difficulties.length);
  res.json({
    business_name: s.business_name, idle_seconds: +s.idle_seconds, days_ahead: +s.kiosk_days_ahead, today: localNow().date, rooms,
  });
});

r.get('/availability', (req, res) => {
  res.json(slotsFor(+req.query.difficultyId, String(req.query.date)));
});

r.post('/bookings', rateLimit(20, 60_000), (req, res) => {
  const b = createBooking(req.body, { source: 'kiosk' });
  notifyStaff('New sign-up (kiosk)', describe(b));
  res.status(201).json({ code: b.code, date: b.date, start: b.start, room_name: b.room_name, difficulty_name: b.difficulty_name });
});

// Today's not-yet-arrived bookings, with names reduced to "First L." so the public screen leaks little.
r.get('/today', (_req, res) => {
  const today = localNow().date;
  const rows = listBookings(today, today).filter((b) => b.status === 'scheduled');
  res.json(rows.map((b) => {
    const parts = b.name.split(/\s+/);
    const label = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
    return { id: b.id, label, start: b.start, room_name: b.room_name, difficulty_name: b.difficulty_name, party_size: b.party_size };
  }));
});

// Brute-force guard: the kiosk shares one IP, so keep the window short and the limit generous.
r.post('/checkin', rateLimit(12, 60_000), (req, res) => {
  const { id, verify, code } = req.body || {};
  let booking;
  if (code) {
    booking = getBookingByCode(String(code).trim().toUpperCase());
  } else {
    booking = getBooking(+id);
    const v = phoneDigits(verify);
    const ok = booking && v.length >= 4 && phoneDigits(booking.phone).endsWith(v.slice(-4)) && v.length <= 4;
    if (!ok) booking = null;
  }
  if (!booking || booking.date !== localNow().date) throw new HttpError(404, "We couldn't match that. Please try again or ask a staff member.");
  if (booking.status === 'cancelled') throw new HttpError(409, 'This booking was cancelled. Please see a staff member.');
  const wasNew = booking.status === 'scheduled';
  const done = wasNew ? checkIn(booking.id) : booking;
  if (wasNew) notifyStaff('Guest checked in', describe(done));
  res.json({ name: done.name.split(/\s+/)[0], room_name: done.room_name, start: done.start });
});

r.get('/scores', (_req, res) => {
  getHighScores().then(
    (data) => res.json(data),
    () => res.status(502).json({ error: 'High scores are unavailable right now.' }),
  );
});

export default r;
