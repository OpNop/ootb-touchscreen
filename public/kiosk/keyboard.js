// On-screen keyboard for inputs marked data-kb="text|email|tel". Inputs use inputmode="none" so the OS keyboard stays away.
import { h } from '/shared/ui.js';

const root = document.getElementById('kb');
const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
let target = null;
let shift = false;
let symbols = false;

function insert(text) {
  if (!target) return;
  const { selectionStart: s = target.value.length, selectionEnd: e = target.value.length } = target;
  target.setRangeText(text, s, e, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
}
function backspace() {
  if (!target) return;
  const s = target.selectionStart, e = target.selectionEnd;
  if (s !== e) target.setRangeText('', s, e, 'end');
  else if (s > 0) target.setRangeText('', s - 1, s, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
}
function autoShift() {
  if (target?.dataset.kb !== 'text') return false;
  const before = target.value.slice(0, target.selectionStart);
  return before === '' || /\s$/.test(before);
}

// pointerdown + preventDefault keeps focus in the input so the caret stays put
const key = (label, fn, cls = '') => h('button', { class: cls, type: 'button', onpointerdown: (e) => { e.preventDefault(); fn(); render(); } }, label);

function render() {
  const mode = target?.dataset.kb;
  if (!mode) { root.hidden = true; document.body.classList.remove('kb-open'); return; }
  root.hidden = false;
  document.body.classList.add('kb-open');
  const caps = shift || autoShift();
  const ch = (c) => key(caps ? c.toUpperCase() : c, () => { insert(caps ? c.toUpperCase() : c); shift = false; });
  root.replaceChildren();
  if (mode === 'tel') {
    root.append(
      h('div', { class: 'row' }, ...'123'.split('').map((c) => key(c, () => insert(c)))),
      h('div', { class: 'row' }, ...'456'.split('').map((c) => key(c, () => insert(c)))),
      h('div', { class: 'row' }, ...'789'.split('').map((c) => key(c, () => insert(c)))),
      h('div', { class: 'row' }, key('-', () => insert('-')), key('0', () => insert('0')), key('⌫', backspace)),
      h('div', { class: 'row' }, key('Done', () => target.blur(), 'wide primary')),
    );
    return;
  }
  const nums = h('div', { class: 'row' }, ...'1234567890'.split('').map((c) => key(c, () => insert(c))));
  const sym = ['@._-+', "'&/#!"];
  root.append(nums);
  if (symbols) {
    root.append(...sym.map((r) => h('div', { class: 'row' }, ...r.split('').map((c) => key(c, () => insert(c))))));
  } else {
    root.append(h('div', { class: 'row' }, ...LETTERS[0].split('').map(ch)), h('div', { class: 'row' }, ...LETTERS[1].split('').map(ch)));
  }
  root.append(h('div', { class: 'row' },
    symbols ? '' : key('⇧', () => { shift = !shift; }, 'wide ' + (shift ? 'on' : '')),
    ...(symbols ? [] : LETTERS[2].split('').map(ch)),
    key('⌫', backspace, 'wide'),
  ));
  root.append(h('div', { class: 'row' },
    key(symbols ? 'ABC' : '@#.', () => { symbols = !symbols; }, 'wide'),
    mode === 'email' ? key('@', () => insert('@')) : '',
    key('.', () => insert('.')),
    key('space', () => insert(' '), 'space'),
    mode === 'email' ? key('.com', () => insert('.com'), 'wide') : '',
    key('Done', () => target.blur(), 'wide primary'),
  ));
}

document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('input[data-kb]')) {
    target = e.target;
    symbols = false;
    render();
    setTimeout(() => target?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }
});
document.addEventListener('focusout', (e) => {
  if (e.target === target) setTimeout(() => { if (document.activeElement !== target) { target = null; render(); } }, 0);
});
document.addEventListener('input', () => { if (target) render(); });
