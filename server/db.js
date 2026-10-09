import './env.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(dir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hours TEXT NOT NULL,              -- JSON {"0":["12:00","21:00"],...} 0=Sunday, missing/null = closed
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS difficulties (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  buffer_min INTEGER NOT NULL DEFAULT 15,   -- reset time after the game
  min_players INTEGER NOT NULL DEFAULT 2,
  max_players INTEGER NOT NULL DEFAULT 8,
  active INTEGER NOT NULL DEFAULT 1,
  ercc_ref TEXT NOT NULL DEFAULT ''         -- optional name/id used to match ERCC high scores
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  difficulty_id INTEGER NOT NULL REFERENCES difficulties(id),
  date TEXT NOT NULL,               -- local YYYY-MM-DD
  start_min INTEGER NOT NULL,       -- minutes after local midnight
  duration_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,         -- start + duration + buffer (room blocked until here)
  party_size INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | checked_in | completed | cancelled | no_show
  source TEXT NOT NULL DEFAULT 'staff',     -- kiosk | staff
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  checked_in_at TEXT
);
CREATE INDEX IF NOT EXISTS bookings_room_date ON bookings(room_id, date);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings(date);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',       -- admin | staff
  phone TEXT NOT NULL DEFAULT '',
  notify_sms INTEGER NOT NULL DEFAULT 0,
  notify_push INTEGER NOT NULL DEFAULT 1,
  ntfy_topic TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
`);

const DEFAULT_SETTINGS = {
  business_name: 'Escape Room',
  slot_minutes: '30',
  min_notice_minutes: '15',
  kiosk_days_ahead: '14',
  idle_seconds: '60',
  shared_webhook_url: '',
  shared_ntfy_topic: '',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
export const getSetting = (k) => getSettings()[k];
export function setSetting(k, v) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v));
}
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

// Seed 2 rooms x 2 difficulties on first run (rename/edit them from the admin UI).
if (db.prepare('SELECT COUNT(*) c FROM rooms').get().c === 0) {
  const hours = JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ['12:00', '21:00']])));
  const addRoom = db.prepare('INSERT INTO rooms (name, description, hours, sort) VALUES (?, ?, ?, ?)');
  const addDiff = db.prepare('INSERT INTO difficulties (room_id, name, duration_min, buffer_min, min_players, max_players) VALUES (?, ?, 60, 15, 2, 8)');
  ['Room One', 'Room Two'].forEach((n, i) => {
    const id = Number(addRoom.run(n, '', hours, i).lastInsertRowid);
    addDiff.run(id, 'Standard');
    addDiff.run(id, 'Expert');
  });
}
