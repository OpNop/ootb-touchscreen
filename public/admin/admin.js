import { h, api, fmtTime, fmtDate, addDays } from '/shared/ui.js';

const root = document.getElementById('root');
let me = null;
let tab = 'schedule';
const sched = { date: null, range: 'day' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- helpers ----------
function modal(title, build) {
  const dlg = h('dialog');
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(h('h2', {}, title), build(close));
  dlg.addEventListener('cancel', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return close;
}
const field = (label, input) => h('label', { class: 'f' }, label, input);
const check = (label, checked) => { const i = h('input', { type: 'checkbox', checked }); return Object.assign(h('label', { class: 'chk' }, i, label), { input: i }); };
const num = (v, extra = {}) => h('input', { type: 'number', value: v, ...extra });

/** Runs an async action; shows errors in `errEl`. */
async function attempt(errEl, fn) {
  errEl.textContent = '';
  try { return await fn(); } catch (e) { errEl.textContent = e.message; if (e.status === 401) start(); }
}

// ---------- login ----------
function renderLogin() {
  const err = h('div', { class: 'err' });
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const form = h('form', { class: 'card login', onsubmit: (e) => {
    e.preventDefault();
    attempt(err, async () => { await api('/api/admin/login', { method: 'POST', body: { email: email.value, password: pw.value } }); start(); });
  } }, h('h2', {}, 'Staff sign in'), field('Email', email), field('Password', pw), err, h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'));
  root.replaceChildren(form);
}

// ---------- shell ----------
const TABS = [['schedule', 'Schedule'], ['rooms', 'Rooms', true], ['staff', 'Staff & alerts', true], ['settings', 'Settings', true], ['activity', 'Alert log', true]];
function renderShell() {
  const main = h('main');
  const nav = h('nav', {}, TABS.filter(([, , adminOnly]) => !adminOnly || me.role === 'admin').map(([id, label]) =>
    h('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; renderShell(); } }, label)));
  root.replaceChildren(
    h('header', { class: 'bar' }, h('span', { class: 'title' }, 'Staff Admin'), nav, h('span', { class: 'sp' }),
      h('span', { class: 'muted' }, me.name), h('button', { class: 'btn sm', onclick: async () => { await api('/api/admin/logout', { method: 'POST' }); start(); } }, 'Sign out')),
    main);
  ({ schedule: renderSchedule, rooms: renderRooms, staff: renderStaff, settings: renderSettings, activity: renderActivity })[tab](main);
}

// ---------- schedule ----------
async function renderSchedule(main) {
  sched.date ||= me.today;
  const from = sched.date;
  const to = sched.range === 'week' ? addDays(from, 6) : from;
  const list = h('div', {}, 'Loading…');
  const dateInput = h('input', { type: 'date', value: sched.date, onchange: (e) => { sched.date = e.target.value || me.today; renderShell(); } });
  main.append(
    h('div', { class: 'row sp' },
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => { sched.date = addDays(sched.date, sched.range === 'week' ? -7 : -1); renderShell(); } }, '◀'),
        dateInput,
        h('button', { class: 'btn', onclick: () => { sched.date = addDays(sched.date, sched.range === 'week' ? 7 : 1); renderShell(); } }, '▶'),
        h('button', { class: 'btn', onclick: () => { sched.date = me.today; renderShell(); } }, 'Today'),
        h('select', { onchange: (e) => { sched.range = e.target.value; renderShell(); } }, h('option', { value: 'day', selected: sched.range === 'day' }, 'Day'), h('option', { value: 'week', selected: sched.range === 'week' }, '7 days'))),
      h('button', { class: 'btn primary', onclick: () => bookingForm(null) }, '+ New booking')),
    list);
  try {
    const rows = await api(`/api/admin/bookings?from=${from}&to=${to}`);
    const live = rows.filter((b) => !['cancelled', 'no_show'].includes(b.status));
    const stats = h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', {}, live.length), 'bookings'),
      h('div', { class: 'stat' }, h('b', {}, live.reduce((a, b) => a + b.party_size, 0)), 'players'),
      h('div', { class: 'stat' }, h('b', {}, rows.filter((b) => b.status === 'checked_in').length), 'checked in'));
    const byDate = Map.groupBy(rows, (b) => b.date);
    const days = sched.range === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(from, i)) : [from];
    list.replaceChildren(stats, ...days.map((d) => h('div', {},
      h('div', { class: 'dayhead' }, fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }), d === me.today ? ' (today)' : ''),
      byDate.get(d) ? bookingTable(byDate.get(d)) : h('div', { class: 'muted' }, 'No bookings'))));
  } catch (e) { list.textContent = e.message; if (e.status === 401) start(); }
}

function bookingTable(rows) {
  const setStatus = async (b, status) => { await api(`/api/admin/bookings/${b.id}/status`, { method: 'POST', body: { status } }); renderShell(); };
  return h('div', { class: 'card', style: 'padding:0;overflow-x:auto' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Time', 'Room', 'Guest', 'Players', 'Status', ''].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map((b) => h('tr', {},
      h('td', {}, `${fmtTime(b.start)} – ${fmtTime(b.end)}`),
      h('td', {}, b.room_name, h('div', { class: 'muted' }, b.difficulty_name)),
      h('td', {}, b.name, h('div', { class: 'muted' }, [b.phone, b.email].filter(Boolean).join(' · ')), b.notes ? h('div', { class: 'muted' }, '“' + b.notes + '”') : '', h('div', { class: 'muted' }, `Code ${b.code}${b.source === 'kiosk' ? ' · kiosk' : ''}`)),
      h('td', {}, b.party_size),
      h('td', {}, h('span', { class: 'badge ' + b.status }, b.status.replace('_', ' '))),
      h('td', { class: 'row' },
        b.status === 'scheduled' ? h('button', { class: 'btn sm primary', onclick: () => setStatus(b, 'checked_in') }, 'Check in') : '',
        b.status === 'checked_in' ? h('button', { class: 'btn sm', onclick: () => setStatus(b, 'completed') }, 'Complete') : '',
        h('button', { class: 'btn sm', onclick: () => bookingForm(b) }, 'Edit'),
        ['scheduled', 'checked_in'].includes(b.status) ? h('button', { class: 'btn sm danger', onclick: () => { if (confirm(`Cancel ${b.name}'s booking?`)) setStatus(b, 'cancelled'); } }, 'Cancel') : '',
        b.status === 'scheduled' ? h('button', { class: 'btn sm', onclick: () => setStatus(b, 'no_show') }, 'No-show') : ''))))));
}

async function bookingForm(b) {
  const rooms = (await api('/api/admin/rooms')).filter((r) => r.active);
  const options = rooms.flatMap((r) => r.difficulties.filter((d) => d.active || (b && d.id === b.difficulty_id)).map((d) => ({ id: d.id, label: `${r.name} — ${d.name} (${d.duration_min} min)`, max: d.max_players, min: d.min_players })));
  modal(b ? 'Edit booking' : 'New booking', (close) => {
    const diff = h('select', {}, options.map((o) => h('option', { value: o.id, selected: b?.difficulty_id === o.id }, o.label)));
    const date = h('input', { type: 'date', value: b?.date || sched.date || me.today });
    const start = h('input', { type: 'time', step: 300, value: b?.start || '' });
    const party = num(b?.party_size || 4, { min: 1 });
    const name = h('input', { value: b?.name || '' });
    const phone = h('input', { type: 'tel', value: b?.phone || '' });
    const email = h('input', { type: 'email', value: b?.email || '' });
    const notes = h('textarea', { rows: 2 }, b?.notes || '');
    const status = b ? h('select', {}, ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'].map((s) => h('option', { value: s, selected: b.status === s }, s.replace('_', ' ')))) : null;
    const slots = h('div', { class: 'slots' });
    const err = h('div', { class: 'err' });
    const loadSlots = async () => {
      try {
        const s = await api(`/api/admin/availability?difficultyId=${diff.value}&date=${date.value}&excludeId=${b?.id || 0}`);
        slots.replaceChildren(...(s.length ? s.map((x) => h('button', { type: 'button', class: x.available ? '' : 'off', onclick: () => { start.value = x.start; } }, fmtTime(x.start))) : [h('span', { class: 'muted' }, 'Room closed this day (you can still enter a time).')]));
      } catch { slots.replaceChildren(); }
    };
    diff.onchange = date.onchange = loadSlots;
    loadSlots();
    const save = () => attempt(err, async () => {
      const body = { difficulty_id: +diff.value, date: date.value, start: start.value, party_size: +party.value, name: name.value, phone: phone.value, email: email.value, notes: notes.value, status: status?.value };
      await (b ? api(`/api/admin/bookings/${b.id}`, { method: 'PUT', body }) : api('/api/admin/bookings', { method: 'POST', body }));
      close();
      if (!b) sched.date = date.value;
      renderShell();
    });
    return h('div', {},
      field('Room & difficulty', diff),
      h('div', { class: 'cols' }, field('Date', date), field('Start time', start), field('Players', party)),
      h('div', { class: 'muted' }, 'Open start times (struck-through = taken):'), slots,
      h('div', { class: 'cols' }, field('Name', name), field('Phone', phone), field('Email', email)),
      field('Notes', notes), status ? field('Status', status) : '', err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), h('button', { class: 'btn', onclick: close }, 'Close')));
  });
}

// ---------- rooms ----------
async function renderRooms(main) {
  const rooms = await api('/api/admin/rooms');
  main.append(h('div', { class: 'row sp' }, h('h2', {}, 'Rooms & difficulties'), h('button', { class: 'btn primary', onclick: () => roomForm(null) }, '+ Add room')),
    h('p', { class: 'muted' }, 'Each room can be booked once at a time regardless of difficulty. Add as many rooms and difficulty levels as you need.'),
    ...rooms.map((r) => h('div', { class: 'card' },
      h('div', { class: 'row sp' }, h('div', {}, h('b', {}, r.name), r.active ? '' : h('span', { class: 'badge' }, 'inactive'), h('div', { class: 'muted' }, hoursSummary(r.hours))),
        h('button', { class: 'btn sm', onclick: () => roomForm(r) }, 'Edit room & hours')),
      h('table', {}, h('thead', {}, h('tr', {}, ['Difficulty', 'Length', 'Reset', 'Players', 'ERCC match', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, r.difficulties.map((d) => h('tr', {}, h('td', {}, d.name, d.active ? '' : h('span', { class: 'badge' }, 'inactive')), h('td', {}, `${d.duration_min} min`), h('td', {}, `${d.buffer_min} min`),
          h('td', {}, `${d.min_players}-${d.max_players}`), h('td', { class: 'muted' }, d.ercc_ref || '—'), h('td', {}, h('button', { class: 'btn sm', onclick: () => diffForm(r, d) }, 'Edit')))))),
      h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn sm', onclick: () => diffForm(r, null) }, '+ Add difficulty')))));
}
const hoursSummary = (hours) => DAYS.map((d, i) => (hours[i] ? `${d.slice(0, 3)} ${fmtTime(hours[i][0])}–${fmtTime(hours[i][1])}` : null)).filter(Boolean).join(' · ') || 'Closed';

function roomForm(r) {
  modal(r ? `Edit ${r.name}` : 'Add room', (close) => {
    const name = h('input', { value: r?.name || '' });
    const desc = h('input', { value: r?.description || '', placeholder: 'Shown on the kiosk' });
    const active = check('Active (bookable)', r ? !!r.active : true);
    const rows = DAYS.map((d, i) => {
      const hrs = r?.hours?.[i] || (r ? null : ['12:00', '21:00']);
      const open = check(d, !!hrs);
      const a = h('input', { type: 'time', value: hrs?.[0] || '12:00' });
      const z = h('input', { type: 'time', value: hrs?.[1] || '21:00' });
      return { open, a, z, el: h('div', { class: 'row', style: 'margin-bottom:6px' }, h('span', { style: 'width:130px' }, open), a, ' to ', z) };
    });
    const err = h('div', { class: 'err' });
    const save = () => attempt(err, async () => {
      const hours = Object.fromEntries(rows.map((x, i) => [i, x.open.input.checked ? [x.a.value, x.z.value] : null]));
      const body = { name: name.value, description: desc.value, active: active.input.checked, hours };
      await (r ? api(`/api/admin/rooms/${r.id}`, { method: 'PUT', body }) : api('/api/admin/rooms', { method: 'POST', body }));
      close(); renderShell();
    });
    return h('div', {}, field('Room name', name), field('Description', desc), active, h('h3', {}, 'Opening hours'), ...rows.map((x) => x.el), err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), h('button', { class: 'btn', onclick: close }, 'Close')));
  });
}

function diffForm(room, d) {
  modal(d ? `Edit ${d.name}` : `Add difficulty to ${room.name}`, (close) => {
    const name = h('input', { value: d?.name || '' });
    const dur = num(d?.duration_min ?? 60, { min: 5 });
    const buf = num(d?.buffer_min ?? 15, { min: 0 });
    const min = num(d?.min_players ?? 2, { min: 1 });
    const max = num(d?.max_players ?? 8, { min: 1 });
    const ref = h('input', { value: d?.ercc_ref || '', placeholder: 'Room name/id as it appears in ERCC' });
    const active = check('Active (bookable)', d ? !!d.active : true);
    const err = h('div', { class: 'err' });
    const save = () => attempt(err, async () => {
      const body = { name: name.value, duration_min: dur.value, buffer_min: buf.value, min_players: min.value, max_players: max.value, ercc_ref: ref.value, active: active.input.checked };
      await (d ? api(`/api/admin/difficulties/${d.id}`, { method: 'PUT', body }) : api(`/api/admin/rooms/${room.id}/difficulties`, { method: 'POST', body }));
      close(); renderShell();
    });
    return h('div', {}, field('Name (e.g. Standard, Expert)', name),
      h('div', { class: 'cols' }, field('Game length (min)', dur), field('Reset time after (min)', buf), field('Min players', min), field('Max players', max)),
      field('ERCC room match (optional)', ref), active, err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), h('button', { class: 'btn', onclick: close }, 'Close')));
  });
}

// ---------- staff ----------
async function renderStaff(main) {
  const [staff, cfg] = await Promise.all([api('/api/admin/staff'), api('/api/admin/settings')]);
  main.append(h('div', { class: 'row sp' }, h('h2', {}, 'Staff & alerts'), h('button', { class: 'btn primary', onclick: () => staffForm(null, cfg) }, '+ Add staff member')),
    h('p', { class: 'muted' }, 'Everyone marked active gets an alert for every kiosk sign-up and check-in. To remove someone, untick Active - they are logged out and stop receiving alerts immediately.'),
    h('div', { class: 'card', style: 'padding:0;overflow-x:auto' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Name', 'Role', 'Alerts', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, staff.map((s) => h('tr', {},
        h('td', {}, s.name, s.active ? '' : h('span', { class: 'badge' }, 'inactive'), h('div', { class: 'muted' }, s.email)),
        h('td', {}, s.role),
        h('td', {}, [s.notify_push ? 'Push (ntfy)' : null, s.notify_sms ? `SMS ${s.phone}` : null].filter(Boolean).join(', ') || h('span', { class: 'muted' }, 'none')),
        h('td', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => staffForm(s, cfg) }, 'Edit'),
          h('button', { class: 'btn sm', onclick: async (e) => { e.target.textContent = 'Sending…'; const r = await api(`/api/admin/staff/${s.id}/test`, { method: 'POST' }); e.target.textContent = r.results.length ? (r.results.every((x) => x.ok) ? 'Sent ✓' : 'Failed – see log') : 'No channels set'; } }, 'Test alert'))))))));
}

function staffForm(s, cfg) {
  modal(s ? `Edit ${s.name}` : 'Add staff member', (close) => {
    const name = h('input', { value: s?.name || '' });
    const email = h('input', { type: 'email', value: s?.email || '' });
    const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: s ? 'Leave blank to keep current' : 'At least 8 characters' });
    const role = h('select', {}, ['staff', 'admin'].map((r) => h('option', { value: r, selected: s?.role === r }, r === 'admin' ? 'Admin (manage rooms, staff, settings)' : 'Staff (manage bookings)')));
    const phone = h('input', { type: 'tel', value: s?.phone || '', placeholder: '+15551234567' });
    const push = check('Push alerts via ntfy app', s ? !!s.notify_push : true);
    const sms = check(cfg.status.twilio ? 'Text message (SMS)' : 'Text message (SMS) - Twilio not configured yet', s ? !!s.notify_sms : false);
    const active = check('Active', s ? !!s.active : true);
    const err = h('div', { class: 'err' });
    const save = () => attempt(err, async () => {
      const body = { name: name.value, email: email.value, password: pw.value, role: role.value, phone: phone.value, notify_push: push.input.checked, notify_sms: sms.input.checked, active: active.input.checked };
      await (s ? api(`/api/admin/staff/${s.id}`, { method: 'PUT', body }) : api('/api/admin/staff', { method: 'POST', body }));
      close(); renderShell();
    });
    return h('div', {}, h('div', { class: 'cols' }, field('Name', name), field('Login email', email)), field(s ? 'New password' : 'Password', pw), field('Role', role), field('Mobile number (for SMS)', phone),
      push, sms, s ? active : '',
      s?.ntfy_topic ? h('div', { class: 'card muted' }, 'Push setup: install the free ', h('b', {}, 'ntfy'), ' app, tap + and subscribe to topic ', h('code', {}, s.ntfy_topic), cfg.status.ntfy_server !== 'https://ntfy.sh' ? ` on server ${cfg.status.ntfy_server}` : '', '. Then press "Test alert".') : h('div', { class: 'muted' }, 'After saving, edit this person to see their push setup topic.'),
      err, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, 'Save'), h('button', { class: 'btn', onclick: close }, 'Close')));
  });
}

// ---------- settings ----------
async function renderSettings(main) {
  const { settings: s, status } = await api('/api/admin/settings');
  const inputs = {
    business_name: h('input', { value: s.business_name }),
    slot_minutes: num(s.slot_minutes, { min: 5, step: 5 }),
    min_notice_minutes: num(s.min_notice_minutes, { min: 0 }),
    kiosk_days_ahead: num(s.kiosk_days_ahead, { min: 1, max: 90 }),
    idle_seconds: num(s.idle_seconds, { min: 15 }),
    shared_webhook_url: h('input', { value: s.shared_webhook_url, placeholder: 'Slack / Discord / Teams incoming webhook URL' }),
    shared_ntfy_topic: h('input', { value: s.shared_ntfy_topic, placeholder: 'e.g. my-escape-room-staff (acts like a password)' }),
  };
  const err = h('div', { class: 'err' });
  const msg = h('span', { class: 'good' });
  main.append(h('h2', {}, 'Settings'), h('div', { class: 'card' },
    field('Business name (kiosk heading)', inputs.business_name),
    h('div', { class: 'cols' }, field('Start-time interval (min)', inputs.slot_minutes), field('Min. notice for kiosk bookings (min)', inputs.min_notice_minutes), field('Kiosk booking window (days)', inputs.kiosk_days_ahead), field('Kiosk idle reset (seconds)', inputs.idle_seconds)),
    h('h3', {}, 'Shared team alerts (optional)'), h('p', { class: 'muted' }, 'One channel the whole team joins - no per-person setup. Use a Slack/Discord webhook and/or one shared ntfy topic.'),
    field('Webhook URL', inputs.shared_webhook_url), field('Shared ntfy topic', inputs.shared_ntfy_topic), err,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => attempt(err, async () => { await api('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])) }); msg.textContent = 'Saved ✓'; }) }, 'Save settings'), msg)),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, 'Integration status (set in .env on the server)'),
      h('div', {}, 'ERCC high score API: ', status.ercc ? h('span', { class: 'good' }, 'configured') : h('b', {}, 'not configured - kiosk shows demo scores')),
      h('div', {}, 'Twilio SMS: ', status.twilio ? h('span', { class: 'good' }, 'configured') : h('b', {}, 'not configured')),
      h('div', {}, `ntfy server: ${status.ntfy_server} · Timezone: ${status.timezone}`)));
}

// ---------- activity ----------
async function renderActivity(main) {
  const rows = await api('/api/admin/notifications');
  main.append(h('h2', {}, 'Alert log'), h('div', { class: 'card', style: 'padding:0;overflow-x:auto' }, h('table', {},
    h('thead', {}, h('tr', {}, ['When (UTC)', 'Alert', 'To', 'Result'].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map((n) => h('tr', {}, h('td', {}, n.created_at), h('td', {}, h('b', {}, n.title), h('div', { class: 'muted' }, n.message)), h('td', {}, `${n.recipient} (${n.channel})`),
      h('td', {}, n.ok ? h('span', { class: 'good' }, 'sent') : h('span', { style: 'color:var(--bad)' }, 'failed: ' + n.detail))))))));
}

// ---------- boot ----------
async function start() {
  try {
    me = await api('/api/admin/me');
    if (me.role !== 'admin' && tab !== 'schedule') tab = 'schedule';
    renderShell();
  } catch { renderLogin(); }
}
start();
