// Minimal, safe Markdown -> DOM (no innerHTML, so descriptions can't inject markup or scripts).
// Supports: # / ## / ### headings, paragraphs, single line breaks, - or * bullet lists, 1. numbered lists,
// **bold**, *italic* / _italic_, and --- rules. Links and images are intentionally not supported.
import { h } from './ui.js';

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text) {
  return text.split(INLINE).filter(Boolean).map((part) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return h('strong', {}, part.slice(2, -2));
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return h('em', {}, part.slice(1, -1));
    return part;
  });
}

const withBreaks = (lines) => lines.flatMap((l, i) => (i ? [h('br'), ...inline(l)] : inline(l)));

export function renderMarkdown(src) {
  const root = h('div', { class: 'md' });
  const blocks = String(src || '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    const heading = /^(#{1,3})\s+(.*)$/.exec(lines[0]);
    if (heading) {
      root.append(h(`h${heading[1].length + 2}`, {}, inline(heading[2])));
      if (lines.length > 1) root.append(h('p', {}, withBreaks(lines.slice(1))));
    } else if (/^-{3,}$/.test(block.trim())) {
      root.append(h('hr'));
    } else if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      root.append(h('ul', {}, lines.map((l) => h('li', {}, inline(l.replace(/^\s*[-*]\s+/, ''))))));
    } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      root.append(h('ol', {}, lines.map((l) => h('li', {}, inline(l.replace(/^\s*\d+[.)]\s+/, ''))))));
    } else {
      root.append(h('p', {}, withBreaks(lines)));
    }
  }
  return root;
}

/** Plain-text version (markers stripped) for short previews/fallbacks. */
export function plainText(src, max = 150) {
  const t = String(src || '').replace(/^#{1,3}\s+/gm, '').replace(/^\s*([-*]|\d+[.)])\s+/gm, '').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '…' : t;
}
