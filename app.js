'use strict';

/* =========================================================================
   Lore Codex — a personal, on-device wiki.
   Everything is stored in this browser's localStorage. Nothing is synced.
   ========================================================================= */

const APP_VERSION = '1.9';
const STORE_KEY = 'lore-codex:v1';
const DEFAULT_TYPES = ['Character', 'Place', 'Boss', 'Item', 'Faction', 'Concept'];
const NO_TYPE = '_none';
const LONG_PRESS_MS = 450;

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const editbar = document.getElementById('editbar');
const suggestEl = document.getElementById('suggest');
const chipSlot = document.getElementById('chip-slot');
const toastEl = document.getElementById('toast');

/* ---------------------------------------------------------------- storage */

let db = load();

function freshDb() {
  return {
    version: 1,
    types: DEFAULT_TYPES.map(name => ({ id: uid(), name })),
    pages: {},
    meta: {}
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeDb(JSON.parse(raw));
  } catch (e) {
    console.error('Could not read saved data', e);
  }
  return freshDb();
}

function normalizeDb(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.types) || typeof d.pages !== 'object') {
    throw new Error('Not a Lore Codex file');
  }
  d.version = 1;
  d.meta = d.meta || {};
  for (const p of Object.values(d.pages)) {
    p.aka = Array.isArray(p.aka) ? p.aka : [];
    p.tags = Array.isArray(p.tags) ? p.tags : [];
    p.body = Array.isArray(p.body) ? p.body : [];
    p.title = p.title || '';
    p.typeId = p.typeId || null;
  }
  return d;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    console.error(e);
    toast('Could not save — storage may be full. Export a backup.');
  }
}

let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 350);
}
function persistNow() {
  clearTimeout(persistTimer);
  persist();
}

if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

/* ---------------------------------------------------------------- helpers */

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID().slice(0, 12);
  return Math.random().toString(36).slice(2, 14);
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function svgIcon(paths) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  return s;
}
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>'
};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const byTitle = (a, b) => collator.compare(a.title || '', b.title || '');

const allPages = () => Object.values(db.pages);
const activePages = () => allPages().filter(p => !p.archived);
const typeById = id => db.types.find(t => t.id === id);
const typeName = id => (typeById(id) || {}).name;
const namesOf = p => [p.title, ...p.aka].filter(Boolean);
const displayTitle = p => p.title || 'Untitled';
const bodyText = p => p.body.map(s => typeof s === 'string' ? s : s.t).join('');
const isBlank = p => !bodyText(p).trim();

function normTag(t) {
  return t.trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-');
}

function linkState(id) {
  const t = db.pages[id];
  if (!t) return 'missing';
  if (t.archived) return 'archived';
  return isBlank(t) ? 'stub' : 'ok';
}

function backlinks(id) {
  return activePages()
    .filter(p => p.id !== id && p.body.some(s => typeof s !== 'string' && s.l === id))
    .sort(byTitle);
}

function retargetLinks(fromId, toId) {
  for (const p of allPages()) {
    for (const s of p.body) if (typeof s !== 'string' && s.l === fromId) s.l = toId;
  }
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/* A bottom sheet with a list of actions. */
function sheet({ title, message, content, actions, onCancel }) {
  const vv = window.visualViewport;
  // Keep the sheet above the on-screen keyboard.
  const fit = () => {
    if (!vv) return;
    backdrop.style.top = vv.offsetTop + 'px';
    backdrop.style.height = vv.height + 'px';
  };
  const close = () => {
    backdrop.remove();
    if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
  };
  const cancel = () => { close(); if (onCancel) onCancel(); };
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: e => { if (e.target === backdrop) cancel(); } },
    h('div', { class: 'sheet leaf', role: 'dialog', 'aria-modal': 'true' },
      title && h('h3', { text: title }),
      message && h('p', { text: message }),
      content || null,
      h('div', { class: 'sheet-actions' },
        actions.map(a => h('button', {
          class: 'btn ' + (a.style || ''),
          onclick: () => { close(); a.run(); }
        }, a.label)),
        h('button', { class: 'btn cancel', onclick: cancel }, 'Cancel')
      )
    )
  );
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
  document.body.append(backdrop);
  fit();
  return { close };
}

/* ---------------------------------------------------------------- routing */

function routeParts() {
  const raw = location.hash.replace(/^#\/?/, '');
  return raw.split('/').filter(Boolean).map(decodeURIComponent);
}

function navigate(path, { replace = false } = {}) {
  const url = '#/' + path;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  render();
}

window.addEventListener('popstate', render);

function render() {
  if (editing) finishEdit({ rerender: false });
  closeSuggest();
  document.querySelectorAll('.sheet-backdrop').forEach(n => n.remove());
  view.textContent = '';
  view.pageCtl = null;
  const [section, arg] = routeParts();
  let tab = null;
  if (!section) { renderHome(); tab = 'home'; }
  else if (section === 'page') renderPage(arg, routeParts()[2]);
  else if (section === 'questions') renderQuestions();
  else if (section === 'type') renderType(arg);
  else if (section === 'settings') { renderSettings(); tab = 'settings'; }
  else if (section === 'archive') renderArchive();
  else renderHome();
  tabbar.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.nav === tab));
  window.scrollTo(0, 0);
}

tabbar.addEventListener('click', e => {
  const b = e.target.closest('[data-nav]');
  if (!b) return;
  const nav = b.dataset.nav;
  if (nav === 'home') { homeQuery = ''; navigate(''); }
  else if (nav === 'settings') navigate('settings');
  else if (nav === 'new') newPage({});
});

function topbar(title, extra) {
  return h('div', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: goBack }, svgIcon(ICON.back)),
    h('h2', { text: title }),
    extra || null
  );
}

function goBack() {
  if (history.length > 1 && history.state !== 'root') history.back();
  else navigate('', { replace: true });
}

/* ---------------------------------------------------------------- home */

let homeQuery = '';

function renderHome() {
  const results = h('div', { class: 'list' });
  const grid = h('div');

  const input = h('input', {
    type: 'search',
    placeholder: 'Search the codex…',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    'aria-label': 'Search'
  });
  input.value = homeQuery;
  const clear = h('button', { class: 'clear', 'aria-label': 'Clear search', hidden: !homeQuery }, '×');

  const update = () => {
    homeQuery = input.value;
    clear.hidden = !homeQuery;
    const q = homeQuery.trim();
    grid.hidden = !!q;
    results.hidden = !q;
    results.textContent = '';
    if (q) renderResults(results, q);
  };
  input.addEventListener('input', update);
  clear.addEventListener('click', () => { input.value = ''; update(); input.focus(); });

  // Type grid
  const counts = {};
  for (const p of activePages()) {
    const k = p.typeId && typeById(p.typeId) ? p.typeId : NO_TYPE;
    counts[k] = (counts[k] || 0) + 1;
  }
  const tiles = db.types.map(t => h('button', {
    class: 'tile leaf', onclick: () => navigate('type/' + t.id)
  }, h('span', { class: 'name', text: t.name }), h('span', { class: 'count', text: counts[t.id] || 0 })));
  if (counts[NO_TYPE]) {
    tiles.push(h('button', { class: 'tile leaf muted', onclick: () => navigate('type/' + NO_TYPE) },
      h('span', { class: 'name', text: 'Untyped' }), h('span', { class: 'count', text: counts[NO_TYPE] })));
  }
  const openQuestions = activePages().reduce((n, p) => n + questionsOf(p).length, 0);
  if (openQuestions) {
    tiles.push(h('button', { class: 'tile leaf questions-tile', onclick: () => navigate('questions') },
      h('span', { class: 'name', text: 'Questions' }), h('span', { class: 'count', text: openQuestions })));
  }
  grid.append(h('div', { class: 'grid' }, tiles));
  if (!activePages().length) {
    grid.append(h('p', { class: 'empty-note', text: 'Your codex is empty. Tap ＋ to begin your first page.' }));
  }

  view.append(
    h('header', { class: 'masthead' },
      h('h1', { text: 'Lore Codex' }),
      h('p', { text: 'A wanderer’s journal' })
    ),
    h('label', { class: 'search leaf' }, svgIcon(ICON.search), input, clear),
    grid,
    results
  );
  update();
}

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return [text];
  return [text.slice(0, i), h('mark', { text: text.slice(i, i + q.length) }), text.slice(i + q.length)];
}

function snippet(text, q, radius = 60) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

function searchPages(q) {
  const ql = q.toLowerCase();
  const out = [];
  if (q.startsWith('#')) {
    const tq = normTag(q);
    for (const p of activePages()) {
      if (p.tags.some(t => t.startsWith(tq))) out.push({ p, score: p.tags.includes(tq) ? 0 : 1, why: 'tag' });
    }
  } else {
    for (const p of activePages()) {
      const title = p.title.toLowerCase();
      let score = null, why = 'title', aka = null;
      if (title === ql) score = 0;
      else if (title.startsWith(ql)) score = 1;
      else if (title.split(/\s+/).some(w => w.startsWith(ql))) score = 2;
      else if (title.includes(ql)) score = 3;
      else if ((aka = p.aka.find(a => a.toLowerCase().includes(ql)))) { score = 4; why = 'aka'; }
      else if (p.tags.some(t => t.includes(ql))) { score = 5; why = 'tag'; }
      else if (bodyText(p).toLowerCase().includes(ql)) { score = 6; why = 'body'; }
      if (score != null) out.push({ p, score, why, aka });
    }
  }
  return out.sort((a, b) => a.score - b.score || byTitle(a.p, b.p));
}

function renderResults(container, q) {
  const found = searchPages(q);
  for (const { p, why, aka } of found.slice(0, 60)) {
    const tn = typeName(p.typeId);
    let sub = null;
    if (why === 'aka') sub = h('div', { class: 'sub' }, 'also known as ', highlight(aka, q));
    else if (why === 'tag') sub = h('div', { class: 'sub', text: p.tags.map(t => '#' + t).join('  ') });
    else if (why === 'body') sub = h('div', { class: 'snip' }, highlight(snippet(bodyText(p), q), q));
    else if (p.aka.length) sub = h('div', { class: 'sub', text: 'also ' + p.aka.join(', ') });
    container.append(h('button', { class: 'item leaf', onclick: () => navigate('page/' + p.id) },
      h('div', { class: 'item-row' },
        h('span', { class: 't' }, highlight(displayTitle(p), why === 'title' ? q : '')),
        tn && h('span', { class: 'stamp', text: tn })
      ),
      sub
    ));
  }
  if (!found.length) container.append(h('p', { class: 'empty-note', text: 'Nothing recorded yet.' }));
  if (!q.startsWith('#') && !found.some(r => namesOf(r.p).some(n => n.toLowerCase() === q.toLowerCase()))) {
    container.append(h('button', {
      class: 'item create',
      onclick: () => newPage({ title: q })
    }, h('span', { class: 't' }, '＋ New page “' + q + '”')));
  }
}

/* ---------------------------------------------------------------- type list */

function renderType(typeId) {
  const isNone = typeId === NO_TYPE;
  const type = typeById(typeId);
  if (!isNone && !type) { navigate('', { replace: true }); return; }
  const pages = activePages()
    .filter(p => isNone ? !(p.typeId && typeById(p.typeId)) : p.typeId === typeId)
    .sort(byTitle);

  const list = h('div', { class: 'list' });
  for (const p of pages) {
    list.append(h('button', { class: 'item leaf', onclick: () => navigate('page/' + p.id) },
      h('div', { class: 't', text: displayTitle(p) }),
      p.aka.length ? h('div', { class: 'sub', text: 'also ' + p.aka.join(', ') }) : null
    ));
  }
  if (!pages.length) list.append(h('p', { class: 'empty-note', text: 'No pages of this kind yet.' }));

  view.append(
    topbar(isNone ? 'Untyped' : type.name,
      isNone ? null : h('button', { class: 'btn', onclick: () => newPage({ typeId }) }, '＋ New')),
    list
  );
}

/* ---------------------------------------------------------------- pages */

function newPage({ title = '', typeId = null }) {
  const p = {
    id: uid(),
    title: title.trim(),
    aka: [],
    typeId,
    tags: [],
    body: [],
    created: Date.now(),
    updated: Date.now(),
    fresh: true
  };
  db.pages[p.id] = p;
  persistNow();
  // Render synchronously so focusing can raise the keyboard on iOS.
  navigate('page/' + p.id);
  if (view.pageCtl) view.pageCtl.startEdit({ focus: title ? 'body' : 'title' });
}

function renderPage(id, focusQuestion) {
  const p = db.pages[id];
  if (!p) {
    view.append(topbar(''), h('p', { class: 'empty-note', text: 'This page no longer exists.' }));
    return;
  }

  const article = h('article', { class: 'page leaf' });
  const headSlot = h('div');
  const bodyEl = h('div', {
    class: 'body',
    'data-placeholder': 'Hold anywhere to start writing.',
    spellcheck: 'true',
    autocapitalize: 'sentences'
  });
  renderReadBody(bodyEl, p.body);
  bodyEl.classList.toggle('is-empty', !p.body.length);

  if (p.archived) {
    view.append(topbar(''),
      h('div', { class: 'archived-banner' },
        h('span', { text: 'This page rests in the archive.' }),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => restorePage(p) }, 'Restore'),
          h('button', { class: 'btn danger', onclick: () => deleteForever(p) }, 'Delete')
        )
      )
    );
  } else {
    view.append(topbar(''));
  }

  const ctl = {
    page: p,
    article,
    bodyEl,
    drawHead() {
      headSlot.textContent = '';
      headSlot.append(editing && editing.ctl === ctl ? editHeader(p) : readHeader(p, ctl));
    },
    startEdit(opts) { startEdit(ctl, opts); }
  };
  view.pageCtl = ctl;
  ctl.drawHead();

  article.append(headSlot, h('div', { class: 'rule' }), bodyEl);
  view.append(article);

  const bl = backlinks(p.id);
  if (bl.length) {
    const list = h('div', { class: 'list' });
    for (const b of bl) {
      const seg = b.body.find(s => typeof s !== 'string' && s.l === p.id);
      const text = bodyText(b);
      list.append(h('button', { class: 'item leaf', onclick: () => navigate('page/' + b.id) },
        h('div', { class: 't', text: displayTitle(b) }),
        h('div', { class: 'snip' }, highlight(snippet(text, seg.t, 50), seg.t))
      ));
    }
    view.append(h('section', { class: 'backlinks' }, h('div', { class: 'section-label', text: 'Mentioned in' }), list));
  }

  // Tapping links (reading view)
  bodyEl.addEventListener('click', e => {
    if (suppressClick) return;
    const a = e.target.closest('.link');
    if (a) openLink(a.dataset.id, a.textContent);
  });

  if (focusQuestion != null) {
    const q = bodyEl.querySelector(`.question[data-q="${Number(focusQuestion)}"]`);
    if (q) setTimeout(() => {
      q.scrollIntoView({ block: 'center', behavior: 'smooth' });
      q.classList.add('flash');
      setTimeout(() => q.classList.remove('flash'), 2200);
    }, 60);
  }

  if (!p.archived) {
    attachLongPress(article, (x, y, target) => {
      let focus = 'body';
      const field = target.closest && target.closest('[data-field]');
      if (field) focus = field.dataset.field;
      startEdit(ctl, { focus, x, y, target });
    });
  }
}

function readHeader(p, ctl) {
  const head = h('div', { class: 'page-head' });
  head.append(h('h1', { class: 'page-title' + (p.title ? '' : ' untitled'), 'data-field': 'title', text: displayTitle(p) }));

  if (!p.archived) {
    head.append(h('div', { class: 'page-menu' },
      h('button', {
        class: 'icon-btn', 'aria-label': 'Page options',
        onclick: () => sheet({
          title: displayTitle(p),
          actions: [
            { label: 'Edit page', run: () => ctl.startEdit({ focus: 'body' }) },
            { label: 'Move to archive', style: 'danger', run: () => archivePage(p) }
          ]
        })
      }, svgIcon(ICON.more))
    ));
  }

  const meta = h('div', { class: 'meta', 'data-field': 'type' });
  const tn = typeName(p.typeId);
  meta.append(h('span', {
    class: 'stamp' + (tn ? '' : ' none'),
    text: tn || 'No type',
    onclick: () => { if (!suppressClick) navigate('type/' + (tn ? p.typeId : NO_TYPE)); }
  }));
  head.append(meta);

  if (p.tags.length) {
    head.append(h('div', { class: 'meta', 'data-field': 'tags' },
      p.tags.map(t => h('button', {
        class: 'tag',
        onclick: () => { if (!suppressClick) { homeQuery = '#' + t; navigate(''); } }
      }, '#' + t))
    ));
  }

  if (p.aka.length) {
    const row = h('div', { class: 'meta', 'data-field': 'aka' }, h('span', { class: 'meta-label', text: 'Also known as' }));
    p.aka.forEach((a, i) => {
      if (i) row.append(h('span', { class: 'aka-sep', text: '·' }));
      row.append(h('button', {
        class: 'aka',
        onclick: () => {
          if (suppressClick || p.archived) return;
          sheet({
            title: a,
            message: `Currently the main title is “${displayTitle(p)}”.`,
            actions: [{ label: `Make “${a}” the main title`, style: 'gilt', run: () => swapTitle(p, i) }]
          });
        }
      }, a));
    });
    head.append(row);
  }
  return head;
}

function editHeader(p) {
  const title = h('input', {
    class: 'title-input',
    placeholder: 'Title',
    value: p.title,
    autocapitalize: 'words',
    enterkeyhint: 'next',
    'aria-label': 'Title'
  });
  title.value = p.title;
  title.addEventListener('input', () => { p.title = title.value; touch(p); });
  title.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); focusBodyEnd(); }
  });

  const select = h('select', { class: 'type-select', 'aria-label': 'Type' },
    h('option', { value: '', text: '— No type —' }),
    db.types.map(t => h('option', { value: t.id, text: t.name }))
  );
  select.value = p.typeId && typeById(p.typeId) ? p.typeId : '';
  select.addEventListener('change', () => { p.typeId = select.value || null; touch(p); });

  const tags = chipInput({
    values: p.tags,
    placeholder: 'Add a tag…',
    format: v => '#' + v,
    clean: normTag,
    chipClass: '',
    onChange: v => { p.tags = v; touch(p); }
  });

  const aka = chipInput({
    values: p.aka,
    placeholder: 'Add another name…',
    clean: v => v.trim().replace(/\s+/g, ' '),
    chipClass: 'aka-chip',
    keepCase: true,
    onChange: v => { p.aka = v; touch(p); }
  });

  return h('div', { class: 'page-head editing-head' },
    h('div', { 'data-f': 'title' }, title),
    h('div', { class: 'field', 'data-f': 'type' }, h('label', { text: 'Type' }), select),
    h('div', { class: 'field', 'data-f': 'tags' }, h('label', { text: 'Tags' }), tags),
    h('div', { class: 'field', 'data-f': 'aka' }, h('label', { text: 'Also known as' }), aka)
  );
}

function chipInput({ values, placeholder, format = v => v, clean, chipClass, onChange }) {
  let list = values.slice();
  const wrap = h('div', { class: 'chip-input' });
  const input = h('input', { placeholder, enterkeyhint: 'done', autocapitalize: chipClass ? 'words' : 'off' });

  const draw = () => {
    wrap.querySelectorAll('.chip').forEach(c => c.remove());
    list.forEach((v, i) => {
      wrap.insertBefore(h('span', { class: 'chip ' + chipClass },
        format(v),
        h('button', {
          'aria-label': 'Remove ' + v,
          onclick: e => { e.preventDefault(); list.splice(i, 1); draw(); onChange(list.slice()); }
        }, '×')
      ), input);
    });
  };
  const commit = () => {
    const parts = input.value.split(',').map(clean).filter(Boolean);
    input.value = '';
    let changed = false;
    for (const v of parts) {
      if (!list.some(x => x.toLowerCase() === v.toLowerCase())) { list.push(v); changed = true; }
    }
    if (changed) { draw(); onChange(list.slice()); }
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !input.value && list.length) {
      list.pop(); draw(); onChange(list.slice());
    }
  });
  input.addEventListener('input', () => { if (input.value.includes(',')) commit(); });
  input.addEventListener('blur', commit);
  wrap.addEventListener('click', e => { if (e.target === wrap) input.focus(); });
  wrap.append(input);
  wrap.commit = commit;
  draw();
  return wrap;
}

function touch(p) {
  p.updated = Date.now();
  persistSoon();
}

function swapTitle(p, i) {
  const old = p.title;
  p.title = p.aka[i];
  if (old) p.aka[i] = old; else p.aka.splice(i, 1);
  touch(p);
  persistNow();
  render();
  toast(`Now titled “${p.title}”`);
}

function archivePage(p) {
  sheet({
    title: `Archive “${displayTitle(p)}”?`,
    message: 'Links to it will show as unwritten. You can restore it from the archive.',
    actions: [{
      label: 'Move to archive', style: 'danger',
      run: () => {
        p.archived = true;
        p.archivedAt = Date.now();
        persistNow();
        navigate('', { replace: true });
        toast('Moved to the archive');
      }
    }]
  });
}

function restorePage(p, { open = true } = {}) {
  p.archived = false;
  delete p.archivedAt;
  touch(p);
  persistNow();
  toast(`Restored “${displayTitle(p)}”`);
  if (open) navigate('page/' + p.id, { replace: true });
  else render();
}

function deleteForever(p) {
  sheet({
    title: `Delete “${displayTitle(p)}” forever?`,
    message: 'This cannot be undone. Links to it will stay unwritten.',
    actions: [{
      label: 'Delete forever', style: 'danger',
      run: () => {
        delete db.pages[p.id];
        persistNow();
        navigate('archive', { replace: true });
      }
    }]
  });
}

function openLink(id, text) {
  const state = linkState(id);
  if (state === 'ok' || state === 'stub') { navigate('page/' + id); return; }
  const old = db.pages[id];
  const startNew = () => {
    const p = {
      id: uid(), title: old ? old.title : text, aka: old ? old.aka.slice() : [], typeId: old ? old.typeId : null,
      tags: old ? old.tags.slice() : [], body: [], created: Date.now(), updated: Date.now(), fresh: true
    };
    db.pages[p.id] = p;
    retargetLinks(id, p.id);
    persistNow();
    navigate('page/' + p.id);
    if (view.pageCtl) view.pageCtl.startEdit({ focus: 'body' });
  };
  const actions = [];
  if (state === 'archived') {
    actions.push({
      label: `Restore “${displayTitle(old)}”`, style: 'gilt',
      run: () => { restorePage(old, { open: false }); navigate('page/' + old.id); }
    });
  }
  actions.push({ label: 'Start a new page', run: startNew });
  sheet({
    title: text,
    message: state === 'archived' ? 'This page is in the archive.' : 'This page was deleted.',
    actions
  });
}

/* ---------------------------------------------------------------- body rendering */

function linkEl(seg) {
  const state = linkState(seg.l);
  const cls = state === 'ok' ? 'link' : state === 'stub' ? 'link stub' : 'link unwritten';
  return h('span', { class: cls, contenteditable: 'false', 'data-id': seg.l, text: seg.t });
}

// Reading view: lines starting with "* " become bullets, "> " become quotes.
// Each line element records where its text starts in the raw notes, so a
// long-press can put the caret at the same spot in the editable raw text.
const LIST_RE = /^\*\s+/;
const QUOTE_RE = /^>\s?/;

function splitLines(segs) {
  const lines = [[]];
  for (const s of segs) {
    if (typeof s === 'string') {
      s.split('\n').forEach((part, i) => {
        if (i) lines.push([]);
        if (part) lines[lines.length - 1].push(part);
      });
    } else lines[lines.length - 1].push(s);
  }
  return lines;
}

// A line's kind (plain, bullet or quote) and its pieces with the marker removed.
function lineInfo(line) {
  const first = typeof line[0] === 'string' ? line[0] : '';
  const m = first.match(LIST_RE) || first.match(QUOTE_RE);
  const kind = !m ? 'p' : first[0] === '*' ? 'li' : 'quote';
  const cut = m ? m[0].length : 0;
  const pieces = [];
  line.forEach((s, i) => {
    if (typeof s !== 'string') pieces.push(s);
    else {
      const text = i === 0 ? s.slice(cut) : s;
      if (text) pieces.push(text);
    }
  });
  const text = pieces.map(p => typeof p === 'string' ? p : p.t).join('');
  const rawLen = line.reduce((n, s) => n + (typeof s === 'string' ? s.length : s.t.length), 0);
  return { kind, cut, pieces, text, rawLen };
}

// Sentences ending in "?" — the open questions.
const QUESTION_RE = /[^.!?\n]*\?+["”’)\]]*/g;
function questionRanges(text) {
  const out = [];
  for (const m of text.matchAll(QUESTION_RE)) {
    const start = m.index + m[0].match(/^\s*/)[0].length;
    const end = m.index + m[0].length;
    if (/[\p{L}\p{N}]/u.test(text.slice(start, end))) out.push({ start, end });
  }
  return out;
}

function questionsOf(p) {
  const out = [];
  for (const line of splitLines(p.body)) {
    const { text } = lineInfo(line);
    for (const r of questionRanges(text)) out.push(text.slice(r.start, r.end));
  }
  return out;
}

function renderReadBody(el, segs) {
  el.textContent = '';
  let offset = 0;
  let group = null;
  let qCount = 0;
  for (const line of splitLines(segs)) {
    const { kind, cut, pieces, text, rawLen } = lineInfo(line);
    const lineEl = h(kind === 'li' ? 'li' : 'div', { class: 'line', 'data-start': offset + cut });

    // Wrap question sentences in a span; links inside them stay links.
    const ranges = questionRanges(text);
    const rangeAt = p => ranges.find(r => p >= r.start && p < r.end);
    let holder = null, holderRange = null;
    const place = (node, at) => {
      const r = rangeAt(at);
      if (!r) { holder = holderRange = null; lineEl.append(node); return; }
      if (r !== holderRange) {
        holderRange = r;
        holder = h('span', { class: 'question', 'data-q': qCount + ranges.indexOf(r) });
        lineEl.append(holder);
      }
      holder.append(node);
    };
    let pos = 0;
    for (const piece of pieces) {
      if (typeof piece !== 'string') {
        place(linkEl(piece), pos);
        pos += piece.t.length;
        continue;
      }
      const cuts = new Set([0, piece.length]);
      for (const r of ranges) {
        for (const b of [r.start, r.end]) if (b > pos && b < pos + piece.length) cuts.add(b - pos);
      }
      const marks = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i < marks.length - 1; i++) {
        place(document.createTextNode(piece.slice(marks[i], marks[i + 1])), pos + marks[i]);
      }
      pos += piece.length;
    }
    qCount += ranges.length;

    if (!lineEl.childNodes.length) lineEl.append(h('br'));
    if (kind === 'p') { group = null; el.append(lineEl); }
    else {
      const tag = kind === 'li' ? 'ul' : 'blockquote';
      if (!group || group.tagName.toLowerCase() !== tag) { group = h(tag); el.append(group); }
      group.append(lineEl);
    }
    offset += rawLen + 1;
  }
}

// Offset in the raw notes of a caret position inside the reading view.
function rawOffsetFromReadRange(bodyEl, range) {
  let n = range.startContainer;
  while (n && n !== bodyEl && !(n.nodeType === 1 && n.dataset.start != null)) n = n.parentNode;
  if (!n || n === bodyEl) return null;
  const r = document.createRange();
  r.setStart(n, 0);
  r.setEnd(range.startContainer, range.startOffset);
  return Number(n.dataset.start) + r.toString().length;
}

/* ---------------------------------------------------------------- long press */

let suppressClick = false;

function attachLongPress(el, onLong) {
  let timer = null, sx = 0, sy = 0, armed = false, active = false;
  const disarm = () => { clearTimeout(timer); armed = false; active = false; el.classList.remove('armed'); };

  el.addEventListener('pointerdown', e => {
    if (editing) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.page-menu')) return;
    active = true; armed = false;
    sx = e.clientX; sy = e.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => {
      armed = true;
      el.classList.add('armed');
      if (navigator.vibrate) navigator.vibrate(12);
    }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', e => {
    if (active && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) disarm();
  });
  let pending = null;
  const fire = target => {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 450);
    onLong(sx, sy, target);
  };
  const release = e => {
    if (!active) return;
    const wasArmed = armed;
    disarm();
    if (!wasArmed) return;
    // For touch, wait for touchend: it counts as a user gesture on iOS (so the
    // keyboard opens) and lets us cancel the emulated click on the new layout.
    if (e.pointerType === 'touch' && e.type === 'pointerup') pending = e.target;
    else fire(e.target);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('touchend', e => {
    if (!pending) return;
    const target = pending;
    pending = null;
    e.preventDefault();
    fire(target);
  }, { passive: false });
  el.addEventListener('contextmenu', e => { if (!editing) e.preventDefault(); });
}

function caretRangeAt(x, y) {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    r.collapse(true);
    return r;
  }
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  return null;
}

/* ---------------------------------------------------------------- editing */

// While editing, the notes are a plain <textarea>. Links are written as @text@
// — ordinary characters — so phone keyboards always know what's in the box.
// The page each link points to is remembered from when editing began; new or
// changed links are matched by page name.

const LINK_RE = /(?<![\p{L}\p{N}])@([^@\s](?:[^@\n]{0,78}[^@\s])?)@(?![\p{L}\p{N}])/gu;
const MENTION_RE = /(?:^|\s)@([^\n@.,;:!?()[\]{}"“”]{0,40})$/;
const EDIT_PLACEHOLDER = 'Write your notes… @ links a page, * starts a list, > a quote';

let editing = null; // { ctl, page, ta, links: [{ t, l }] }

const cleanLinkText = t => t.replace(/@/g, '').trim();
const normName = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function toEditText(segs) {
  return segs.map(s => typeof s === 'string' ? s : '@' + cleanLinkText(s.t) + '@').join('');
}

// Position in the edit text for a position in the plain notes text.
function editOffset(segs, off) {
  let plain = 0, edit = 0;
  for (const s of segs) {
    if (typeof s === 'string') {
      if (off <= plain + s.length) return edit + off - plain;
      plain += s.length;
      edit += s.length;
    } else {
      const t = cleanLinkText(s.t);
      if (off < plain + t.length) return edit + 1 + off - plain;
      if (off === plain + t.length) return edit + t.length + 2;
      plain += t.length;
      edit += t.length + 2;
    }
  }
  return edit;
}

function createStub(title) {
  const p = {
    id: uid(), title, aka: [], typeId: null, tags: [], body: [],
    created: Date.now(), updated: Date.now()
  };
  db.pages[p.id] = p;
  persistSoon();
  return p;
}

function linkMatches(text) {
  return [...text.matchAll(LINK_RE)].map(m => ({ start: m.index, end: m.index + m[0].length, t: m[1] }));
}

// Turn edit text back into notes segments.
function fromEditText(text, known, { create = false } = {}) {
  const used = new Set();
  const segs = [];
  const pushText = t => {
    if (!t) return;
    if (typeof segs[segs.length - 1] === 'string') segs[segs.length - 1] += t;
    else segs.push(t);
  };
  const resolve = (t, k) => {
    const take = i => { used.add(i); return known[i].l; };
    let i = known.findIndex((x, j) => !used.has(j) && x.t === t);
    if (i >= 0) return take(i);
    i = known.findIndex((x, j) => !used.has(j) && normName(x.t) === normName(t));
    if (i >= 0) return take(i);
    const byName = activePages().find(p => namesOf(p).some(n => normName(n) === normName(t)));
    if (byName) return byName.id;
    if (k < known.length && !used.has(k) && normName(known[k].t).slice(0, 3) === normName(t).slice(0, 3)) return take(k);
    return create ? createStub(t).id : null;
  };
  let last = 0;
  linkMatches(text).forEach((m, k) => {
    pushText(text.slice(last, m.start));
    const id = resolve(m.t, k);
    if (id) segs.push({ l: id, t: m.t });
    else pushText(text.slice(m.start, m.end));
    last = m.end;
  });
  pushText(text.slice(last));
  return segs;
}

function startEdit(ctl, { focus = 'body', x, y, target } = {}) {
  if (editing || ctl.page.archived) return;
  const { bodyEl, article, page } = ctl;

  // Work out where the caret should go before anything changes.
  let caret = null;
  if (focus === 'body' && x != null) {
    let range = null;
    const linkHit = target && target.closest && target.closest('.link');
    if (linkHit && bodyEl.contains(linkHit)) {
      range = document.createRange();
      range.setStartAfter(linkHit);
      range.collapse(true);
    } else {
      const r = caretRangeAt(x, y);
      if (r && bodyEl.contains(r.startContainer)) range = r;
    }
    const off = range ? rawOffsetFromReadRange(bodyEl, range) : null;
    if (off != null) caret = editOffset(page.body, off);
  }

  const ta = h('textarea', {
    class: 'body body-edit',
    placeholder: EDIT_PLACEHOLDER,
    spellcheck: 'true',
    autocapitalize: 'sentences',
    rows: '4',
    'aria-label': 'Notes'
  });
  ta.value = toEditText(page.body);
  wireTextarea(ta);

  const topBefore = bodyEl.getBoundingClientRect().top;
  editing = {
    ctl, page, ta,
    links: page.body.filter(s => typeof s !== 'string').map(s => ({ t: cleanLinkText(s.t), l: s.l }))
  };
  article.classList.add('editing');
  document.body.classList.add('editing');
  bodyEl.replaceWith(ta);
  autoGrow();
  ctl.drawHead();
  showEditbar();
  startSelectionWatch();
  // Keep the text under the finger even though the header grew.
  if (focus === 'body' && x != null) window.scrollBy(0, ta.getBoundingClientRect().top - topBefore);

  if (focus === 'body') {
    ta.focus({ preventScroll: true });
    const at = caret != null ? caret : ta.value.length;
    ta.setSelectionRange(at, at);
    scrollCaretIntoView();
  } else {
    const input = article.querySelector(`[data-f="${focus}"] input, [data-f="${focus}"] select`);
    if (input) {
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: 'center' });
    }
  }
}

function finishEdit({ rerender = true } = {}) {
  if (!editing) return;
  const { ctl, page, ta, links } = editing;
  // Commit any half-typed tag or name
  ctl.article.querySelectorAll('.chip-input').forEach(c => c.commit && c.commit());
  clearTimeout(saveTimer);
  page.body = fromEditText(ta.value.replace(/\s+$/, ''), links, { create: true });
  page.title = page.title.trim();
  editing = null;
  stopSelectionWatch();
  closeSuggest();
  hideEditbar();
  document.body.classList.remove('editing');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  ta.replaceWith(ctl.bodyEl);

  const empty = !page.title && !page.body.length && !page.tags.length && !page.aka.length;
  if (page.fresh && empty && !backlinks(page.id).length) {
    delete db.pages[page.id];
    persistNow();
    if (rerender) navigate('', { replace: true });
    return;
  }
  delete page.fresh;
  page.updated = Date.now();
  persistNow();
  if (rerender) render();
}

function focusBodyEnd() {
  if (!editing) return;
  const ta = editing.ta;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);
  scrollCaretIntoView();
}

function autoGrow() {
  if (!editing) return;
  const ta = editing.ta;
  const y = window.scrollY;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  if (window.scrollY !== y) window.scrollTo(0, y);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!editing) return;
    editing.page.body = fromEditText(editing.ta.value, editing.links);
    touch(editing.page);
  }, 400);
}

// Replace part of the text the way typing would, so the keyboard stays in step.
function replaceText(start, end, text, caretAt) {
  const ta = editing.ta;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  let ok = false;
  try {
    ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
  } catch (e) { ok = false; }
  if (!ok || ta.value.slice(start, start + text.length) !== text) {
    if (ta.value.slice(start, start + text.length) !== text) ta.setRangeText(text, start, end, 'end');
    textChanged();
  }
  if (caretAt != null) ta.setSelectionRange(caretAt, caretAt);
  updateSuggestions();
}

function textChanged() {
  autoGrow();
  scheduleSave();
  updateSuggestions();
  scrollCaretIntoView();
}

// Enter on a list or quote line starts the next line with the same marker;
// Enter on an empty list or quote line ends the list instead.
function newLine() {
  const ta = editing.ta;
  const pos = ta.selectionStart, end = ta.selectionEnd;
  const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
  const line = ta.value.slice(lineStart, pos);
  const m = line.match(LIST_RE) || line.match(QUOTE_RE);
  if (!m) return replaceText(pos, end, '\n');
  if (!line.slice(m[0].length).trim() && pos === end) return replaceText(lineStart, pos, '');
  replaceText(pos, end, '\n' + (line[0] === '*' ? '* ' : '> '));
}

function wireTextarea(ta) {
  ta.addEventListener('input', textChanged);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
      e.preventDefault();
      newLine();
    } else if (e.key === 'Escape') {
      if (!suggestEl.hidden) closeSuggest(); else finishEdit();
    }
  });
  ta.addEventListener('beforeinput', e => {
    if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && e.cancelable) {
      e.preventDefault();
      newLine();
    }
  });
  for (const ev of ['select', 'keyup', 'pointerup', 'focus']) ta.addEventListener(ev, () => updateSuggestions());
}

document.addEventListener('selectionchange', () => {
  if (editing && document.activeElement === editing.ta) updateSuggestions();
});

// Some phones don't report selection changes inside text boxes, so also check
// a few times a second while editing.
let selWatch = null, selSeen = '';
function startSelectionWatch() {
  stopSelectionWatch();
  selWatch = setInterval(() => {
    if (!editing || document.activeElement !== editing.ta) return;
    const key = editing.ta.selectionStart + ':' + editing.ta.selectionEnd;
    if (key !== selSeen) { selSeen = key; updateSuggestions(); }
  }, 250);
}
function stopSelectionWatch() {
  clearInterval(selWatch);
  selWatch = null;
  selSeen = '';
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (editing) editing.page.body = fromEditText(editing.ta.value, editing.links);
  persistNow();
});

// Where the caret sits on screen, measured with an invisible copy of the text.
function caretTop(ta) {
  const mirror = h('div', { class: 'body caret-mirror', 'aria-hidden': 'true' });
  mirror.style.width = ta.clientWidth + 'px';
  mirror.textContent = ta.value.slice(0, ta.selectionEnd);
  const mark = h('span', { text: '|' });
  mirror.append(mark);
  document.body.append(mirror);
  const top = mark.offsetTop;
  const height = mark.offsetHeight;
  mirror.remove();
  return { top: ta.getBoundingClientRect().top + top, height };
}

function scrollCaretIntoView() {
  requestAnimationFrame(() => {
    if (!editing || document.activeElement !== editing.ta) return;
    const { top, height } = caretTop(editing.ta);
    const vv = window.visualViewport;
    const viewTop = vv ? vv.offsetTop : 0;
    const viewBottom = viewTop + (vv ? vv.height : innerHeight) - editbar.offsetHeight - 12;
    if (top + height > viewBottom) window.scrollBy(0, top + height - viewBottom);
    else if (top < viewTop + 12) window.scrollBy(0, top - viewTop - 12);
  });
}

/* ---------------------------------------------------------------- edit bar */

function positionEditbar() {
  if (editbar.hidden) return;
  const vv = window.visualViewport;
  const bottom = vv ? vv.offsetTop + vv.height : innerHeight;
  editbar.style.transform = `translateY(${bottom - editbar.offsetHeight}px)`;
}
function showEditbar() {
  editbar.hidden = false;
  positionEditbar();
}
function hideEditbar() {
  editbar.hidden = true;
  chipSlot.textContent = '';
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', positionEditbar);
  visualViewport.addEventListener('scroll', positionEditbar);
}
window.addEventListener('resize', positionEditbar);

// Keep the text box focused (and the keyboard up) when tapping the bar's buttons.
editbar.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });

document.getElementById('done-btn').addEventListener('click', () => finishEdit());
document.getElementById('at-btn').addEventListener('click', () => {
  if (!editing) return;
  const ta = editing.ta;
  const pos = ta.selectionStart;
  const prev = ta.value.slice(pos - 1, pos);
  replaceText(pos, ta.selectionEnd, prev && !/\s/.test(prev) ? ' @' : '@');
});

/* ---------------------------------------------------------------- @ mentions and link chip */

const insideLink = pos => linkMatches(editing.ta.value).some(m => pos > m.start && pos < m.end);

function updateSuggestions() {
  if (!editing) return;
  if (selPicker && suggestEl.contains(document.activeElement)) return;
  const ta = editing.ta;
  if (document.activeElement !== ta) return;
  const { selectionStart: s, selectionEnd: e } = ta;

  if (s !== e) {
    const selected = selectedText();
    if (selected) {
      // Keep an open picker while the same text stays selected.
      if (selPicker && selPicker.start === selected.start && selPicker.end === selected.end) return;
      closeSuggest();
      showSelectionChip(selected);
    } else {
      closeSuggest();
      showChip(null);
    }
    return;
  }
  if (insideLink(s)) { closeSuggest(); showChip(null); return; }
  const before = ta.value.slice(0, s);
  const m = before.match(MENTION_RE);
  if (m) {
    showChip(null);
    openMentionMenu(m[1]);
    return;
  }
  closeSuggest();
  showChip(findChipMatch(before));
}

function pageButton(p, name, onPick) {
  const tn = typeName(p.typeId);
  const sub = name !== p.title ? 'also known as — ' + displayTitle(p) : tn;
  return h('button', { onclick: onPick },
    h('div', { class: 't', text: name }), sub && h('div', { class: 'sub', text: sub }));
}

// Replace "@query" before the caret with a finished @link@.
function finishMention(p, name) {
  const ta = editing.ta;
  const pos = ta.selectionStart;
  const m = ta.value.slice(0, pos).match(MENTION_RE);
  if (!m) return;
  const at = pos - m[1].length - 1;
  const spaceAfter = /^\s/.test(ta.value.slice(pos, pos + 1));
  const text = '@' + name + '@' + (spaceAfter ? '' : ' ');
  editing.links.push({ t: name, l: p.id });
  replaceText(at, pos, text, at + text.length + (spaceAfter ? 1 : 0));
}

function openMentionMenu(query) {
  const q = query.trim().toLowerCase();
  const matches = matchPages(q);
  suggestEl.textContent = '';
  for (const { p, name } of matches) {
    suggestEl.append(pageButton(p, name, () => finishMention(p, name)));
  }
  const typed = query.trim();
  if (typed && !matches.some(mt => mt.name.toLowerCase() === q)) {
    suggestEl.append(h('button', {
      class: 'create',
      onclick: () => {
        const p = createStub(typed);
        finishMention(p, typed);
        toast(`Created page “${typed}”`);
      }
    }, h('div', { class: 't', text: `＋ Create page “${typed}”` })));
  }
  if (!suggestEl.childElementCount) {
    suggestEl.append(h('div', { class: 'sub', style: 'padding:10px 14px', text: 'Type a name to link or create a page' }));
  }
  suggestEl.hidden = false;
  positionEditbar();
}

function matchPages(q) {
  const self = editing.page.id;
  let matches = [];
  if (!q) {
    matches = activePages().filter(p => p.id !== self && p.title)
      .sort((a, b) => b.updated - a.updated).slice(0, 6)
      .map(p => ({ p, name: p.title }));
  } else {
    for (const p of activePages()) {
      if (p.id === self) continue;
      let best = null;
      for (const name of namesOf(p)) {
        const n = name.toLowerCase();
        let s = null;
        if (n === q) s = 0;
        else if (n.startsWith(q)) s = 1;
        else if (n.split(/\s+/).some(w => w.startsWith(q))) s = 2;
        else if (n.includes(q)) s = 3;
        if (s != null && (!best || s < best.s || (s === best.s && name === p.title))) best = { s, name };
      }
      if (best) matches.push({ p, name: best.name, s: best.s });
    }
    matches.sort((a, b) => a.s - b.s || collator.compare(a.name, b.name));
    matches = matches.slice(0, 6);
  }
  return matches;
}

function closeSuggest() {
  selPicker = null;
  if (suggestEl.hidden) return;
  suggestEl.hidden = true;
  suggestEl.textContent = '';
  positionEditbar();
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const PHRASE_RE = /^[\p{L}\p{N}'’-]+(?: [\p{L}\p{N}'’-]+)*$/u;
const words = s => (s.match(WORD_RE) || []).map(w => w.toLowerCase());

// Look at the last few words typed and see if they name (all or part of) an existing page.
function findChipMatch(text) {
  const line = text.slice(text.lastIndexOf('\n') + 1);
  const lineStart = text.length - line.length;
  const found = [...line.matchAll(WORD_RE)];
  if (!found.length) return null;
  const lastWord = found[found.length - 1];
  const tail = line.slice(lastWord.index + lastWord[0].length);
  if (!/^[\s,.;:!?)"”’]?$/.test(tail)) return null;

  const self = editing.page.id;
  const index = [];
  for (const p of activePages()) {
    if (p.id === self) continue;
    for (const name of namesOf(p)) index.push({ p, name, w: words(name) });
  }
  if (!index.length) return null;

  for (let k = Math.min(6, found.length); k >= 1; k--) {
    const seq = found.slice(-k).map(m => m[0].toLowerCase());
    if (!seq.some(w => w.length >= 4)) continue;
    // The words must be separated by plain spaces to count as one phrase.
    const startIdx = found[found.length - k].index;
    const endIdx = lastWord.index + lastWord[0].length;
    if (!PHRASE_RE.test(line.slice(startIdx, endIdx))) continue;
    // Don't offer to link words that are already part of a link.
    const start = lineStart + startIdx;
    if (line.slice(0, startIdx).match(/@/g)?.length % 2 === 1) continue;
    let best = null;
    for (const entry of index) {
      const w = entry.w;
      for (let i = 0; i + k <= w.length; i++) {
        let ok = true;
        for (let j = 0; j < k; j++) if (w[i + j] !== seq[j]) { ok = false; break; }
        if (ok) {
          const exact = w.length === k;
          const score = (exact ? 0 : 1) * 1000 + w.length;
          if (!best || score < best.score) best = { ...entry, score };
          break;
        }
      }
    }
    if (best) {
      return { p: best.p, name: best.name, text: line.slice(startIdx, endIdx), start, end: lineStart + endIdx };
    }
  }
  return null;
}

function showChip(match) {
  chipSlot.textContent = '';
  if (!match) return;
  chipSlot.append(h('button', {
    class: 'link-chip',
    onclick: () => {
      const ta = editing.ta;
      const pos = ta.selectionStart;
      const m = findChipMatch(ta.value.slice(0, pos));
      if (!m) return;
      editing.links.push({ t: m.text, l: m.p.id });
      // Caret goes back where it was, shifted by the two @ marks.
      replaceText(m.start, m.end, '@' + m.text + '@', pos + 2);
      chipSlot.textContent = '';
    }
  }, 'Link to ', h('b', { text: displayTitle(match.p) }), '?'));
}

/* ---------------------------------------------------------------- linking selected text */

let selPicker = null; // { start, end, text } while the page picker is open for a selection

function selectedText() {
  const ta = editing.ta;
  const { selectionStart: start, selectionEnd: end } = ta;
  const text = ta.value.slice(start, end);
  if (!text.trim() || text.includes('\n') || text.includes('@') || text.length > 80) return null;
  if (linkMatches(ta.value).some(m => start < m.end && end > m.start)) return null;
  return { start, end, text };
}

function showSelectionChip(selected) {
  chipSlot.textContent = '';
  chipSlot.append(h('button', {
    class: 'link-chip',
    onclick: () => openSelectionPicker(selected)
  }, '🔗 Link ', h('b', { text: '“' + selected.text.trim() + '”' })));
}

function openSelectionPicker(selected) {
  const core = selected.text.trim();
  const search = h('input', {
    class: 'suggest-search', value: core, placeholder: 'Search pages…',
    'aria-label': 'Search pages', autocomplete: 'off', enterkeyhint: 'search'
  });
  search.value = core;
  const list = h('div');
  const draw = () => {
    const q = search.value.trim();
    const matches = matchPages(q.toLowerCase());
    list.textContent = '';
    for (const { p, name } of matches) list.append(pageButton(p, name, () => linkSelection(selected, p.id)));
    if (q && !matches.some(m => m.name.toLowerCase() === q.toLowerCase())) {
      list.append(h('button', {
        class: 'create',
        onclick: () => {
          const p = createStub(q);
          linkSelection(selected, p.id);
          toast(`Created page “${q}”`);
        }
      }, h('div', { class: 't', text: `＋ Create page “${q}”` })));
    }
    positionEditbar();
  };
  search.addEventListener('input', draw);
  chipSlot.textContent = '';
  suggestEl.textContent = '';
  suggestEl.append(search, list);
  suggestEl.hidden = false;
  selPicker = selected;
  draw();
}

// Wrap the selected words in @…@, leaving any spaces around them outside.
function linkSelection(selected, pageId) {
  const lead = selected.text.match(/^\s*/)[0].length;
  const trail = selected.text.match(/\s*$/)[0].length;
  const core = selected.text.trim();
  const start = selected.start + lead;
  const end = selected.end - trail;
  editing.links.push({ t: core, l: pageId });
  selPicker = null;
  closeSuggest();
  chipSlot.textContent = '';
  replaceText(start, end, '@' + core + '@', end + 2);
}

/* ---------------------------------------------------------------- settings */

function renderSettings() {
  view.append(topbar('Settings'));

  // Types
  const typesPanel = h('div', { class: 'panel leaf' });
  const drawTypes = () => {
    typesPanel.textContent = '';
    const counts = {};
    for (const p of activePages()) counts[p.typeId] = (counts[p.typeId] || 0) + 1;
    db.types.forEach((t, i) => {
      const name = h('input', { value: t.name, 'aria-label': 'Type name', enterkeyhint: 'done' });
      name.value = t.name;
      name.addEventListener('change', () => {
        const v = name.value.trim();
        if (v) { t.name = v; persistNow(); } else name.value = t.name;
      });
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
      typesPanel.append(h('div', { class: 'type-row' },
        name,
        h('span', { class: 'n', text: counts[t.id] || '' }),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0,
          onclick: () => { db.types.splice(i - 1, 0, db.types.splice(i, 1)[0]); persistNow(); drawTypes(); }
        }, svgIcon(ICON.up)),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Move down', disabled: i === db.types.length - 1,
          onclick: () => { db.types.splice(i + 1, 0, db.types.splice(i, 1)[0]); persistNow(); drawTypes(); }
        }, svgIcon(ICON.down)),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Remove type',
          onclick: () => {
            const n = allPages().filter(p => p.typeId === t.id).length;
            sheet({
              title: `Remove “${t.name}”?`,
              message: n ? `${n} page${n === 1 ? '' : 's'} will become untyped. No pages are deleted.` : 'No pages use this type.',
              actions: [{
                label: 'Remove type', style: 'danger',
                run: () => {
                  for (const p of allPages()) if (p.typeId === t.id) p.typeId = null;
                  db.types = db.types.filter(x => x.id !== t.id);
                  persistNow();
                  drawTypes();
                }
              }]
            });
          }
        }, svgIcon(ICON.x))
      ));
    });
    const add = h('input', { placeholder: 'New type…', enterkeyhint: 'done', autocapitalize: 'words' });
    const doAdd = () => {
      const v = add.value.trim();
      if (!v) return;
      db.types.push({ id: uid(), name: v });
      persistNow();
      drawTypes();
    };
    add.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    typesPanel.append(h('div', { class: 'add-row' }, add, h('button', { class: 'btn', onclick: doAdd }, 'Add')));
  };
  drawTypes();

  // Archive
  const archived = allPages().filter(p => p.archived).length;
  const archivePanel = h('div', { class: 'panel leaf' },
    h('p', { text: archived ? `${archived} page${archived === 1 ? '' : 's'} in the archive.` : 'The archive is empty.' }),
    h('button', { class: 'btn', onclick: () => navigate('archive') }, 'Open archive')
  );

  // Backup
  const last = db.meta.lastExport;
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', () => importBackup(fileInput.files[0]));
  const backupPanel = h('div', { class: 'panel leaf' },
    h('p', { text: 'Your notes live only on this phone. Save a backup file now and then — somewhere safe like Files or your cloud drive. Import adds pages from a Lore Codex file, or replaces everything with it.' }),
    h('p', { class: 'sub', text: last ? `Last backup: ${new Date(last).toLocaleDateString()}` : 'No backup made yet.' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn gilt', onclick: exportBackup }, 'Save backup'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import from file')
    ),
    fileInput
  );

  const pageCount = activePages().length;
  view.append(
    h('div', { class: 'section-label', text: 'Page types' }), typesPanel,
    h('div', { class: 'section-label', text: 'Archive' }), archivePanel,
    h('div', { class: 'section-label', text: 'Backup' }), backupPanel,
    h('p', { class: 'fine', text: `${pageCount} page${pageCount === 1 ? '' : 's'} in your codex · stored on this device only` }),
    h('p', { class: 'fine version', text: `Lore Codex · version ${APP_VERSION}` })
  );
}

async function exportBackup() {
  const data = JSON.stringify({ app: 'lore-codex', exportedAt: new Date().toISOString(), data: db }, null, 1);
  const name = `lore-codex-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([data], name, { type: 'application/json' });
  const done = () => { db.meta.lastExport = Date.now(); persistNow(); render(); toast('Backup saved'); };
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Lore Codex backup' });
      done();
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  done();
}

async function importBackup(file) {
  if (!file) return;
  let incoming;
  try {
    const parsed = JSON.parse(await file.text());
    incoming = normalizeDb(parsed.data || parsed);
  } catch (e) {
    toast('That file is not a Lore Codex backup.');
    return;
  }
  const n = Object.keys(incoming.pages).length;
  const plural = `${n} page${n === 1 ? '' : 's'}`;
  sheet({
    title: 'Import this file?',
    message: `It holds ${plural}. Add them to your codex, or replace everything on this phone with the file.`,
    actions: [
      {
        label: `Add ${plural} to my codex`, style: 'gilt',
        run: () => { const added = mergeInto(incoming); persistNow(); render(); toast(`Imported ${added} page${added === 1 ? '' : 's'}`); }
      },
      {
        label: 'Replace everything', style: 'danger',
        run: () => { db = incoming; persistNow(); render(); toast('Backup restored'); }
      }
    ]
  });
}

// Add another codex's pages to this one. Types are matched by name; missing ones are created.
function mergeInto(incoming) {
  const typeMap = {};
  for (const t of incoming.types) {
    let mine = db.types.find(x => x.name.toLowerCase() === t.name.toLowerCase());
    if (!mine) { mine = { id: uid(), name: t.name }; db.types.push(mine); }
    typeMap[t.id] = mine.id;
  }
  const idMap = {};
  for (const id of Object.keys(incoming.pages)) idMap[id] = db.pages[id] ? uid() : id;
  let added = 0;
  for (const p of Object.values(incoming.pages)) {
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = idMap[p.id];
    copy.typeId = p.typeId ? typeMap[p.typeId] || null : null;
    for (const seg of copy.body) if (typeof seg !== 'string' && idMap[seg.l]) seg.l = idMap[seg.l];
    delete copy.fresh;
    db.pages[copy.id] = copy;
    added++;
  }
  return added;
}

/* ---------------------------------------------------------------- questions */

function renderQuestions() {
  const pages = activePages()
    .map(p => ({ p, qs: questionsOf(p) }))
    .filter(x => x.qs.length)
    .sort((a, b) => byTitle(a.p, b.p));
  const total = pages.reduce((n, x) => n + x.qs.length, 0);
  view.append(topbar('Open questions'));
  view.append(h('p', { class: 'questions-intro', text: total
    ? `${total} unanswered across ${pages.length} page${pages.length === 1 ? '' : 's'}. A question leaves this list once its sentence no longer ends in “?”.`
    : 'No open questions. Any sentence ending in “?” will appear here.' }));
  const list = h('div', { class: 'list' });
  for (const { p, qs } of pages) {
    list.append(h('section', { class: 'q-group leaf' },
      h('button', { class: 'q-page', onclick: () => navigate('page/' + p.id) }, displayTitle(p)),
      qs.map((q, i) => h('button', { class: 'q-item', onclick: () => navigate(`page/${p.id}/${i}`) }, q))
    ));
  }
  view.append(list);
}

/* ---------------------------------------------------------------- archive */

function renderArchive() {
  const pages = allPages().filter(p => p.archived).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  const list = h('div', { class: 'list' });
  for (const p of pages) {
    list.append(h('div', { class: 'item leaf', onclick: () => navigate('page/' + p.id) },
      h('div', { class: 'item-row' },
        h('span', { class: 't', text: displayTitle(p) }),
        h('button', {
          class: 'btn',
          onclick: e => { e.stopPropagation(); restorePage(p, { open: false }); }
        }, 'Restore')
      ),
      p.archivedAt && h('div', { class: 'sub', text: 'Archived ' + new Date(p.archivedAt).toLocaleDateString() })
    ));
  }
  if (!pages.length) list.append(h('p', { class: 'empty-note', text: 'Nothing rests in the archive.' }));
  view.append(topbar('Archive'), list);
}

/* ---------------------------------------------------------------- boot */

if (!location.hash) history.replaceState('root', '', '#/');
else history.replaceState('root', '', location.hash);
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
}
