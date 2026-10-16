import { EventEmitter } from 'node:events';
import webpush from 'web-push';
import { db, getSetting, getSettings, setSetting } from './db.js';

/*
 * Staff notifications. Delivered through any combination of:
 *  - ntfy push (per-staff topic and/or one shared topic)    -> free, no account, staff just install the ntfy app
 *  - Twilio SMS (per-staff phone, if enabled for that person)
 *  - Shared Slack/Discord/Teams-style webhook               -> one team channel
 *  - Browser Web Push (service worker, works with the admin page closed) -> per browser opt-in from the admin header
 * Staff are added/removed in the admin UI; no code or config changes needed.
 */

// VAPID keys identify this server to browser push services. Generated once and kept in the settings table;
// regenerating them would silently invalidate every existing browser subscription.
if (!getSetting('vapid_public') || !getSetting('vapid_private')) {
  const keys = webpush.generateVAPIDKeys();
  setSetting('vapid_public', keys.publicKey);
  setSetting('vapid_private', keys.privateKey);
}
webpush.setVapidDetails(`mailto:${process.env.ADMIN_EMAIL || 'admin@example.com'}`, getSetting('vapid_public'), getSetting('vapid_private'));
export const vapidPublicKey = () => getSetting('vapid_public');

// Subscriptions are supplied by the browser, and the server POSTs to them, so only accept real push services.
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function isAllowedPushEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    const extra = (process.env.PUSH_EXTRA_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return u.protocol === 'https:' && (PUSH_HOSTS.some((re) => re.test(u.hostname)) || extra.includes(u.hostname));
  } catch {
    return false;
  }
}

const log = db.prepare('INSERT INTO notifications (title, message, channel, recipient, ok, detail) VALUES (?,?,?,?,?,?)');

export const twilioConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

async function sendNtfy(topic, title, message) {
  const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  const r = await fetch(`${server}/${encodeURIComponent(topic)}`, {
    method: 'POST', headers: { Title: title, Priority: 'high', Tags: 'bell' }, body: message,
  });
  if (!r.ok) throw new Error(`ntfy ${r.status}`);
}

async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body }),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function sendWebhook(url, title, message) {
  const text = `${title}\n${message}`;
  const body = /discord(app)?\.com/.test(url) ? { content: text } : { text };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`webhook ${r.status}`);
}

async function sendWebPush(sub, title, message, at) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title, body: message, at }),
      { TTL: 3600, urgency: 'high' },
    );
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { // browser revoked/expired the subscription
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      throw new Error('subscription expired and was removed');
    }
    throw new Error(`push service responded ${e.statusCode || e.message}`);
  }
}

async function attempt(title, message, channel, recipient, fn) {
  try {
    await fn();
    log.run(title, message, channel, recipient, 1, '');
  } catch (e) {
    console.error(`[notify] ${channel} -> ${recipient} failed:`, e.message);
    log.run(title, message, channel, recipient, 0, String(e.message).slice(0, 300));
  }
}

/** Live feed for staff browsers that have the admin page open (see GET /api/admin/events). */
export const alerts = new EventEmitter();
let alertSeq = 0;

/** Fire-and-forget: never throws and never delays the kiosk response. */
export function notifyStaff(title, message) {
  const at = Date.now();
  alerts.emit('alert', { id: ++alertSeq, title, message, at });
  deliver(title, message, null, at).catch((e) => console.error('[notify]', e));
}

// `at` doubles as the browser notification tag, so the open page and the service worker never show the same alert twice.
export async function deliver(title, message, onlyStaffId = null, at = Date.now()) {
  const s = getSettings();
  const staff = db.prepare('SELECT * FROM staff WHERE active = 1' + (onlyStaffId ? ' AND id = ?' : '')).all(...(onlyStaffId ? [onlyStaffId] : []));
  const jobs = [];
  for (const p of staff) {
    if (p.notify_push && p.ntfy_topic) jobs.push(attempt(title, message, 'push', p.name, () => sendNtfy(p.ntfy_topic, title, message)));
    if (p.notify_sms && p.phone) {
      if (twilioConfigured()) jobs.push(attempt(title, message, 'sms', p.name, () => sendSms(p.phone, `${title}: ${message}`)));
      else jobs.push(attempt(title, message, 'sms', p.name, async () => { throw new Error('Twilio is not configured in .env'); }));
    }
  }
  const subs = db.prepare(
    `SELECT ps.*, st.name FROM push_subscriptions ps JOIN staff st ON st.id = ps.staff_id WHERE st.active = 1${onlyStaffId ? ' AND st.id = ?' : ''}`,
  ).all(...(onlyStaffId ? [onlyStaffId] : []));
  for (const sub of subs) jobs.push(attempt(title, message, 'browser', sub.name, () => sendWebPush(sub, title, message, at)));
  if (!onlyStaffId) {
    if (s.shared_ntfy_topic) jobs.push(attempt(title, message, 'push', 'shared topic', () => sendNtfy(s.shared_ntfy_topic, title, message)));
    if (s.shared_webhook_url) jobs.push(attempt(title, message, 'webhook', 'shared channel', () => sendWebhook(s.shared_webhook_url, title, message)));
  }
  console.log(`[notify] ${title}: ${message}`);
  await Promise.all(jobs);
}
