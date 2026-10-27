'use strict';

/* =====================================================================
   Lernplaner – Klausuren planen, Stoff aufteilen, Fortschritt verfolgen.
   Daten: localStorage (sofort) + privates GitHub-Repo (Sync).
   PDFs:  IndexedDB (lokaler Cache) + files/<klausur>/<id>.pdf im Repo.
   ===================================================================== */

/* ---------- Kleine Helfer ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sum = arr => arr.reduce((s, x) => s + x, 0);
const norm = s => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#84cc16', '#f97316'];
const DIFF = ['', 'sehr leicht', 'leicht', 'mittel', 'schwer', 'sehr schwer'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  file: 'M14 3H6v18h12V7zM14 3v4h4',
  text: 'M5 6h14M5 10h14M5 14h10M5 18h7',
  wand: 'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 15l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};
const ic = name => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;

/* ---------- Datum (immer lokale Tage als "YYYY-MM-DD") ---------- */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const diffDays = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 864e5);
const maxISO = (a, b) => (a > b ? a : b);
function rangeDays(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
const fmtShort = iso => { const d = fromISO(iso); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
const fmtLong = iso => fromISO(iso).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function relDay(iso) {
  const n = diffDays(todayISO(), iso);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === 2) return 'übermorgen';
  if (n === -1) return 'gestern';
  return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
}
function fmtPct(x, digits) {
  const d = digits ?? (x > 0 && x < 10 && Math.round(x) !== x ? 1 : 0);
  return x.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 }) + ' %';
}
const fmtSize = b => b > 1048576 ? `${(b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/* ---------- Speicher ---------- */
const LS = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const DATA_KEY = 'lernplaner.data';
const CFG_KEY = 'lernplaner.cfg';
const UI_KEY = 'lernplaner.ui';
const DATA_PATH = 'data.json';

const emptyState = () => ({ version: 1, exams: [], deleted: {} });
function normalizeState(s) {
  s = s && typeof s === 'object' ? s : emptyState();
  s.version = 1;
  s.exams = Array.isArray(s.exams) ? s.exams : [];
  s.deleted = s.deleted && typeof s.deleted === 'object' ? s.deleted : {};
  s.exams.forEach(normalizeExam);
  return s;
}
function normalizeExam(ex) {
  ex.topics = Array.isArray(ex.topics) ? ex.topics : [];
  ex.materials = Array.isArray(ex.materials) ? ex.materials : [];
  ex.color = ex.color || COLORS[0];
  ex.startDate = ex.startDate || todayISO();
  ex.topics.forEach(t => {
    t.days = Array.isArray(t.days) ? t.days : [];
    t.doneDays = Array.isArray(t.doneDays) ? t.doneDays : [];
    t.difficulty = Math.min(5, Math.max(1, +t.difficulty || 3));
    t.understood = !!t.understood;
  });
  return ex;
}

let state = normalizeState(LS.get(DATA_KEY));
let cfg = Object.assign({ owner: '', repo: '', token: '', branch: '' }, LS.get(CFG_KEY) || {});
const ui = Object.assign({ calMonth: todayISO().slice(0, 7), calSel: todayISO(), pastOpen: false }, LS.get(UI_KEY) || {});
ui.calSel = todayISO();

function save() {
  if (!LS.set(DATA_KEY, state)) toast('Lokaler Speicher ist voll – bitte große Texte kürzen.', 'error');
}
const saveUi = () => LS.set(UI_KEY, { calMonth: ui.calMonth, pastOpen: ui.pastOpen });
const touch = ex => { ex.updatedAt = Date.now(); };
function commit(ex) {
  if (ex) touch(ex);
  save();
  safeRender();
  scheduleSync();
}

/* IndexedDB für PDF-Dateien (Fallback: Speicher im RAM) */
const files = (() => {
  const mem = new Map();
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('lernplaner', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('files', mode);
      const req = fn(t.objectStore('files'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    async get(k) { try { return (await tx('readonly', s => s.get(k))) || mem.get(k) || null; } catch { return mem.get(k) || null; } },
    async set(k, v) { mem.set(k, v); try { await tx('readwrite', s => s.put(v, k)); mem.delete(k); } catch { /* bleibt im RAM */ } },
    async del(k) { mem.delete(k); try { await tx('readwrite', s => s.delete(k)); } catch { /* egal */ } },
  };
})();

/* ---------- Berechnungen ---------- */
const examById = id => state.exams.find(e => e.id === id);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const weightSum = ex => sum(ex.topics.map(t => t.difficulty));
const share = (ex, t) => { const W = weightSum(ex); return W ? (t.difficulty / W) * 100 : 0; };
function progress(ex) {
  const W = weightSum(ex);
  return W ? (sum(ex.topics.filter(t => t.understood).map(t => t.difficulty)) / W) * 100 : 0;
}
function planDays(ex) {
  const end = addDays(ex.date, -1);
  return ex.startDate <= end ? rangeDays(ex.startDate, end) : [];
}
const newTopic = (title, difficulty = 3) => ({ id: uid(), title, difficulty, days: [], doneDays: [], understood: false });

function tasksForDay(day) {
  const out = [];
  for (const ex of [...state.exams].sort(byDate)) {
    if (ex.date < day) continue;
    for (const t of ex.topics) if (t.days.includes(day)) out.push({ ex, t });
  }
  return out;
}
const reviewsForDay = day => state.exams.filter(ex => ex.reviewDay === day && ex.date > day);
const examsOnDay = day => state.exams.filter(ex => ex.date === day);
function overdue() {
  const today = todayISO();
  const out = [];
  for (const ex of [...state.exams].sort(byDate)) {
    if (ex.date < today) continue;
    for (const t of ex.topics) {
      if (t.understood) continue;
      const missed = t.days.filter(d => d < today && !t.doneDays.includes(d));
      if (missed.length) out.push({ ex, t, missed });
    }
  }
  return out;
}

/* Verteilt alle noch nicht verstandenen Themen auf die Tage [from, end].
   Schwere Themen bekommen mehr Tage; der letzte Tag wird – wenn genug
   Zeit ist – als Wiederholungstag freigehalten. */
function distribute(ex, from, end) {
  const days = rangeDays(from, end);
  const topics = ex.topics.filter(t => !t.understood);
  for (const t of topics) {
    t.days = t.days.filter(d => d < from);
    t.doneDays = t.doneDays.filter(d => t.days.includes(d));
  }
  ex.reviewDay = null;
  if (days.length >= topics.length + 1 && days.length >= 3) ex.reviewDay = days.pop();

  const D = days.length, N = topics.length, W = sum(topics.map(t => t.difficulty));
  if (D >= N) {
    // Jedes Thema mindestens 1 Tag, Rest proportional zur Schwierigkeit (größter Rest).
    const R = D - N;
    const raw = topics.map(t => (R * t.difficulty) / W);
    const counts = raw.map(x => 1 + Math.floor(x));
    let left = D - sum(counts);
    raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i]++; left--; } });
    let i = 0;
    topics.forEach((t, k) => { t.days.push(...days.slice(i, i + counts[k])); i += counts[k]; });
  } else {
    // Weniger Tage als Themen: mehrere Themen pro Tag, Last gleichmäßig verteilt.
    let pos = 0;
    topics.forEach(t => {
      const mid = pos + t.difficulty / 2;
      pos += t.difficulty;
      t.days.push(days[Math.min(D - 1, Math.floor((mid / W) * D))]);
    });
  }
  topics.forEach(t => { t.days = [...new Set(t.days)].sort(); });
  return { days: D, review: !!ex.reviewDay };
}

/* ---------- Rendering ---------- */
const app = $('#app');
let renderPending = false;

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'klausur' && parts[1]) return { view: 'exam', id: decodeURIComponent(parts[1]), tab: '' };
  if (parts[0] === 'kalender') return { view: 'cal', tab: 'cal' };
  return { view: 'home', tab: 'home' };
}

function render() {
  renderPending = false;
  const route = parseRoute();
  $$('[data-tab]').forEach(a => a.classList.toggle('active', a.dataset.tab === route.tab));
  if (route.view === 'exam') {
    const ex = examById(route.id);
    app.innerHTML = ex ? viewExam(ex) : `<a href="#/" class="back">${ic('left')} Übersicht</a><div class="card empty"><h1>Nicht gefunden</h1><p class="muted">Diese Klausur gibt es nicht (mehr).</p></div>`;
  } else if (route.view === 'cal') {
    app.innerHTML = viewCalendar();
  } else {
    app.innerHTML = viewHome();
  }
  renderSync();
}

// Nicht neu zeichnen, während jemand in ein Textfeld tippt.
function safeRender() {
  const a = document.activeElement;
  if (a && app.contains(a) && a.matches('input[type="text"], textarea')) { renderPending = true; return; }
  render();
}
app.addEventListener('focusout', () => setTimeout(() => { if (renderPending) safeRender(); }, 0));

const bar = (p, color) => `<div class="bar" role="progressbar" aria-valuenow="${Math.round(p)}" aria-valuemin="0" aria-valuemax="100"${color ? ` style="--c:${color}"` : ''}><span style="width:${Math.min(100, p)}%"></span></div>`;

function taskItem(ex, t, day) {
  const done = t.doneDays.includes(day);
  return `<label class="task ${done ? 'done' : ''} ${t.understood ? 'understood' : ''}">
    <input type="checkbox" data-change="day" data-ex="${ex.id}" data-t="${t.id}" data-day="${day}" ${done ? 'checked' : ''} aria-label="An diesem Tag gelernt">
    <span class="task-main">
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta"><span class="tag" style="--c:${ex.color}">${esc(ex.subject)}</span><span>${fmtPct(share(ex, t))} des Stoffs</span><span>${esc(ex.title || 'Klausur')} ${relDay(ex.date)}</span>${t.understood ? '<span>✓ verstanden</span>' : ''}</span>
    </span>
  </label>`;
}

function dayChip(ex, t, d) {
  const today = todayISO();
  const done = t.doneDays.includes(d);
  const cls = done ? 'done' : d < today ? 'missed' : d === today ? 'today' : '';
  return `<button type="button" class="daychip ${cls}" data-action="toggle-day" data-ex="${ex.id}" data-t="${t.id}" data-day="${d}" title="${done ? 'Gelernt – klicken zum Zurücksetzen' : 'Klicken, wenn an diesem Tag gelernt'}">${done ? ic('check') : ''}${fmtShort(d)}</button>`;
}

function examCard(ex) {
  const p = progress(ex);
  const u = ex.topics.filter(t => t.understood).length;
  const n = diffDays(todayISO(), ex.date);
  return `<a class="card exam-card" href="#/klausur/${ex.id}" style="--c:${ex.color}">
    <div class="exam-card-head">
      <div><div class="exam-subject">${esc(ex.subject)}</div><div class="muted small">${esc(ex.title || 'Klausur')} · ${fmtShort(ex.date)}</div></div>
      <span class="chip ${n >= 0 && n <= 3 ? 'soon' : ''}">${relDay(ex.date)}</span>
    </div>
    ${bar(p, ex.color)}
    <div class="row-between small"><span>${u}/${ex.topics.length} Themen verstanden</span><strong>${fmtPct(p, 0)}</strong></div>
  </a>`;
}

function viewHome() {
  if (!state.exams.length) {
    return `<section class="card empty">
      <div class="brand-mark" aria-hidden="true"></div>
      <h1>Willkommen im Lernplaner</h1>
      <p class="muted">Trag deine Klausuren ein, lade den Stoff hoch und verteile die Themen auf die Tage davor.</p>
      <div class="row gap center wrap">
        <button class="btn primary" data-action="new-exam">${ic('plus')} Erste Klausur anlegen</button>
        ${configured() ? '' : `<button class="btn" data-action="settings">Sync mit GitHub einrichten</button>`}
      </div>
      <ol class="steps">
        <li>Klausur mit Datum anlegen, z. B. Informatik am 4.11.</li>
        <li>Stoff als PDF oder Text hochladen – daraus werden Themen vorgeschlagen.</li>
        <li>Pro Thema die Schwierigkeit (1–5) wählen. Daraus ergibt sich sein Anteil am Stoff.</li>
        <li>„Automatisch verteilen“ – und täglich abhaken, was du gelernt hast.</li>
      </ol>
    </section>`;
  }
  const today = todayISO();
  const upcoming = state.exams.filter(e => e.date >= today).sort(byDate);
  const past = state.exams.filter(e => e.date < today).sort(byDate).reverse();
  const overall = upcoming.length ? sum(upcoming.map(progress)) / upcoming.length : 0;
  const tasks = tasksForDay(today);
  const reviews = reviewsForDay(today);
  const examsToday = examsOnDay(today);
  const late = overdue();

  const todayHtml = [
    ...examsToday.map(ex => `<a class="notice" href="#/klausur/${ex.id}" style="--c:${ex.color}"><span class="dot"></span><span><strong>Heute: ${esc(ex.title || 'Klausur')} ${esc(ex.subject)}</strong> – viel Erfolg!</span></a>`),
    ...reviews.map(ex => `<a class="notice" href="#/klausur/${ex.id}" style="--c:${ex.color}"><span class="dot"></span><span><strong>Wiederholungstag ${esc(ex.subject)}:</strong> Geh nochmal alle Themen durch (${esc(ex.title || 'Klausur')} ${relDay(ex.date)}).</span></a>`),
    tasks.length ? `<div class="tasks">${tasks.map(x => taskItem(x.ex, x.t, today)).join('')}</div>` : '',
  ].join('') || `<p class="muted" style="margin:0">Für heute ist nichts geplant.</p>`;

  return `
  <section class="card hero">
    <div class="hero-top">
      <div>
        <div class="eyebrow">Lernfortschritt gesamt</div>
        <div class="big-pct">${fmtPct(overall, 0)}</div>
        <div class="muted small">${upcoming.length ? `Durchschnitt über ${upcoming.length} anstehende ${upcoming.length === 1 ? 'Klausur' : 'Klausuren'}` : 'Keine anstehenden Klausuren'}</div>
      </div>
      <button class="btn primary" data-action="new-exam">${ic('plus')}<span>Klausur</span></button>
    </div>
    ${bar(overall)}
  </section>

  <section class="card">
    <div class="section-head"><h2>Heute</h2><span class="muted small">${fmtLong(today)}</span></div>
    ${todayHtml}
  </section>

  ${late.length ? `<section class="card">
    <div class="section-head"><h2>Nachholen</h2><span class="muted small">Lerntage, die noch nicht abgehakt sind</span></div>
    <div class="tasks">${late.map(({ ex, t, missed }) => `<div class="late">
      <div class="task-main"><span class="task-title">${esc(t.title)}</span><span class="task-meta"><span class="tag" style="--c:${ex.color}">${esc(ex.subject)}</span><span>${esc(ex.title || 'Klausur')} ${relDay(ex.date)}</span></span></div>
      <div class="days">${missed.map(d => dayChip(ex, t, d)).join('')}</div>
    </div>`).join('')}</div>
  </section>` : ''}

  <section>
    <div class="section-head"><h2>Anstehende Klausuren</h2></div>
    ${upcoming.length ? `<div class="grid">${upcoming.map(examCard).join('')}</div>` : `<p class="muted">Keine anstehenden Klausuren.</p>`}
    ${past.length ? `<details class="past" data-past ${ui.pastOpen ? 'open' : ''}><summary>Vergangene (${past.length})</summary><div class="grid">${past.map(examCard).join('')}</div></details>` : ''}
  </section>`;
}

function viewExam(ex) {
  const today = todayISO();
  const p = progress(ex);
  const u = ex.topics.filter(t => t.understood).length;
  const learnLeft = Math.max(0, diffDays(maxISO(today, ex.startDate), ex.date));
  const n = ex.topics.length;

  const materials = ex.materials.length
    ? `<div class="materials">${ex.materials.map(m => materialRow(ex, m)).join('')}</div>`
    : `<div class="empty-hint">Noch kein Stoff. Lade ein PDF hoch oder füge Text ein (z. B. eine Themenliste).</div>`;

  const topics = n
    ? `<div class="topics">${ex.topics.map((t, i) => topicCard(ex, t, i, n)).join('')}</div>`
    : `<div class="empty-hint">Noch keine Themen. Lass sie dir aus dem Stoff vorschlagen oder trag sie unten ein.</div>`;

  return `
  <a href="#/" class="back">${ic('left')} Übersicht</a>
  <section class="card exam-hero" style="--c:${ex.color}">
    <div class="exam-hero-top">
      <div style="min-width:0">
        <div class="eyebrow"><span class="dot"></span>${esc(ex.title || 'Klausur')}</div>
        <h1>${esc(ex.subject)}</h1>
        <div class="muted">${fmtLong(ex.date)} · <strong style="color:var(--text)">${relDay(ex.date)}</strong></div>
      </div>
      <button class="btn small" data-action="edit-exam" data-ex="${ex.id}">${ic('edit')}<span>Bearbeiten</span></button>
    </div>
    <div class="progress-row">
      <div class="big-pct">${fmtPct(p, 0)}</div>
      <div class="muted small">Lernfortschritt · ${u} von ${n} ${n === 1 ? 'Thema' : 'Themen'} verstanden</div>
    </div>
    ${bar(p, ex.color)}
    <div class="stats">
      <span class="chip">${ic('cal')} ${learnLeft} ${learnLeft === 1 ? 'Lerntag' : 'Lerntage'} übrig</span>
      <span class="chip">Lernbeginn ${fmtShort(ex.startDate)}</span>
    </div>
  </section>

  <section class="card dropzone" data-drop="${ex.id}">
    <div class="section-head">
      <h2>Stoff</h2><span class="spacer"></span>
      <button class="btn small" data-action="add-text" data-ex="${ex.id}">${ic('text')}<span>Text</span></button>
      <button class="btn small" data-action="upload" data-ex="${ex.id}">${ic('upload')}<span>PDF hochladen</span></button>
    </div>
    ${materials}
  </section>

  <section class="card" style="--c:${ex.color}">
    <div class="section-head">
      <h2>Themen</h2><span class="spacer"></span>
      <button class="btn small primary" data-action="distribute" data-ex="${ex.id}" ${n ? '' : 'disabled'}>${ic('wand')}<span>Automatisch verteilen</span></button>
    </div>
    <p class="muted small" style="margin:-4px 0 12px">Schwierigkeit 1–5 bestimmt den Anteil am Stoff. Klick auf einen Tag = an dem Tag gelernt. Haken links = Thema verstanden (zählt zum Fortschritt).</p>
    ${topics}
    <form class="add-topic" data-form="add-topic" data-ex="${ex.id}">
      <input type="text" name="title" placeholder="Neues Thema, z. B. Sortieralgorithmen" maxlength="120" autocomplete="off" aria-label="Neues Thema">
      <button class="btn" type="submit">${ic('plus')}<span>Hinzufügen</span></button>
    </form>
  </section>

  ${planSection(ex)}`;
}

function materialRow(ex, m) {
  const isPdf = m.type === 'pdf';
  let meta = isPdf ? `PDF · ${fmtSize(m.size || 0)}` : `Text · ${(m.text || '').length.toLocaleString('de-DE')} Zeichen`;
  if (isPdf && m.pending) meta += configured() ? ' · wartet auf Upload' : ' · nur auf diesem Gerät';
  return `<div class="material">
    <div class="ficon ${isPdf ? 'pdf' : ''}">${ic(isPdf ? 'file' : 'text')}</div>
    <div class="minfo"><div class="mname" title="${esc(m.name)}">${esc(m.name)}</div><div class="muted small">${meta}</div></div>
    <div class="mactions">
      <button class="btn small ghost" data-action="view-mat" data-ex="${ex.id}" data-m="${m.id}">${ic('eye')}<span>Ansehen</span></button>
      <button class="btn small ghost" data-action="suggest-mat" data-ex="${ex.id}" data-m="${m.id}">${ic('wand')}<span>Themen vorschlagen</span></button>
      <button class="tool" data-action="del-mat" data-ex="${ex.id}" data-m="${m.id}" aria-label="Stoff löschen" title="Löschen">${ic('trash')}</button>
    </div>
  </div>`;
}

function topicCard(ex, t, i, n) {
  const pct = share(ex, t);
  const a = `data-ex="${ex.id}" data-t="${t.id}"`;
  return `<div class="topic ${t.understood ? 'is-understood' : ''}">
    <div class="topic-head">
      <label class="understood-label" title="Thema verstanden">
        <input type="checkbox" data-change="understood" ${a} ${t.understood ? 'checked' : ''} aria-label="Thema verstanden">
      </label>
      <input type="text" class="topic-title" value="${esc(t.title)}" data-change="title" ${a} aria-label="Name des Themas" maxlength="120">
      <span class="share" title="Anteil am gesamten Stoff">${fmtPct(pct)}</span>
    </div>
    <div class="topic-tools">
        <button type="button" class="tool" data-action="move-topic" data-dir="-1" ${a} ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">${ic('up')}</button>
        <button type="button" class="tool" data-action="move-topic" data-dir="1" ${a} ${i === n - 1 ? 'disabled' : ''} aria-label="Nach unten">${ic('down')}</button>
        <button type="button" class="tool" data-action="del-topic" ${a} aria-label="Thema löschen">${ic('trash')}</button>
    </div>
    <div class="topic-body">
      <div class="diff" role="group" aria-label="Schwierigkeit">
        <span class="diff-label">Schwierigkeit</span>
        ${[1, 2, 3, 4, 5].map(v => `<button type="button" class="${t.difficulty === v ? 'on' : ''}" data-action="set-diff" data-v="${v}" ${a} title="${DIFF[v]}" aria-pressed="${t.difficulty === v}">${v}</button>`).join('')}
        <span class="diff-name">${DIFF[t.difficulty]}</span>
      </div>
      <div class="days">
        ${t.days.map(d => dayChip(ex, t, d)).join('') || '<span class="muted small">Noch keine Lerntage</span>'}
        <button type="button" class="daychip add" data-action="edit-days" ${a}>${ic('cal')}Tage wählen</button>
      </div>
    </div>
    <div class="share-line" style="width:${pct}%"></div>
  </div>`;
}

function planSection(ex) {
  const days = planDays(ex);
  if (!days.length) return '';
  const today = todayISO();
  const rows = days.map(d => {
    const items = ex.topics.filter(t => t.days.includes(d));
    const review = ex.reviewDay === d;
    const cls = `${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`;
    const content = items.map(t => dayChipNamed(ex, t, d)).join('') + (review ? `<span class="review-pill">${ic('eye')}Wiederholung aller Themen</span>` : '');
    return `<div class="plan-row ${cls}"><div class="plan-date">${d === today ? 'Heute' : fmtShort(d)}</div><div class="plan-items">${content || '<span class="muted small">frei</span>'}</div></div>`;
  }).join('');
  return `<section class="card">
    <div class="section-head"><h2>Lernplan</h2><span class="muted small">${fmtShort(days[0])} – ${fmtShort(days[days.length - 1])}</span></div>
    <div class="plan" style="--c:${ex.color}">${rows}<div class="plan-row exam"><div class="plan-date">${fmtShort(ex.date)}</div><div class="plan-items"><span class="tag" style="--c:${ex.color}">${esc(ex.title || 'Klausur')}</span></div></div></div>
  </section>`;
}
function dayChipNamed(ex, t, d) {
  const today = todayISO();
  const done = t.doneDays.includes(d);
  const cls = done ? 'done' : d < today ? 'missed' : '';
  return `<button type="button" class="daychip ${cls}" data-action="toggle-day" data-ex="${ex.id}" data-t="${t.id}" data-day="${d}">${done ? ic('check') : ''}${esc(t.title)}</button>`;
}

function buildDayIndex() {
  const map = new Map();
  const get = d => { if (!map.has(d)) map.set(d, { exams: [], tasks: [], reviews: [] }); return map.get(d); };
  for (const ex of state.exams) {
    get(ex.date).exams.push(ex);
    if (ex.reviewDay) get(ex.reviewDay).reviews.push(ex);
    for (const t of ex.topics) for (const d of t.days) get(d).tasks.push({ ex, t, done: t.doneDays.includes(d) });
  }
  return map;
}

function viewCalendar() {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const dim = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((offset + dim) / 7);
  const start = toISO(new Date(y, m - 1, 1 - offset));
  const today = todayISO();
  const idx = buildDayIndex();
  const empty = { exams: [], tasks: [], reviews: [] };

  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const info = idx.get(d) || empty;
    const inMonth = d.slice(0, 7) === ui.calMonth;
    const dots = info.tasks.slice(0, 6).map(x => `<i class="${x.done ? 'done' : ''}" style="--c:${x.ex.color}"></i>`).join('')
      + (info.tasks.length > 6 ? `<em>+${info.tasks.length - 6}</em>` : '')
      + info.reviews.map(() => '<i class="review"></i>').join('');
    cells += `<button type="button" class="cal-cell ${inMonth ? '' : 'out'} ${d === today ? 'today' : ''} ${d === ui.calSel ? 'sel' : ''}" data-action="cal-select" data-day="${d}" aria-label="${fmtLong(d)}">
      <span class="cal-num">${fromISO(d).getDate()}</span>
      ${info.exams.map(ex => `<span class="cal-exam" style="--c:${ex.color}">${esc(ex.subject)}</span>`).join('')}
      <span class="cal-dots">${dots}</span>
    </button>`;
  }

  const sel = ui.calSel;
  const selInfo = idx.get(sel) || empty;
  const selTasks = tasksForDay(sel);
  const detail = [
    ...selInfo.exams.map(ex => `<a class="notice" href="#/klausur/${ex.id}" style="--c:${ex.color}"><span class="dot"></span><span><strong>${esc(ex.title || 'Klausur')} ${esc(ex.subject)}</strong> · ${fmtPct(progress(ex), 0)} gelernt</span></a>`),
    ...selInfo.reviews.map(ex => `<a class="notice" href="#/klausur/${ex.id}" style="--c:${ex.color}"><span class="dot"></span><span><strong>Wiederholungstag ${esc(ex.subject)}</strong> – alle Themen nochmal durchgehen</span></a>`),
    selTasks.length ? `<div class="tasks">${selTasks.map(x => taskItem(x.ex, x.t, sel)).join('')}</div>` : '',
  ].join('') || `<p class="muted" style="margin:0">Nichts geplant.</p>`;

  return `<section class="card">
    <div class="cal-head">
      <h2>${MONTHS[m - 1]} ${y}</h2>
      <button class="btn small" data-action="cal-nav" data-d="0">Heute</button>
      <button class="icon-btn" data-action="cal-nav" data-d="-1" aria-label="Vorheriger Monat">${ic('left')}</button>
      <button class="icon-btn" data-action="cal-nav" data-d="1" aria-label="Nächster Monat">${ic('right')}</button>
    </div>
    <div class="cal-grid">
      ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<div class="cal-wd">${w}</div>`).join('')}
      ${cells}
    </div>
    <div class="legend"><span><i></i>Thema geplant</span><span><i class="done"></i>gelernt</span><span><i style="border-style:dotted"></i>Wiederholung</span></div>
  </section>
  <section class="card">
    <div class="section-head"><h2>${fmtLong(sel)}</h2></div>
    ${detail}
  </section>`;
}

/* ---------- Interaktion ---------- */
function ctx(el) {
  const ex = examById(el.dataset.ex);
  const t = ex && ex.topics.find(x => x.id === el.dataset.t);
  return { ex, t };
}
function setDone(t, day, on) {
  t.doneDays = t.doneDays.filter(d => d !== day);
  if (on) t.doneDays.push(day);
  t.doneDays.sort();
}

const actions = {
  'new-exam': () => openExamModal(),
  'edit-exam': el => openExamModal(examById(el.dataset.ex)),
  settings: () => openSettings(),
  sync: () => (configured() ? sync() : openSettings()),
  'toggle-day': el => {
    const { ex, t } = ctx(el); if (!t) return;
    setDone(t, el.dataset.day, !t.doneDays.includes(el.dataset.day));
    commit(ex);
  },
  'set-diff': el => { const { ex, t } = ctx(el); if (!t) return; t.difficulty = +el.dataset.v; commit(ex); },
  'del-topic': el => {
    const { ex, t } = ctx(el); if (!t) return;
    if (!confirm(`Thema „${t.title}“ löschen?`)) return;
    ex.topics = ex.topics.filter(x => x !== t);
    commit(ex);
  },
  'move-topic': el => {
    const { ex, t } = ctx(el); if (!t) return;
    const i = ex.topics.indexOf(t), j = i + +el.dataset.dir;
    if (j < 0 || j >= ex.topics.length) return;
    [ex.topics[i], ex.topics[j]] = [ex.topics[j], ex.topics[i]];
    commit(ex);
  },
  'edit-days': el => { const { ex, t } = ctx(el); if (t) openDaysModal(ex, t); },
  distribute: el => distributeAction(examById(el.dataset.ex)),
  upload: el => pickFiles(examById(el.dataset.ex)),
  'add-text': el => openTextModal(examById(el.dataset.ex)),
  'view-mat': el => { const ex = examById(el.dataset.ex); const m = ex?.materials.find(x => x.id === el.dataset.m); if (m) viewMaterial(ex, m); },
  'suggest-mat': el => { const ex = examById(el.dataset.ex); const m = ex?.materials.find(x => x.id === el.dataset.m); if (m) openSuggest(ex, m); },
  'del-mat': el => { const ex = examById(el.dataset.ex); const m = ex?.materials.find(x => x.id === el.dataset.m); if (m) deleteMaterial(ex, m); },
  'cal-nav': el => {
    const d = +el.dataset.d;
    if (d === 0) { ui.calMonth = todayISO().slice(0, 7); ui.calSel = todayISO(); }
    else { const [y, m] = ui.calMonth.split('-').map(Number); ui.calMonth = toISO(new Date(y, m - 1 + d, 1)).slice(0, 7); }
    saveUi(); render();
  },
  'cal-select': el => {
    ui.calSel = el.dataset.day;
    if (ui.calSel.slice(0, 7) !== ui.calMonth) { ui.calMonth = ui.calSel.slice(0, 7); saveUi(); }
    render();
  },
};

const changes = {
  day: el => { const { ex, t } = ctx(el); if (!t) return; setDone(t, el.dataset.day, el.checked); commit(ex); },
  understood: el => {
    const { ex, t } = ctx(el); if (!t) return;
    t.understood = el.checked;
    commit(ex);
    if (el.checked && progress(ex) >= 100) toast(`Alles verstanden – viel Erfolg in ${ex.subject}!`);
  },
  title: el => {
    const { ex, t } = ctx(el); if (!t) return;
    const v = el.value.trim();
    if (!v) { el.value = t.title; return; }
    t.title = v;
    touch(ex); save(); scheduleSync();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el, e);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && changes[el.dataset.change]) changes[el.dataset.change](el, e);
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form="add-topic"]');
  if (!form) return;
  e.preventDefault();
  const ex = examById(form.dataset.ex);
  const input = form.elements.title;
  const title = input.value.trim();
  if (!ex || !title) return;
  ex.topics.push(newTopic(title));
  input.value = '';
  touch(ex); save(); render(); scheduleSync();
  $('[data-form="add-topic"] input')?.focus();
});
document.addEventListener('toggle', e => {
  if (e.target.matches?.('[data-past]')) { ui.pastOpen = e.target.open; saveUi(); }
}, true);

// PDFs per Drag & Drop auf den Stoff-Bereich
app.addEventListener('dragover', e => {
  const z = e.target.closest('[data-drop]'); if (!z) return;
  e.preventDefault(); z.classList.add('drag');
});
app.addEventListener('dragleave', e => { const z = e.target.closest('[data-drop]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('drag'); });
app.addEventListener('drop', e => {
  const z = e.target.closest('[data-drop]'); if (!z) return;
  e.preventDefault(); z.classList.remove('drag');
  const ex = examById(z.dataset.drop);
  if (ex && e.dataTransfer.files.length) addFiles(ex, [...e.dataTransfer.files]);
});

function distributeAction(ex) {
  if (!ex) return;
  const today = todayISO();
  const open = ex.topics.filter(t => !t.understood);
  if (!ex.topics.length) return toast('Füge zuerst Themen hinzu.');
  if (!open.length) return toast('Alle Themen sind schon verstanden.');
  const from = maxISO(ex.startDate, today);
  const end = addDays(ex.date, -1);
  if (from > end) return toast('Bis zur Klausur sind keine Lerntage mehr übrig.', 'error');
  if (open.some(t => t.days.some(d => d >= from)) && !confirm('Die bisherige Planung ab heute wird neu verteilt. Fortfahren?')) return;
  const r = distribute(ex, from, end);
  commit(ex);
  toast(`${open.length} ${open.length === 1 ? 'Thema' : 'Themen'} auf ${r.days} ${r.days === 1 ? 'Tag' : 'Tage'} verteilt${r.review ? ' + Wiederholungstag' : ''}.`);
}

/* ---------- Modals ---------- */
let modalCleanup = null;
function openModal({ title, body, footer = '', wide = false }) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mtitle">
    <div class="modal-head"><h2 id="mtitle">${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">${ic('x')}</button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div></div>`;
  const back = root.firstElementChild;
  let downOnBack = false;
  back.addEventListener('mousedown', e => { downOnBack = e.target === back; });
  back.addEventListener('click', e => {
    if ((e.target === back && downOnBack) || e.target.closest('[data-close]')) closeModal();
  });
  document.body.style.overflow = 'hidden';
  return back.firstElementChild;
}
function closeModal() {
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal-root').firstChild) closeModal(); });

function openExamModal(ex) {
  const isNew = !ex;
  const d = ex || { subject: '', title: 'Klausur', date: addDays(todayISO(), 14), startDate: todayISO(), color: COLORS[state.exams.length % COLORS.length] };
  const m = openModal({
    title: isNew ? 'Neue Klausur' : 'Klausur bearbeiten',
    body: `<form id="examForm" class="form">
      <label class="field"><span>Fach</span><input type="text" name="subject" required maxlength="60" value="${esc(d.subject)}" placeholder="z. B. Informatik" autocomplete="off"></label>
      <label class="field"><span>Art</span><input type="text" name="title" maxlength="60" value="${esc(d.title)}" placeholder="Klausur" list="examTypes" autocomplete="off"></label>
      <datalist id="examTypes"><option>Klausur</option><option>Test</option><option>Prüfung</option><option>Abschlussprüfung</option><option>Referat</option><option>Abgabe</option></datalist>
      <div class="field-row">
        <label class="field"><span>Datum</span><input type="date" name="date" required value="${d.date}"></label>
        <label class="field"><span>Lernbeginn</span><input type="date" name="startDate" required value="${d.startDate}"></label>
      </div>
      ${isNew ? '' : '<p class="hint">Wenn du Datum oder Lernbeginn änderst, danach „Automatisch verteilen“ drücken.</p>'}
      <div class="field"><span>Farbe</span><div class="swatches">${COLORS.map(c => `<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === d.color ? 'checked' : ''}><span></span></label>`).join('')}</div></div>
    </form>`,
    footer: `${isNew ? '' : `<button type="button" class="btn ghost danger" data-m="delete">${ic('trash')}Löschen</button>`}<span class="spacer"></span>
      <button type="button" class="btn ghost" data-close>Abbrechen</button>
      <button type="submit" class="btn primary" form="examForm">${isNew ? 'Anlegen' : 'Speichern'}</button>`,
  });
  const form = $('#examForm', m);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(form);
    const subject = String(f.get('subject')).trim();
    const date = String(f.get('date'));
    let startDate = String(f.get('startDate') || todayISO());
    if (!subject || !date) return;
    if (startDate > date) startDate = date;
    const fields = { subject, title: String(f.get('title')).trim() || 'Klausur', date, startDate, color: String(f.get('color') || COLORS[0]) };
    if (isNew) {
      const nx = normalizeExam({ id: uid(), ...fields, topics: [], materials: [], createdAt: Date.now() });
      state.exams.push(nx);
      commit(nx);
      closeModal();
      location.hash = `#/klausur/${nx.id}`;
    } else {
      Object.assign(ex, fields);
      commit(ex);
      closeModal();
    }
  });
  $('[data-m="delete"]', m)?.addEventListener('click', () => {
    if (!confirm(`„${ex.title} ${ex.subject}“ mit allen Themen und Dateien löschen?`)) return;
    state.exams = state.exams.filter(x => x !== ex);
    state.deleted[ex.id] = Date.now();
    for (const mat of ex.materials) removeMaterialFile(mat);
    closeModal();
    commit();
    location.hash = '#/';
  });
  if (isNew) setTimeout(() => form.elements.subject.focus(), 50);
}

function openDaysModal(ex, t) {
  const today = todayISO();
  const days = [...new Set([...planDays(ex), ...t.days])].sort();
  if (!days.length) return toast('Kein Zeitraum zum Lernen – Lernbeginn in der Klausur anpassen.', 'error');
  const sel = new Set(t.days);
  let lastMonth = '';
  const chips = days.map(d => {
    const mo = d.slice(0, 7);
    const head = mo !== lastMonth ? `<div class="month">${MONTHS[+mo.slice(5) - 1]}</div>` : '';
    lastMonth = mo;
    const wd = fromISO(d).getDay();
    return `${head}<button type="button" class="pick ${sel.has(d) ? 'on' : ''} ${d === today ? 'today' : ''} ${wd === 0 || wd === 6 ? 'we' : ''}" data-d="${d}" aria-pressed="${sel.has(d)}">${fmtShort(d)}</button>`;
  }).join('');
  const m = openModal({
    title: `Lerntage: ${t.title}`,
    body: `<p class="muted small" style="margin-top:0">Wähle die Tage, an denen du dieses Thema lernen willst.</p><div class="picker">${chips}</div>`,
    footer: `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="button" class="btn primary" data-m="save">Speichern</button>`,
  });
  $('.picker', m).addEventListener('click', e => {
    const b = e.target.closest('.pick'); if (!b) return;
    const d = b.dataset.d;
    sel.has(d) ? sel.delete(d) : sel.add(d);
    b.classList.toggle('on', sel.has(d));
    b.setAttribute('aria-pressed', sel.has(d));
  });
  $('[data-m="save"]', m).addEventListener('click', () => {
    t.days = [...sel].sort();
    t.doneDays = t.doneDays.filter(d => sel.has(d));
    closeModal();
    commit(ex);
  });
}

function openTextModal(ex) {
  const m = openModal({
    title: 'Stoff als Text hinzufügen',
    wide: true,
    body: `<form id="textForm" class="form">
      <label class="field"><span>Name</span><input type="text" name="name" value="Themenliste" maxlength="80" required></label>
      <label class="field"><span>Text</span><textarea name="text" required placeholder="Am besten ein Thema pro Zeile, z. B.:&#10;1. Datentypen&#10;2. Schleifen&#10;3. Rekursion&#10;4. Sortieralgorithmen"></textarea></label>
      <p class="hint">Überschriften, Nummerierungen (1., 1.2 …) und Aufzählungen werden als Themen erkannt.</p>
    </form>`,
    footer: `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="submit" class="btn primary" form="textForm">Speichern & Themen vorschlagen</button>`,
  });
  const form = $('#textForm', m);
  setTimeout(() => form.elements.text.focus(), 50);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    const mat = { id: uid(), type: 'text', name: form.elements.name.value.trim() || 'Text', text, addedAt: Date.now() };
    ex.materials.push(mat);
    commit(ex);
    openSuggest(ex, mat);
  });
}

/* ---------- Stoff / Dateien ---------- */
function pickFiles(ex) {
  if (!ex) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.txt,.md,application/pdf,text/plain';
  input.multiple = true;
  input.addEventListener('change', () => { if (input.files.length) addFiles(ex, [...input.files]); });
  input.click();
}

async function addFiles(ex, list) {
  const added = [];
  for (const f of list) {
    if (/\.(txt|md)$/i.test(f.name) || f.type === 'text/plain') {
      const mat = { id: uid(), type: 'text', name: f.name, text: await f.text(), addedAt: Date.now() };
      ex.materials.push(mat); added.push(mat);
      continue;
    }
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { toast(`${f.name}: nur PDF- oder Textdateien.`, 'error'); continue; }
    if (f.size > 45 * 1048576) { toast(`${f.name} ist zu groß (max. 45 MB).`, 'error'); continue; }
    const mat = { id: uid(), type: 'pdf', name: f.name, size: f.size, addedAt: Date.now(), pending: true };
    await files.set(mat.id, new Blob([f], { type: 'application/pdf' }));
    ex.materials.push(mat); added.push(mat);
  }
  if (!added.length) return;
  commit(ex);
  if (added.length === 1) openSuggest(ex, added[0]);
  else toast(`${added.length} Dateien hinzugefügt.`);
}

const remotePath = (ex, m) => m.path || `files/${ex.id}/${m.id}.pdf`;

async function getPdfBlob(ex, m) {
  const local = await files.get(m.id);
  if (local) return local;
  if (!configured()) throw new Error('Diese PDF liegt nicht auf diesem Gerät. Richte den GitHub-Sync ein, um sie zu laden.');
  const r = await ghFetch(`/contents/${encPath(remotePath(ex, m))}${refQ()}`, { headers: { Accept: 'application/vnd.github.raw' } });
  if (r.status === 404) throw new Error(m.pending ? 'Die PDF wurde vom anderen Gerät noch nicht hochgeladen. Öffne den Planer dort einmal mit Internet.' : 'PDF im Repo nicht gefunden.');
  if (!r.ok) throw await ghError(r);
  const blob = new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
  files.set(m.id, blob);
  if (m.pending) { m.pending = false; m.path = remotePath(ex, m); commit(ex); }
  return blob;
}

async function viewMaterial(ex, m) {
  if (m.type === 'text') {
    openModal({ title: m.name, wide: true, body: `<pre>${esc(m.text)}</pre>` });
    return;
  }
  const modal = openModal({ title: m.name, wide: true, body: `<div class="loading"><div class="spinner"></div>PDF wird geladen …</div>` });
  try {
    const blob = await getPdfBlob(ex, m);
    if (!modal.isConnected) return;
    const url = URL.createObjectURL(blob);
    modalCleanup = () => setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('.modal-body', modal).innerHTML = `<div class="row gap wrap" style="margin-bottom:10px">
        <a class="btn small" href="${url}" target="_blank" rel="noopener">${ic('eye')}In neuem Tab öffnen</a>
        <a class="btn small ghost" href="${url}" download="${esc(m.name)}">Herunterladen</a>
      </div><iframe src="${url}" title="${esc(m.name)}"></iframe>`;
  } catch (err) {
    if (modal.isConnected) $('.modal-body', modal).innerHTML = `<div class="status-box error">${esc(err.message)}</div>`;
  }
}

function removeMaterialFile(m) {
  if (m.type !== 'pdf') return;
  files.del(m.id);
  if (configured() && !m.pending) deleteRemote(m.path || '', `PDF gelöscht: ${m.name}`);
}
function deleteMaterial(ex, m) {
  if (!confirm(`„${m.name}“ löschen? Die Themen bleiben erhalten.`)) return;
  if (m.type === 'pdf' && !m.path) m.path = remotePath(ex, m);
  removeMaterialFile(m);
  ex.materials = ex.materials.filter(x => x !== m);
  commit(ex);
}

/* ---------- Themen aus Stoff vorschlagen ---------- */
const NUM_RE = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\)?\s+\S/;
const numLevel = s => { const mm = s.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})/); return mm ? mm[1].split('.').filter(Boolean).length : 0; };
const cleanTitle = s => s.replace(/\s+/g, ' ').replace(/^[\s•·▪●○◦■□►▸\-–—*]+/, '').replace(/[\s.:,;]+$/, '').trim();
function dedupe(list) {
  const seen = new Set();
  return list.filter(c => { const k = norm(c.title); if (!c.title || seen.has(k)) return false; seen.add(k); return true; });
}

function suggestFromText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  let structured = false, bullets = false;
  for (const l of lines) {
    let mm;
    if ((mm = l.match(/^#{1,6}\s+(.+)/))) { out.push({ title: cleanTitle(mm[1]), checked: true }); structured = true; }
    else if (NUM_RE.test(l) && l.length <= 100) { out.push({ title: cleanTitle(l), checked: numLevel(l) <= 2 }); structured = true; }
    else if ((mm = l.match(/^[-*•–·▪●○◦►▸]\s*(.+)/)) && mm[1].length <= 100) { out.push({ title: cleanTitle(mm[1]), checked: null, kind: 'b' }); bullets = true; }
    else if (l.length <= 80) out.push({ title: cleanTitle(l), checked: null, kind: 's' });
  }
  for (const c of out) {
    if (c.checked !== null) continue;
    c.checked = c.kind === 'b' ? !structured : !structured && !bullets;
  }
  return dedupe(out.filter(c => c.title.length >= 2)).slice(0, 200);
}

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        res(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsPromise = null; rej(new Error('PDF-Leser konnte nicht geladen werden (Internet?).')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

async function extractPdf(buf) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 300); p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const tr = it.transform;
      const size = Math.hypot(tr[2], tr[3]) || it.height || 0;
      const x = tr[4], y = tr[5];
      let row = rows.find(r => Math.abs(r.y - y) <= Math.max(1.5, size * 0.35));
      if (!row) { row = { y, size: 0, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width || 0, s: it.str, size });
      row.size = Math.max(row.size, size);
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map(r => {
      r.items.sort((a, b) => a.x - b.x);
      let text = '', end = null;
      for (const it of r.items) {
        if (end !== null && it.x - end > it.size * 0.2 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
        text += it.s;
        end = it.x + it.w;
      }
      return { text: text.replace(/\s+/g, ' ').trim(), size: r.size };
    }).filter(l => l.text));
    page.cleanup();
  }
  pdf.destroy();
  return pages;
}

function suggestFromPdf(pages) {
  const lines = pages.flat();
  if (!lines.length) return [];
  // Kopf-/Fußzeilen, die auf vielen Seiten wiederkehren, ignorieren
  const freq = new Map();
  for (const ls of pages) for (const k of new Set(ls.map(l => norm(l.text)))) freq.set(k, (freq.get(k) || 0) + 1);
  const repeatLimit = pages.length >= 4 ? Math.max(3, pages.length * 0.3) : Infinity;
  // Schriftgröße des Fließtexts = nach Zeichen gewichteter Median
  const bySize = [...lines].sort((a, b) => a.size - b.size);
  const total = sum(lines.map(l => l.text.length));
  let acc = 0, body = bySize[0].size;
  for (const l of bySize) { acc += l.text.length; if (acc >= total / 2) { body = l.size; break; } }

  const out = [];
  for (const l of lines) {
    const t = cleanTitle(l.text);
    if (t.length < 3 || t.length > 90 || !/[A-Za-zÄÖÜäöüß]{2}/.test(t)) continue;
    if ((freq.get(norm(l.text)) || 0) >= repeatLimit) continue;
    const big = l.size >= body * 1.15;
    const lvl = NUM_RE.test(l.text) ? numLevel(l.text) : 0;
    if (big) out.push({ title: t, checked: lvl === 0 || lvl <= 2 });
    else if (lvl && !/[.;,!?]$/.test(l.text) && t.length <= 80) out.push({ title: t, checked: lvl <= 2 });
  }
  let res = dedupe(out);
  if (!res.length) {
    res = dedupe(lines.map(l => ({ title: cleanTitle(l.text), checked: false })).filter(c => c.title.length >= 4 && c.title.length <= 80)).slice(0, 60);
  }
  return res.slice(0, 200);
}

async function openSuggest(ex, m) {
  const modal = openModal({
    title: 'Themen vorschlagen',
    wide: true,
    body: `<div class="loading"><div class="spinner"></div>${m.type === 'pdf' ? 'PDF wird gelesen …' : 'Text wird analysiert …'}</div>`,
  });
  let cands;
  try {
    if (m.type === 'text') cands = suggestFromText(m.text);
    else cands = suggestFromPdf(await extractPdf(await (await getPdfBlob(ex, m)).arrayBuffer()));
  } catch (err) {
    if (modal.isConnected) $('.modal-body', modal).innerHTML = `<div class="status-box error">${esc(err.message || 'Datei konnte nicht gelesen werden.')}</div>`;
    return;
  }
  if (!modal.isConnected) return;
  const body = $('.modal-body', modal);
  if (!cands.length) {
    body.innerHTML = `<div class="status-box">In diesem Stoff wurde kein Text gefunden (z. B. eingescannte PDF). Trag die Themen bitte unten in der Themenliste selbst ein.</div>`;
    return;
  }
  const existing = new Set(ex.topics.map(t => norm(t.title)));
  cands.forEach(c => { if (existing.has(norm(c.title))) { c.checked = false; c.exists = true; } });

  body.innerHTML = `<p class="muted small" style="margin-top:0">Aus „${esc(m.name)}“ erkannt. Wähle die Themen aus und passe die Namen bei Bedarf an – die Schwierigkeit stellst du danach ein.</p>
    <div class="sugg-tools"><button type="button" class="btn small" data-s="all">Alle</button><button type="button" class="btn small" data-s="none">Keine</button></div>
    <div class="sugg-list">${cands.map((c, i) => `<div class="sugg ${c.checked ? '' : 'off'}">
      <input type="checkbox" data-i="${i}" ${c.checked ? 'checked' : ''} aria-label="Übernehmen">
      <input type="text" data-i="${i}" value="${esc(c.title)}" maxlength="120" aria-label="Themenname">
      ${c.exists ? '<span class="exists">schon vorhanden</span>' : ''}
    </div>`).join('')}</div>`;
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  foot.innerHTML = `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="button" class="btn primary" data-s="apply"></button>`;
  modal.appendChild(foot);
  const applyBtn = $('[data-s="apply"]', foot);
  const update = () => {
    const n = $$('.sugg input[type="checkbox"]:checked', body).length;
    applyBtn.textContent = n ? `${n} ${n === 1 ? 'Thema' : 'Themen'} übernehmen` : 'Nichts ausgewählt';
    applyBtn.disabled = !n;
    $$('.sugg', body).forEach(row => row.classList.toggle('off', !$('input[type="checkbox"]', row).checked));
  };
  update();
  body.addEventListener('change', e => { if (e.target.type === 'checkbox') update(); });
  body.addEventListener('click', e => {
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (s === 'all' || s === 'none') { $$('.sugg input[type="checkbox"]', body).forEach(cb => { cb.checked = s === 'all'; }); update(); }
  });
  applyBtn.addEventListener('click', () => {
    const titles = $$('.sugg', body).filter(row => $('input[type="checkbox"]', row).checked).map(row => $('input[type="text"]', row).value.trim()).filter(Boolean);
    titles.forEach(t => ex.topics.push(newTopic(t)));
    closeModal();
    commit(ex);
    toast(`${titles.length} ${titles.length === 1 ? 'Thema' : 'Themen'} hinzugefügt. Jetzt Schwierigkeit einstellen und „Automatisch verteilen“.`);
  });
}

/* ---------- GitHub-Sync ---------- */
const configured = () => !!(cfg.owner && cfg.repo && cfg.token);
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const refQ = () => (cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '');

function ghFetch(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
  });
}
async function ghError(r) {
  let detail = '';
  try { detail = (await r.json()).message || ''; } catch { /* leer */ }
  const msg = {
    401: 'Token ungültig oder abgelaufen.',
    403: /rate limit/i.test(detail) ? 'GitHub-Limit erreicht – bitte später nochmal.' : 'Keine Berechtigung. Der Token braucht „Contents: Read and write“ für das Daten-Repo.',
    404: 'Repo nicht gefunden – oder der Token hat keinen Zugriff darauf.',
    409: 'Konflikt beim Speichern.',
    422: 'Konflikt beim Speichern.',
  }[r.status] || `GitHub-Fehler ${r.status}${detail ? `: ${detail}` : ''}`;
  const err = new Error(msg);
  err.status = r.status;
  return err;
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
const blobToB64 = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

async function getMeta(path) {
  const r = await ghFetch(`/contents/${encPath(path)}${refQ()}`);
  if (r.status === 404) return null;
  if (!r.ok) throw await ghError(r);
  return r.json();
}
async function getFile(path) {
  const j = await getMeta(path);
  if (!j) return null;
  let b64 = j.content;
  if (!b64) { // Dateien > 1 MB kommen nur über die Blob-API
    const br = await ghFetch(`/git/blobs/${j.sha}`);
    if (!br.ok) throw await ghError(br);
    b64 = (await br.json()).content;
  }
  return { sha: j.sha, text: b64ToUtf8(b64) };
}
async function putFile(path, contentB64, sha, message) {
  const body = { message, content: contentB64 };
  if (sha) body.sha = sha;
  if (cfg.branch) body.branch = cfg.branch;
  const r = await ghFetch(`/contents/${encPath(path)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw await ghError(r);
  return r.json();
}
async function deleteRemote(path, message) {
  if (!path) return;
  try {
    const meta = await getMeta(path);
    if (!meta) return;
    const body = { message, sha: meta.sha };
    if (cfg.branch) body.branch = cfg.branch;
    await ghFetch(`/contents/${encPath(path)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { /* Datei bleibt im Repo liegen – unkritisch */ }
}

// Zusammenführen pro Klausur: die zuletzt geänderte Version gewinnt; Löschungen über Grabsteine.
function merge(a, b) {
  const deleted = { ...a.deleted };
  for (const [k, v] of Object.entries(b.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, v);
  const pick = new Map(), other = new Map();
  for (const ex of [...a.exams, ...b.exams]) {
    const cur = pick.get(ex.id);
    if (!cur) { pick.set(ex.id, ex); continue; }
    if ((ex.updatedAt || 0) > (cur.updatedAt || 0)) { pick.set(ex.id, ex); other.set(ex.id, cur); }
    else other.set(ex.id, ex);
  }
  for (const [id, ex] of pick) {
    const o = other.get(id);
    if (!o) continue;
    for (const m of ex.materials) {
      const om = o.materials.find(x => x.id === m.id);
      if (m.pending && om && !om.pending) { m.pending = false; m.path = om.path; }
    }
  }
  const exams = [...pick.values()].filter(ex => !(deleted[ex.id] >= (ex.updatedAt || 0)));
  return { version: 1, exams, deleted };
}
const snap = s => JSON.stringify({ e: [...s.exams].sort((x, y) => (x.id < y.id ? -1 : 1)), d: Object.keys(s.deleted).sort().map(k => [k, s.deleted[k]]) });

async function uploadPending() {
  for (const ex of state.exams) {
    for (const m of ex.materials) {
      if (m.type !== 'pdf' || !m.pending) continue;
      const blob = await files.get(m.id);
      if (!blob) continue; // liegt auf einem anderen Gerät
      const path = remotePath(ex, m);
      const existing = await getMeta(path);
      await putFile(path, await blobToB64(blob), existing?.sha, `PDF: ${m.name}`);
      m.pending = false;
      m.path = path;
      touch(ex);
      save();
    }
  }
}

let syncing = false, syncAgain = false, syncTimer = null, lastSync = 0;
let syncState = { status: 'local', msg: '' };
function scheduleSync(delay = 1200) {
  if (!configured()) { renderSync(); return; }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, delay);
}
async function sync() {
  if (!configured()) { setSync('local'); return; }
  if (syncing) { syncAgain = true; return; }
  clearTimeout(syncTimer);
  syncing = true;
  setSync('busy');
  try {
    await uploadPending();
    for (let attempt = 0; ; attempt++) {
      const remote = await getFile(DATA_PATH);
      let remoteState;
      try { remoteState = normalizeState(remote ? JSON.parse(remote.text) : null); }
      catch { throw new Error('data.json im Repo ist beschädigt.'); }
      const merged = merge(remoteState, state);
      if (snap(merged) !== snap(state)) { state = merged; save(); safeRender(); }
      else state = merged;
      if (remote && snap(merged) === snap(remoteState)) break;
      try {
        await putFile(DATA_PATH, utf8ToB64(JSON.stringify(merged, null, 1)), remote?.sha, 'Lernplaner aktualisiert');
        break;
      } catch (err) {
        if ((err.status === 409 || err.status === 422) && attempt < 3) continue;
        throw err;
      }
    }
    lastSync = Date.now();
    setSync('ok');
  } catch (err) {
    setSync(navigator.onLine === false ? 'offline' : 'error', err.message || String(err));
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}
function setSync(status, msg = '') {
  syncState = { status, msg };
  renderSync();
  const box = $('#syncStatus');
  if (box) box.outerHTML = syncStatusBox();
}
function renderSync() {
  const btn = $('#syncBtn');
  const s = configured() ? syncState.status : 'local';
  const label = { local: 'Nur lokal', busy: 'Synchronisiere …', ok: 'Synchronisiert', error: 'Sync-Fehler', offline: 'Offline' }[s];
  btn.className = `sync ${s}`;
  btn.innerHTML = `<span class="dot"></span><span class="label">${label}</span>`;
  btn.title = s === 'local' ? 'Daten liegen nur auf diesem Gerät – klicken, um GitHub-Sync einzurichten'
    : s === 'ok' ? `Zuletzt synchronisiert ${new Date(lastSync).toLocaleTimeString('de-DE')} – klicken für erneuten Abgleich`
    : syncState.msg || label;
  btn.setAttribute('aria-label', `Synchronisierung: ${label}`);
}
function syncStatusBox() {
  if (!configured()) return `<div id="syncStatus" class="status-box">Nicht verbunden – deine Daten liegen nur auf diesem Gerät.</div>`;
  const s = syncState.status;
  if (s === 'error' || s === 'offline') return `<div id="syncStatus" class="status-box error">${esc(syncState.msg || 'Offline')}</div>`;
  if (s === 'busy') return `<div id="syncStatus" class="status-box">Synchronisiere …</div>`;
  return `<div id="syncStatus" class="status-box ok">Verbunden mit ${esc(cfg.owner)}/${esc(cfg.repo)}${lastSync ? ` · zuletzt ${new Date(lastSync).toLocaleTimeString('de-DE')}` : ''}</div>`;
}

async function connect(owner, repo, token) {
  const prev = { ...cfg };
  cfg = { owner: owner.trim(), repo: repo.trim(), token: token.trim(), branch: '' };
  try {
    const r = await ghFetch('');
    if (!r.ok) throw await ghError(r);
    const info = await r.json();
    cfg.branch = info.default_branch || 'main';
    LS.set(CFG_KEY, cfg);
    await sync();
    if (syncState.status === 'error') throw new Error(syncState.msg);
    return info;
  } catch (err) {
    cfg = prev;
    LS.set(CFG_KEY, cfg);
    syncState = { status: 'local', msg: '' };
    renderSync();
    throw err;
  }
}

const SETUP_PREFIX = 'LP1.';
function setupCode() { return SETUP_PREFIX + btoa(JSON.stringify({ o: cfg.owner, r: cfg.repo, t: cfg.token })); }
function parseSetupCode(code) {
  code = code.trim();
  if (!code.startsWith(SETUP_PREFIX)) return null;
  try { const j = JSON.parse(atob(code.slice(SETUP_PREFIX.length))); return j.o && j.r && j.t ? j : null; } catch { return null; }
}

function openSettings() {
  const m = openModal({
    title: 'Synchronisierung & Daten',
    body: `
      <p class="muted small" style="margin-top:0">Deine Daten werden in einem <strong>privaten GitHub-Repo</strong> gespeichert. Auf jedem Gerät einmal verbinden – danach gleicht sich alles automatisch ab.</p>
      ${syncStatusBox()}
      <form id="cfgForm" class="form">
        <label class="field"><span>GitHub-Benutzername</span><input type="text" name="owner" value="${esc(cfg.owner)}" required autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="dein-name"></label>
        <label class="field"><span>Privates Daten-Repo</span><input type="text" name="repo" value="${esc(cfg.repo || 'lernplaner-daten')}" required autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <label class="field"><span>Token</span><input type="password" name="token" value="${esc(cfg.token)}" required autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
        <p class="hint">Token erstellen: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained token</a>. Bei „Repository access“ nur dein Daten-Repo wählen, bei „Permissions“ <strong>Contents: Read and write</strong>.</p>
        <div class="row gap wrap">
          <button type="submit" class="btn primary">Verbinden & synchronisieren</button>
          ${configured() ? '<button type="button" class="btn ghost danger" data-m="disconnect">Trennen</button>' : ''}
        </div>
      </form>
      <hr>
      <h3>Weiteres Gerät verbinden</h3>
      <p class="muted small">Statt alles abzutippen: Code hier kopieren, an dich selbst schicken und auf dem anderen Gerät einfügen. Der Code enthält deinen Token – behandle ihn wie ein Passwort.</p>
      ${configured() ? '<button type="button" class="btn small" data-m="copy">Einrichtungscode kopieren</button>' : ''}
      <div class="row gap" style="margin-top:8px"><input type="text" id="codeIn" placeholder="Einrichtungscode einfügen (LP1.…)" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-m="usecode">Verbinden</button></div>
      <hr>
      <h3>Backup</h3>
      <p class="muted small">Alle Klausuren und Themen als Datei sichern oder eine Sicherung einspielen (wird mit den vorhandenen Daten zusammengeführt).</p>
      <div class="row gap wrap"><button type="button" class="btn small" data-m="export">Exportieren</button><button type="button" class="btn small" data-m="import">Importieren</button></div>`,
  });
  const form = $('#cfgForm', m);
  const busy = (btn, on, text) => { btn.disabled = on; if (text) btn.textContent = text; };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type="submit"]', form);
    busy(btn, true, 'Verbinde …');
    try {
      const info = await connect(form.elements.owner.value, form.elements.repo.value, form.elements.token.value);
      closeModal();
      toast(info.private ? 'Verbunden – Daten werden synchronisiert.' : 'Verbunden. Achtung: Das Repo ist öffentlich – stell es auf privat!', info.private ? '' : 'error');
      render();
    } catch (err) {
      busy(btn, false, 'Verbinden & synchronisieren');
      $('#syncStatus', m).outerHTML = `<div id="syncStatus" class="status-box error">${esc(err.message)}</div>`;
    }
  });
  $('[data-m="disconnect"]', m)?.addEventListener('click', () => {
    if (!confirm('Dieses Gerät vom GitHub-Sync trennen? Die Daten bleiben lokal erhalten.')) return;
    cfg = { owner: cfg.owner, repo: cfg.repo, token: '', branch: '' };
    LS.set(CFG_KEY, cfg);
    syncState = { status: 'local', msg: '' };
    closeModal(); render();
  });
  $('[data-m="copy"]', m)?.addEventListener('click', async e => {
    const code = setupCode();
    try { await navigator.clipboard.writeText(code); toast('Einrichtungscode kopiert.'); }
    catch { $('#codeIn', m).value = code; $('#codeIn', m).select(); toast('Code markiert – jetzt kopieren.'); }
    e.target.blur();
  });
  $('[data-m="usecode"]', m).addEventListener('click', async e => {
    const j = parseSetupCode($('#codeIn', m).value);
    if (!j) return toast('Ungültiger Einrichtungscode.', 'error');
    busy(e.target, true, 'Verbinde …');
    try { await connect(j.o, j.r, j.t); closeModal(); toast('Verbunden – Daten werden synchronisiert.'); render(); }
    catch (err) { busy(e.target, false, 'Verbinden'); toast(err.message, 'error'); }
  });
  $('[data-m="export"]', m).addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lernplaner-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('[data-m="import"]', m).addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      try {
        const imported = normalizeState(JSON.parse(await input.files[0].text()));
        state = merge(state, imported);
        commit();
        closeModal();
        toast(`Backup eingespielt (${imported.exams.length} Klausuren).`);
      } catch { toast('Diese Datei ist kein gültiges Backup.', 'error'); }
    });
    input.click();
  });
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, msg.length > 60 ? 5000 : 3200);
}

/* ---------- Start ---------- */
window.addEventListener('hashchange', () => { closeModal(); render(); window.scrollTo(0, 0); });
let lastFocusSync = 0;
function onReturn() {
  if (document.visibilityState !== 'visible') return;
  safeRender(); // Datum könnte sich geändert haben
  if (configured() && Date.now() - lastFocusSync > 15000) { lastFocusSync = Date.now(); sync(); }
}
document.addEventListener('visibilitychange', onReturn);
window.addEventListener('focus', onReturn);
window.addEventListener('online', () => configured() && sync());
// Andere Tabs auf demselben Gerät
window.addEventListener('storage', e => {
  if (e.key === DATA_KEY) { state = normalizeState(LS.get(DATA_KEY)); safeRender(); }
  if (e.key === CFG_KEY) { cfg = Object.assign({ owner: '', repo: '', token: '', branch: '' }, LS.get(CFG_KEY) || {}); renderSync(); }
});
setInterval(() => { if (configured() && document.visibilityState === 'visible' && !syncing) sync(); }, 120000);

render();
if (configured()) { lastFocusSync = Date.now(); sync(); }
