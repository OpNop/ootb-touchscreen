import { db, getSettings } from './db.js';

/*
 * Staff notifications. Delivered through any combination of:
 *  - ntfy push (per-staff topic and/or one shared topic)    -> free, no account, staff just install the ntfy app
 *  - Twilio SMS (per-staff phone, if enabled for that person)
 *  - Shared Slack/Discord/Teams-style webhook               -> one team channel
 * Staff are added/removed in the admin UI; no code or config changes needed.
 */

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

async function attempt(title, message, channel, recipient, fn) {
  try {
    await fn();
    log.run(title, message, channel, recipient, 1, '');
  } catch (e) {
    console.error(`[notify] ${channel} -> ${recipient} failed:`, e.message);
    log.run(title, message, channel, recipient, 0, String(e.message).slice(0, 300));
  }
}

/** Fire-and-forget: never throws and never delays the kiosk response. */
export function notifyStaff(title, message) {
  deliver(title, message).catch((e) => console.error('[notify]', e));
}

export async function deliver(title, message, onlyStaffId = null) {
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
  if (!onlyStaffId) {
    if (s.shared_ntfy_topic) jobs.push(attempt(title, message, 'push', 'shared topic', () => sendNtfy(s.shared_ntfy_topic, title, message)));
    if (s.shared_webhook_url) jobs.push(attempt(title, message, 'webhook', 'shared channel', () => sendWebhook(s.shared_webhook_url, title, message)));
  }
  console.log(`[notify] ${title}: ${message}`);
  await Promise.all(jobs);
}
