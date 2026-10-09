import { h, api, fmtTime, fmtDate, addDays, fmtSeconds } from '/shared/ui.js';
import './keyboard.js';

const app = document.getElementById('app');
let cfg;
let idleTimer;
let warnTimer;

// ---------- navigation + idle reset ----------
function show(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}
const home = () => { clearTimeout(warnTimer); document.querySelector('.idle')?.remove(); renderHome(); armIdle(); };

function armIdle() {
  clearTimeout(idleTimer);
  clearTimeout(warnTimer);
  document.querySelector('.idle')?.remove();
  if (!cfg || app.dataset.screen === 'home') return;
  const ms = Math.max(15, cfg.idle_seconds) * 1000;
  warnTimer = setTimeout(() => {
    const box = h('div', { class: 'idle' }, h('div', {}, h('h2', {}, 'Still there?'), h('p', { class: 'sub' }, 'Returning to the start screen shortly.'), h('button', { class: 'primary' }, 'I’m still here')));
    document.body.append(box);
  }, ms - 10_000);
  idleTimer = setTimeout(home, ms);
}
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { if (app.dataset.screen !== 'home') armIdle(); }, true));

function screen(name, ...nodes) {
  app.dataset.screen = name;
  show(...nodes);
  armIdle();
}

const header = (title, subtitle) => h('div', {}, h('div', { class: 'top' }, h('div', { class: 'brand' }, cfg.business_name)), h('h2', {}, title), subtitle ? h('p', { class: 'sub' }, subtitle) : '');
const back = (fn, label = '← Back') => h('button', { class: 'ghost', onclick: fn }, label);
const nav = (...btns) => h('div', { class: 'nav' }, ...btns);
const errorBox = () => h('div', { class: 'error', role: 'alert' });

// ---------- home ----------
function renderHome() {
  screen('home',
    h('div', { class: 'hero' }, h('div', { class: 'brand' }, 'Welcome to'), h('h1', {}, cfg.business_name)),
    h('div', { class: 'home' },
      h('button', { onclick: signinList }, h('span', { class: 'icon' }, '🔑'), 'I have a booking', h('small', {}, 'Check in for today')),
      h('button', { onclick: () => signupStart() }, h('span', { class: 'icon' }, '📅'), 'Book a game', h('small', {}, 'Reserve a room')),
      h('button', { onclick: () => scores() }, h('span', { class: 'icon' }, '🏆'), 'High scores', h('small', {}, 'See the fastest teams')),
    ),
  );
}

// ---------- high scores ----------
async function scores(roomFilter = '') {
  const body = h('div', {}, h('p', { class: 'sub' }, 'Loading scores…'));
  screen('scores', header('🏆 High scores'), body, nav(back(home, '← Home')));
  try {
    const data = await api('/api/public/scores');
    const rooms = [...new Set(data.scores.map((s) => s.room).filter(Boolean))];
    const rows = data.scores.filter((s) => !roomFilter || s.room === roomFilter).slice(0, 10);
    body.replaceChildren(
      rooms.length > 1 ? h('div', { class: 'tabs' },
        h('button', { class: roomFilter ? '' : 'on', onclick: () => scores('') }, 'All rooms'),
        ...rooms.map((r) => h('button', { class: roomFilter === r ? 'on' : '', onclick: () => scores(r) }, r))) : '',
      rows.length ? h('table', { class: 'scores' },
        h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Team'), h('th', {}, 'Time'), h('th', {}, 'Room'), h('th', {}, 'Players'))),
        h('tbody', {}, rows.map((s, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, s.team), h('td', { class: 'time' }, fmtSeconds(s.seconds)), h('td', {}, s.room), h('td', {}, s.players ?? ''))))) : h('p', { class: 'sub' }, 'No scores yet - be the first!'),
      data.demo ? h('p', { class: 'note' }, 'Demo data (ERCC API not configured).') : '',
    );
  } catch (e) {
    body.replaceChildren(h('p', { class: 'error' }, e.message));
  }
}

// ---------- sign in ----------
async function signinList() {
  const body = h('div', {}, h('p', { class: 'sub' }, 'Loading…'));
  screen('signin', header('Find your booking', 'Tap your name to check in.'), body,
    nav(back(home, '← Home'), h('button', { onclick: signinCode }, 'Use my confirmation code'), h('button', { class: 'primary', onclick: () => signupStart() }, 'Not listed? Book now')));
  try {
    const list = await api('/api/public/today');
    body.replaceChildren(list.length ? h('div', { class: 'grid' }, list.map((b) => h('button', { class: 'card', onclick: () => signinVerify(b) },
      h('strong', {}, b.label), h('span', {}, `${fmtTime(b.start)} · ${b.room_name} (${b.difficulty_name})`), h('br'), h('span', {}, `${b.party_size} players`))))
      : h('p', { class: 'sub' }, 'No more bookings waiting to check in today.'));
  } catch (e) {
    body.replaceChildren(h('p', { class: 'error' }, e.message));
  }
}

function signinVerify(b) {
  let pin = '';
  const dots = h('div', { class: 'pin' });
  const err = errorBox();
  const draw = () => dots.replaceChildren(...[0, 1, 2, 3].map((i) => h('span', {}, pin[i] ? '●' : '')));
  const press = async (d) => {
    err.textContent = '';
    if (d === '⌫') pin = pin.slice(0, -1); else if (pin.length < 4) pin += d;
    draw();
    if (pin.length === 4) {
      try {
        const r = await api('/api/public/checkin', { method: 'POST', body: { id: b.id, verify: pin } });
        checkedIn(r);
      } catch (e) { err.textContent = e.message; pin = ''; draw(); }
    }
  };
  draw();
  screen('verify', header(`Hi ${b.label.split(' ')[0]}!`, 'Enter the last 4 digits of the phone number on your booking.'), dots, err,
    h('div', { class: 'keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d) => d ? h('button', { onclick: () => press(d) }, d) : h('span'))),
    nav(back(signinList)));
}

function signinCode() {
  const input = h('input', { 'data-kb': 'email', inputmode: 'none', autocomplete: 'off', maxlength: 6, placeholder: 'ABC123', style: 'text-transform:uppercase' });
  const err = errorBox();
  const go = async () => {
    err.textContent = '';
    try { checkedIn(await api('/api/public/checkin', { method: 'POST', body: { code: input.value } })); } catch (e) { err.textContent = e.message; }
  };
  screen('code', header('Confirmation code', 'Enter the 6-character code from your booking.'), h('div', { class: 'fields' }, h('label', { class: 'field' }, 'Code', input), err),
    nav(back(signinList), h('button', { class: 'primary', onclick: go }, 'Check in')));
}

function checkedIn(r) {
  screen('done', h('div', { class: 'ok-big' }, h('div', { class: 'check' }, '✓'), h('h1', {}, `Welcome, ${r.name}!`),
    h('p', { class: 'sub' }, `You're checked in for ${r.room_name} at ${fmtTime(r.start)}. A team member will be right with you.`),
    h('button', { class: 'primary', onclick: home }, 'Done')));
  setTimeout(() => { if (app.dataset.screen === 'done') home(); }, 15_000);
}

// ---------- sign up ----------
let draft;
function signupStart() {
  draft = { room: null, diff: null, date: null, start: null, party: null, name: '', phone: '', email: '' };
  stepRoom();
}

function stepRoom() {
  screen('signup', header('Choose your room'), h('div', { class: 'grid' }, cfg.rooms.map((r) => h('button', { class: 'card', onclick: () => { draft.room = r; stepDifficulty(); } },
    h('strong', {}, r.name), h('span', {}, r.description || `${r.difficulties.length} difficulty levels`)))), nav(back(home, '← Home')));
}
function stepDifficulty() {
  screen('signup', header(draft.room.name, 'Choose a difficulty'), h('div', { class: 'grid' }, draft.room.difficulties.map((d) => h('button', { class: 'card', onclick: () => { draft.diff = d; draft.party = Math.max(d.min_players, Math.min(4, d.max_players)); stepDate(); } },
    h('strong', {}, d.name), h('span', {}, `${d.duration_min} minutes · ${d.min_players}-${d.max_players} players`)))), nav(back(stepRoom)));
}
function stepDate() {
  const days = Array.from({ length: cfg.days_ahead + 1 }, (_, i) => addDays(cfg.today, i));
  screen('signup', header('Pick a day'), h('div', { class: 'grid' }, days.map((d) => h('button', { class: 'card slot', onclick: () => { draft.date = d; stepTime(); } },
    h('strong', {}, d === cfg.today ? 'Today' : fmtDate(d, { weekday: 'short' })), h('span', {}, fmtDate(d, { month: 'short', day: 'numeric' }))))), nav(back(stepDifficulty)));
}
async function stepTime() {
  const body = h('p', { class: 'sub' }, 'Loading times…');
  screen('signup', header('Pick a time', `${draft.room.name} · ${draft.diff.name} · ${fmtDate(draft.date)}`), body, nav(back(stepDate)));
  try {
    const slots = await api(`/api/public/availability?difficultyId=${draft.diff.id}&date=${draft.date}`);
    const open = slots.filter((s) => s.available);
    body.replaceWith(open.length ? h('div', { class: 'grid' }, slots.map((s) => h('button', { class: 'card slot' + (s.available ? '' : ' off'), disabled: !s.available, onclick: () => { draft.start = s.start; stepParty(); } }, h('strong', {}, fmtTime(s.start)))))
      : h('p', { class: 'sub' }, 'No times available that day. Please go back and choose another.'));
  } catch (e) { body.textContent = e.message; body.className = 'error'; }
}
function stepParty() {
  const { min_players: min, max_players: max } = draft.diff;
  const out = h('output', {}, draft.party);
  const set = (n) => { draft.party = Math.min(max, Math.max(min, n)); out.textContent = draft.party; };
  screen('signup', header('How many players?', `${min}-${max} players`), h('div', { class: 'stepper' }, h('button', { onclick: () => set(draft.party - 1) }, '−'), out, h('button', { onclick: () => set(draft.party + 1) }, '+')),
    nav(back(stepTime), h('button', { class: 'primary', onclick: stepDetails }, 'Next →')));
}
function stepDetails() {
  const f = (label, key, kb, extra = {}) => {
    const input = h('input', { 'data-kb': kb, inputmode: 'none', autocomplete: 'off', value: draft[key], oninput: () => { draft[key] = input.value; }, ...extra });
    return h('label', { class: 'field' }, label, input);
  };
  const err = errorBox();
  const next = () => {
    if (!draft.name.trim()) err.textContent = 'Please enter your name.';
    else if (draft.phone.replace(/\D/g, '').length < 7) err.textContent = 'Please enter a valid phone number.';
    else stepConfirm();
  };
  screen('signup', header('Your details', 'We use your phone number to check you in.'),
    h('div', { class: 'fields' }, f('Name', 'name', 'text', { maxlength: 80 }), f('Mobile phone', 'phone', 'tel', { maxlength: 30 }), f('Email (optional)', 'email', 'email', { maxlength: 120 }), err),
    nav(back(stepParty), h('button', { class: 'primary', onclick: next }, 'Review →')));
}
function stepConfirm() {
  const err = errorBox();
  const btn = h('button', { class: 'primary' }, 'Confirm booking');
  btn.onclick = async () => {
    btn.disabled = true;
    err.textContent = '';
    try {
      const r = await api('/api/public/bookings', { method: 'POST', body: { difficulty_id: draft.diff.id, date: draft.date, start: draft.start, party_size: draft.party, name: draft.name, phone: draft.phone, email: draft.email } });
      signupDone(r);
    } catch (e) { err.textContent = e.message; btn.disabled = false; if (e.status === 409) setTimeout(stepTime, 2500); }
  };
  screen('signup', header('Review your booking'),
    h('div', { class: 'summary' }, h('div', {}, h('b', {}, draft.room.name), ` · ${draft.diff.name} (${draft.diff.duration_min} min)`), h('div', {}, `${fmtDate(draft.date, { weekday: 'long', month: 'long', day: 'numeric' })} at ${fmtTime(draft.start)}`),
      h('div', {}, `${draft.party} players`), h('div', {}, `${draft.name} · ${draft.phone}`)), err,
    nav(back(stepDetails), btn));
}
function signupDone(r) {
  screen('done', h('div', { class: 'ok-big' }, h('div', { class: 'check' }, '✓'), h('h1', {}, "You're booked!"),
    h('p', { class: 'sub' }, `${r.room_name} (${r.difficulty_name}) · ${fmtDate(r.date)} at ${fmtTime(r.start)}`),
    h('p', {}, 'Your confirmation code'), h('div', { class: 'code' }, r.code), h('p', { class: 'sub' }, 'Our team has been notified. Use your phone number or this code to check in.'),
    h('button', { class: 'primary', onclick: home }, 'Done')));
  setTimeout(() => { if (app.dataset.screen === 'done') home(); }, 25_000);
}

// ---------- boot ----------
async function boot() {
  try {
    cfg = await api('/api/public/config');
    document.title = cfg.business_name;
    renderHome();
  } catch (e) {
    show(h('div', { class: 'ok-big' }, h('h1', {}, 'Temporarily unavailable'), h('p', { class: 'error' }, e.message)));
    setTimeout(boot, 10_000);
  }
}
document.addEventListener('click', (e) => { if (e.target.closest('.idle button')) armIdle(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());
boot();
