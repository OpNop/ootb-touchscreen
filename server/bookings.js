import crypto from 'node:crypto';
import { db, getSettings } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const BLOCKING = "('scheduled','checked_in','completed')";
export const STATUSES = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];

export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
};
export const fmtMin = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
export const dayOfWeek = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
export const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Current date/time in the business timezone. */
export function localNow() {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}

export function serialize(r) {
  if (!r) return null;
  return {
    id: r.id, code: r.code, room_id: r.room_id, room_name: r.room_name, difficulty_id: r.difficulty_id,
    difficulty_name: r.difficulty_name, date: r.date, start: fmtMin(r.start_min), end: fmtMin(r.start_min + r.duration_min),
    duration_min: r.duration_min, party_size: r.party_size, name: r.name, email: r.email, phone: r.phone, notes: r.notes,
    status: r.status, source: r.source, checked_in_at: r.checked_in_at, created_at: r.created_at,
  };
}

const SELECT = `SELECT b.*, r.name room_name, d.name difficulty_name FROM bookings b
  JOIN rooms r ON r.id = b.room_id JOIN difficulties d ON d.id = b.difficulty_id`;

export const getBooking = (id) => serialize(db.prepare(`${SELECT} WHERE b.id = ?`).get(id));
export const getBookingByCode = (code) => serialize(db.prepare(`${SELECT} WHERE b.code = ?`).get(code));
export const listBookings = (from, to) =>
  db.prepare(`${SELECT} WHERE b.date BETWEEN ? AND ? ORDER BY b.date, b.start_min, r.sort`).all(from, to).map(serialize);

function findConflict(roomId, date, startMin, endMin, excludeId = 0) {
  return db.prepare(
    `SELECT id FROM bookings WHERE room_id = ? AND date = ? AND status IN ${BLOCKING} AND id != ? AND start_min < ? AND end_min > ?`,
  ).get(roomId, date, excludeId, endMin, startMin);
}

/** Start times for a difficulty on a date. `staff` ignores the minimum-notice rule. */
export function slotsFor(difficultyId, date, { staff = false, excludeId = 0 } = {}) {
  const d = db.prepare('SELECT d.*, r.hours, r.active room_active FROM difficulties d JOIN rooms r ON r.id = d.room_id WHERE d.id = ?').get(difficultyId);
  if (!d || !d.active || !d.room_active || !validDate(date)) return [];
  const hours = JSON.parse(d.hours)[dayOfWeek(date)];
  if (!hours) return [];
  const s = getSettings();
  const step = Math.max(5, +s.slot_minutes || 30);
  const notice = staff ? 0 : +s.min_notice_minutes || 0;
  const now = localNow();
  const [open, close] = [toMin(hours[0]), toMin(hours[1])];
  const out = [];
  for (let t = open; t + d.duration_min <= close; t += step) {
    const past = date < now.date || (date === now.date && t < now.min + notice);
    const clash = findConflict(d.room_id, date, t, t + d.duration_min + d.buffer_min, excludeId);
    out.push({ start: fmtMin(t), available: !past && !clash });
  }
  return out;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
    if (!db.prepare('SELECT 1 FROM bookings WHERE code = ?').get(code)) return code;
  }
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
export const phoneDigits = (p) => String(p || '').replace(/\D/g, '');

function validateFields(i, { strict }) {
  const diff = db.prepare('SELECT d.*, r.active room_active FROM difficulties d JOIN rooms r ON r.id = d.room_id WHERE d.id = ?').get(+i.difficulty_id);
  if (!diff || !diff.active || !diff.room_active) throw new HttpError(400, 'Please choose a valid room and difficulty.');
  if (!validDate(i.date)) throw new HttpError(400, 'Invalid date.');
  const start = toMin(i.start);
  if (start === null) throw new HttpError(400, 'Invalid start time.');
  const party = parseInt(i.party_size, 10);
  if (!(party >= 1 && party <= 50)) throw new HttpError(400, 'Invalid party size.');
  const name = clean(i.name, 80);
  if (!name) throw new HttpError(400, 'Name is required.');
  const phone = clean(i.phone, 30);
  const email = clean(i.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Invalid email address.');
  if (strict) {
    if (phoneDigits(phone).length < 7) throw new HttpError(400, 'Please enter a valid phone number.');
    if (party < diff.min_players || party > diff.max_players) {
      throw new HttpError(400, `This room takes ${diff.min_players}-${diff.max_players} players.`);
    }
    const maxDays = +getSettings().kiosk_days_ahead || 14;
    if (i.date > addDays(localNow().date, maxDays)) throw new HttpError(400, 'That date is too far ahead.');
  }
  return {
    diff, date: i.date, start, party, name, phone, email, notes: clean(i.notes, 500),
  };
}

export function createBooking(input, { source, staffId = null }) {
  const strict = source === 'kiosk';
  const v = validateFields(input, { strict });
  if (strict && !slotsFor(v.diff.id, v.date).find((s) => toMin(s.start) === v.start)?.available) {
    throw new HttpError(409, 'Sorry, that time was just taken. Please pick another.');
  }
  const end = v.start + v.diff.duration_min + v.diff.buffer_min;
  if (findConflict(v.diff.room_id, v.date, v.start, end)) {
    throw new HttpError(409, 'That room is already booked at that time.');
  }
  const info = db.prepare(
    `INSERT INTO bookings (code, room_id, difficulty_id, date, start_min, duration_min, end_min, party_size, name, email, phone, notes, source, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(newCode(), v.diff.room_id, v.diff.id, v.date, v.start, v.diff.duration_min, end, v.party, v.name, v.email, v.phone, v.notes, source, staffId);
  return getBooking(Number(info.lastInsertRowid));
}

export function updateBooking(id, input) {
  const cur = getBooking(id);
  if (!cur) throw new HttpError(404, 'Booking not found.');
  const v = validateFields({ ...cur, ...input }, { strict: false });
  const status = input.status ?? cur.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
  const end = v.start + v.diff.duration_min + v.diff.buffer_min;
  if (['scheduled', 'checked_in', 'completed'].includes(status) && findConflict(v.diff.room_id, v.date, v.start, end, id)) {
    throw new HttpError(409, 'That room is already booked at that time.');
  }
  db.prepare(
    `UPDATE bookings SET room_id=?, difficulty_id=?, date=?, start_min=?, duration_min=?, end_min=?, party_size=?, name=?, email=?, phone=?, notes=?, status=?,
     checked_in_at = CASE WHEN ? = 'checked_in' AND checked_in_at IS NULL THEN datetime('now') ELSE checked_in_at END WHERE id=?`,
  ).run(v.diff.room_id, v.diff.id, v.date, v.start, v.diff.duration_min, end, v.party, v.name, v.email, v.phone, v.notes, status, status, id);
  return getBooking(id);
}

export function checkIn(id) {
  db.prepare("UPDATE bookings SET status='checked_in', checked_in_at=datetime('now') WHERE id=? AND status='scheduled'").run(id);
  return getBooking(id);
}

/** Booking summary used in staff notifications. */
export function describe(b) {
  const [y, m, d] = b.date.split('-');
  const [h, min] = b.start.split(':').map(Number);
  const time = `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${b.name} - ${b.room_name} (${b.difficulty_name}) - ${+m}/${+d}/${y} ${time} - ${b.party_size} players${b.phone ? ' - ' + b.phone : ''}`;
}
