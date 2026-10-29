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
  ex.deletedTopics = ex.deletedTopics && typeof ex.deletedTopics === 'object' ? ex.deletedTopics : {};
  ex.sessions = Array.isArray(ex.sessions) ? ex.sessions : [];
  // Altes Format: ein einzelner Wiederholungstag → Sitzung „gemischt üben“
  if (ex.reviewDay) { ex.sessions.push({ id: uid(), d: ex.reviewDay, kind: 'mock', done: false }); }
  delete ex.reviewDay;
  ex.topics.forEach(t => {
    t.days = Array.isArray(t.days) ? [...new Set(t.days)].sort() : [];
    t.doneDays = Array.isArray(t.doneDays) ? t.doneDays.filter(d => t.days.includes(d)) : [];
    t.difficulty = Math.min(5, Math.max(1, +t.difficulty || 3));
    t.understood = !!t.understood;
    t.updatedAt = t.updatedAt || 0;
  });
  return ex;
}

let state = normalizeState(LS.get(DATA_KEY));
const CFG_DEFAULT = { owner: '', repo: '', token: '', branch: '', aiKey: '', aiModel: 'claude-opus-5-5' };
let cfg = Object.assign({}, CFG_DEFAULT, LS.get(CFG_KEY) || {});
const ui = Object.assign({ calMonth: todayISO().slice(0, 7), calSel: todayISO(), pastOpen: false }, LS.get(UI_KEY) || {});
ui.calSel = todayISO();

function save() {
  if (!LS.set(DATA_KEY, state)) toast('Lokaler Speicher ist voll – bitte große Texte kürzen.', 'error');
}
const saveUi = () => LS.set(UI_KEY, { calMonth: ui.calMonth, pastOpen: ui.pastOpen });
// Änderungen an einem Thema stempeln nur das Thema (Sync führt pro Thema zusammen),
// alles andere (Name, Datum, Reihenfolge, Stoff, Sitzungen) stempelt die Klausur.
const touch = obj => { obj.updatedAt = Date.now(); };
function commit(ex, t) {
  if (t) touch(t);
  else if (ex) touch(ex);
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
const newTopic = (title, difficulty = 3) => ({ id: uid(), title, difficulty, days: [], doneDays: [], understood: false, updatedAt: Date.now() });

// Der erste geplante Tag eines Themas ist „neu lernen“, alle späteren sind Wiederholungen.
// So verhalten sich automatisch und manuell gesetzte Tage gleich.
const dayKind = (t, d) => (t.days[0] === d ? 'new' : 'review');
const KIND_LABEL = { new: 'Neu', review: 'Wdh.' };
const SESSION = {
  mock: { label: 'Probeklausur', text: 'Probeklausur bzw. gemischtes Üben über alle Themen – Lücken schließen' },
  weak: { label: 'Schwachstellen', text: 'Nur die schwachen Themen locker wiederholen – kein neuer Stoff' },
};
// Schwache Themen = noch nicht verstanden, schwierigste zuerst
function weakTopics(ex) {
  const open = ex.topics.filter(t => !t.understood);
  return (open.length ? open : ex.topics).slice().sort((a, b) => b.difficulty - a.difficulty).slice(0, 5);
}

function tasksForDay(day) {
  const out = [];
  for (const ex of [...state.exams].sort(byDate)) {
    if (ex.date < day) continue;
    for (const t of ex.topics) if (t.days.includes(day)) out.push({ ex, t });
  }
  // erst neue Themen, dann Wiederholungen
  return out.sort((a, b) => (dayKind(a.t, day) === 'new' ? 0 : 1) - (dayKind(b.t, day) === 'new' ? 0 : 1));
}
function sessionsForDay(day) {
  const out = [];
  for (const ex of [...state.exams].sort(byDate)) {
    if (ex.date <= day) continue;
    for (const s of ex.sessions) if (s.d === day) out.push({ ex, s });
  }
  return out;
}
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

/* Lernplan nach Spaced Repetition für die Tage [from, end]:
   – Lernphase: Jedes offene Thema bekommt einen Tag „neu lernen“ – das schwierigste zuerst.
     Pro Tag kommen ein bis zwei neue Themen dran, leichte Themen teilen sich einen Tag.
     Danach wird jedes Thema mit wachsendem Abstand wiederholt, schwere Themen öfter.
   – Vorletzter Tag: Probeklausur / gemischtes Üben. Letzter Tag: Schwachstellen locker wiederholen.
   Bereits vergangene Tage bleiben unverändert. */
const REVIEW_OFFSETS = { 5: [1, 2, 4, 7, 11, 16], 4: [1, 3, 6, 10, 15], 3: [1, 4, 9, 16], 2: [2, 6, 13], 1: [3, 9] };
function planSpaced(ex, from, end) {
  const days = rangeDays(from, end);
  const open = ex.topics.filter(t => !t.understood);
  for (const t of open) {
    t.days = t.days.filter(d => d < from);
    t.doneDays = t.doneDays.filter(d => t.days.includes(d));
  }
  ex.sessions = ex.sessions.filter(s => s.d < from);

  let mock = null, weak = null;
  if (days.length >= 4) { weak = days.pop(); mock = days.pop(); }
  else if (days.length === 3) mock = days.pop();
  if (mock) ex.sessions.push({ id: uid(), d: mock, kind: 'mock', done: false });
  if (weak) ex.sessions.push({ id: uid(), d: weak, kind: 'weak', done: false });

  const L = days.length, N = open.length;
  const order = open.map((t, i) => [t, i]).sort((a, b) => b[0].difficulty - a[0].difficulty || a[1] - b[1]).map(x => x[0]);

  // 1) Tag zum Neulernen. Bei wenigen Themen über die ersten ~70 % der Lernphase streuen.
  const span = N >= L ? L : Math.min(L, Math.max(N, Math.ceil(L * 0.7)));
  const intro = new Map();
  if (N <= span) {
    order.forEach((t, i) => intro.set(t, Math.floor((i * span) / N)));
  } else {
    let i = 0, W = sum(order.map(t => t.difficulty));
    for (let day = 0; day < span; day++) {
      const daysLeft = span - day;
      const cap = (W / daysLeft) * 1.25; // etwas mehr am Anfang → mehr Zeit für Wiederholungen
      let load = 0;
      while (i < N) {
        const t = order[i];
        const full = load > 0 && load + t.difficulty / 2 > cap && N - i >= daysLeft - 1;
        if (full && day < span - 1) break;
        intro.set(t, day); load += t.difficulty; W -= t.difficulty; i++;
      }
    }
  }

  // 2) Wiederholungen mit wachsendem Abstand; volle Tage schieben die Wiederholung einen Tag weiter.
  const cap = Math.min(6, Math.max(3, Math.ceil(N / 2)));
  const reviews = new Array(L).fill(0);
  for (const t of order) {
    const s = intro.get(t);
    const idx = [s];
    for (const off of REVIEW_OFFSETS[t.difficulty]) {
      let d = s + off;
      while (d < L && (reviews[d] >= cap || idx.includes(d))) d++;
      if (d >= L) break;
      idx.push(d);
      reviews[d]++;
    }
    t.days = [...new Set([...t.days, ...idx.map(i => days[i])])].sort();
    touch(t);
  }
  return { days: L + (mock ? 1 : 0) + (weak ? 1 : 0), mock: !!mock, weak: !!weak };
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
  autosizeAll();
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
const kindBadge = kind => `<span class="kind ${kind}">${{ new: 'Neu lernen', review: 'Wiederholen', mock: 'Probeklausur', weak: 'Schwachstellen' }[kind]}</span>`;

function taskItem(ex, t, day) {
  const done = t.doneDays.includes(day);
  return `<label class="task ${done ? 'done' : ''} ${t.understood ? 'understood' : ''}">
    <input type="checkbox" data-change="day" data-ex="${ex.id}" data-t="${t.id}" data-day="${day}" ${done ? 'checked' : ''} aria-label="An diesem Tag gelernt">
    <span class="task-main">
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">${kindBadge(dayKind(t, day))}<span class="tag" style="--c:${ex.color}">${esc(ex.subject)}</span><span>${fmtPct(share(ex, t))} des Stoffs</span><span>${esc(ex.title || 'Klausur')} ${relDay(ex.date)}</span>${t.understood ? '<span>✓ verstanden</span>' : ''}</span>
    </span>
  </label>`;
}

function sessionItem(ex, s) {
  const weak = s.kind === 'weak' ? weakTopics(ex).map(t => esc(t.title)).join(' · ') : '';
  return `<label class="task session ${s.done ? 'done' : ''}">
    <input type="checkbox" data-change="session" data-ex="${ex.id}" data-s="${s.id}" ${s.done ? 'checked' : ''} aria-label="Erledigt">
    <span class="task-main">
      <span class="task-title">${SESSION[s.kind].label}: ${esc(ex.subject)}</span>
      <span class="task-meta">${kindBadge(s.kind)}<span class="tag" style="--c:${ex.color}">${esc(ex.subject)}</span><span>${esc(ex.title || 'Klausur')} ${relDay(ex.date)}</span></span>
      <span class="task-note">${SESSION[s.kind].text}${weak ? `<br><strong>Schwach:</strong> ${weak}` : ''}</span>
    </span>
  </label>`;
}

// Tag-Chip am Thema: Antippen = gelernt/nicht gelernt, ✕ = Tag entfernen.
function dayChip(ex, t, d) {
  const today = todayISO();
  const done = t.doneDays.includes(d);
  const kind = dayKind(t, d);
  const st = done ? 'done' : d < today ? 'missed' : d === today ? 'today' : '';
  const a = `data-ex="${ex.id}" data-t="${t.id}" data-day="${d}"`;
  return `<span class="daychip ${kind} ${st}">
    <button type="button" class="dc-main" data-action="toggle-day" ${a} aria-pressed="${done}" title="${done ? 'Gelernt – antippen zum Zurücksetzen' : 'Antippen, wenn an diesem Tag gelernt'}">${done ? ic('check') : ''}<span class="dc-kind">${KIND_LABEL[kind]}</span>${fmtShort(d)}</button>
    <button type="button" class="dc-x" data-action="remove-day" ${a} aria-label="Lerntag ${fmtShort(d)} entfernen" title="Tag entfernen">${ic('x')}</button>
  </span>`;
}
function sessionChip(ex, s) {
  const a = `data-ex="${ex.id}" data-s="${s.id}"`;
  return `<span class="daychip session ${s.done ? 'done' : ''}">
    <button type="button" class="dc-main" data-action="toggle-session" ${a} aria-pressed="${s.done}">${s.done ? ic('check') : ''}${SESSION[s.kind].label}</button>
    <button type="button" class="dc-x" data-action="remove-session" ${a} aria-label="${SESSION[s.kind].label} entfernen" title="Entfernen">${ic('x')}</button>
  </span>`;
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

// Alles, was an einem Tag ansteht: Klausuren, Probeklausur/Schwachstellen, Themen
function dayAgenda(day, emptyText) {
  const isToday = day === todayISO();
  const notices = examsOnDay(day).map(ex => `<a class="notice" href="#/klausur/${ex.id}" style="--c:${ex.color}"><span class="dot"></span><span><strong>${isToday ? 'Heute: ' : ''}${esc(ex.title || 'Klausur')} ${esc(ex.subject)}</strong>${isToday ? ' – viel Erfolg!' : ` · ${fmtPct(progress(ex), 0)} gelernt`}</span></a>`).join('');
  const items = [...sessionsForDay(day).map(x => sessionItem(x.ex, x.s)), ...tasksForDay(day).map(x => taskItem(x.ex, x.t, day))];
  return (notices + (items.length ? `<div class="tasks">${items.join('')}</div>` : '')) || `<p class="muted" style="margin:0">${emptyText}</p>`;
}

function viewHome() {
  if (!state.exams.length) {
    return `<section class="card empty">
      <div class="brand-mark" aria-hidden="true"></div>
      <h1>Willkommen im Lernplaner</h1>
      <p class="muted">Trag deine Klausuren ein, lade den Stoff hoch und lass dir einen Lernplan erstellen.</p>
      <div class="row gap center wrap">
        <button class="btn primary" data-action="new-exam">${ic('plus')} Erste Klausur anlegen</button>
        ${configured() ? '' : `<button class="btn" data-action="settings">Sync mit GitHub einrichten</button>`}
      </div>
      <ol class="steps">
        <li>Klausur mit Datum anlegen, z. B. Informatik am 4.11.</li>
        <li>Stoff als PDF oder Text hochladen – daraus werden Themen vorgeschlagen.</li>
        <li>Pro Thema die Schwierigkeit (1–5) wählen. Daraus ergibt sich sein Anteil am Stoff.</li>
        <li>„Lernplan erstellen“ – neue Themen und Wiederholungen werden verteilt. Täglich abhaken!</li>
      </ol>
    </section>`;
  }
  const today = todayISO();
  const upcoming = state.exams.filter(e => e.date >= today).sort(byDate);
  const past = state.exams.filter(e => e.date < today).sort(byDate).reverse();
  const overall = upcoming.length ? sum(upcoming.map(progress)) / upcoming.length : 0;
  const late = overdue();

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
    ${dayAgenda(today, 'Für heute ist nichts geplant.')}
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

// Nummer am Anfang eines Themas („2.3 Bäume“ → [2, 3]) für die Sortierung
function numKey(title) {
  const m = String(title).trim().match(/^(\d{1,3}(?:\.\d{1,3})*)[.)]?\s/);
  return m ? m[1].split('.').map(Number) : null;
}
function cmpKey(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return d; }
  return 0;
}
function numberedOutOfOrder(ex) {
  const keys = ex.topics.map(t => numKey(t.title)).filter(Boolean);
  return keys.some((k, i) => i > 0 && cmpKey(keys[i - 1], k) > 0);
}
// Neues Thema mit Nummer an die passende Stelle einsortieren, sonst ans Ende
function insertTopic(ex, t) {
  const k = numKey(t.title);
  const i = k ? ex.topics.findIndex(x => { const kx = numKey(x.title); return kx && cmpKey(kx, k) > 0; }) : -1;
  if (i >= 0) ex.topics.splice(i, 0, t); else ex.topics.push(t);
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
      ${numberedOutOfOrder(ex) ? `<button class="btn small" data-action="sort-topics" data-ex="${ex.id}">${ic('down')}<span>Nach Nummer sortieren</span></button>` : ''}
      <button class="btn small primary" data-action="distribute" data-ex="${ex.id}" ${n ? '' : 'disabled'}>${ic('wand')}<span>Lernplan erstellen</span></button>
    </div>
    <p class="muted small" style="margin:-4px 0 12px">Schwierigkeit 1–5 bestimmt den Anteil am Stoff. Tag antippen = an dem Tag gelernt, ✕ = Tag entfernen. <span class="kind new">Neu</span> = erstes Lernen, <span class="kind review">Wdh.</span> = Wiederholung. Haken links = Thema verstanden (zählt zum Fortschritt).</p>
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
      <textarea class="topic-title" rows="1" data-change="title" ${a} aria-label="Name des Themas" maxlength="120" spellcheck="false">${esc(t.title)}</textarea>
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
        <span class="diff-btns">${[1, 2, 3, 4, 5].map(v => `<button type="button" class="${t.difficulty === v ? 'on' : ''}" data-action="set-diff" data-v="${v}" ${a} title="${DIFF[v]}" aria-pressed="${t.difficulty === v}">${v}</button>`).join('')}</span>
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
  const newFirst = d => (a, b) => (dayKind(a, d) === 'new' ? 0 : 1) - (dayKind(b, d) === 'new' ? 0 : 1);
  const rows = days.map(d => {
    const items = ex.topics.filter(t => t.days.includes(d)).sort(newFirst(d));
    const sessions = ex.sessions.filter(s => s.d === d);
    const cls = `${d === today ? 'today' : ''} ${d < today ? 'past' : ''}`;
    const content = sessions.map(s => sessionChip(ex, s)).join('') + items.map(t => dayChipNamed(ex, t, d)).join('');
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
  const kind = dayKind(t, d);
  const st = done ? 'done' : d < today ? 'missed' : '';
  return `<span class="daychip ${kind} ${st}"><button type="button" class="dc-main" data-action="toggle-day" data-ex="${ex.id}" data-t="${t.id}" data-day="${d}" aria-pressed="${done}">${done ? ic('check') : ''}<span class="dc-kind">${KIND_LABEL[kind]}</span>${esc(t.title)}</button></span>`;
}

function buildDayIndex() {
  const map = new Map();
  const get = d => { if (!map.has(d)) map.set(d, { exams: [], tasks: [], sessions: [] }); return map.get(d); };
  for (const ex of state.exams) {
    get(ex.date).exams.push(ex);
    for (const s of ex.sessions) get(s.d).sessions.push({ ex, s });
    for (const t of ex.topics) for (const d of t.days) get(d).tasks.push({ ex, t, done: t.doneDays.includes(d), kind: dayKind(t, d) });
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
  const empty = { exams: [], tasks: [], sessions: [] };

  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const info = idx.get(d) || empty;
    const inMonth = d.slice(0, 7) === ui.calMonth;
    const dots = info.sessions.map(x => `<i class="sess ${x.s.done ? 'done' : ''}" style="--c:${x.ex.color}"></i>`).join('')
      + info.tasks.slice(0, 6).map(x => `<i class="${x.kind} ${x.done ? 'done' : ''}" style="--c:${x.ex.color}"></i>`).join('')
      + (info.tasks.length > 6 ? `<em>+${info.tasks.length - 6}</em>` : '');
    cells += `<button type="button" class="cal-cell ${inMonth ? '' : 'out'} ${d === today ? 'today' : ''} ${d === ui.calSel ? 'sel' : ''}" data-action="cal-select" data-day="${d}" aria-label="${fmtLong(d)}">
      <span class="cal-num">${fromISO(d).getDate()}</span>
      ${info.exams.map(ex => `<span class="cal-exam" style="--c:${ex.color}">${esc(ex.subject)}</span>`).join('')}
      <span class="cal-dots">${dots}</span>
    </button>`;
  }

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
    <div class="legend"><span><i class="new"></i>neu lernen</span><span><i class="review"></i>wiederholen</span><span><i class="new done"></i>gelernt</span><span><i class="sess"></i>Probeklausur / Schwachstellen</span></div>
  </section>
  <section class="card">
    <div class="section-head"><h2>${fmtLong(ui.calSel)}</h2></div>
    ${dayAgenda(ui.calSel, 'Nichts geplant.')}
  </section>`;
}

// Mehrzeilige Themennamen: Höhe an den Inhalt anpassen
function autosize(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
const autosizeAll = () => $$('textarea.topic-title', app).forEach(autosize);

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
    commit(ex, t);
  },
  'remove-day': el => {
    const { ex, t } = ctx(el); if (!t) return;
    const d = el.dataset.day;
    t.days = t.days.filter(x => x !== d);
    t.doneDays = t.doneDays.filter(x => x !== d);
    commit(ex, t);
    toast(`${fmtShort(d)} bei „${t.title}“ entfernt.`);
  },
  'toggle-session': el => { const ex = examById(el.dataset.ex); const s = ex?.sessions.find(x => x.id === el.dataset.s); if (!s) return; s.done = !s.done; commit(ex); },
  'remove-session': el => {
    const ex = examById(el.dataset.ex); if (!ex) return;
    ex.sessions = ex.sessions.filter(x => x.id !== el.dataset.s);
    commit(ex);
  },
  'sort-topics': el => {
    const ex = examById(el.dataset.ex); if (!ex) return;
    // nummerierte Themen nach Nummer ordnen, unnummerierte bleiben an ihrem Platz
    const numbered = ex.topics.filter(t => numKey(t.title)).sort((a, b) => cmpKey(numKey(a.title), numKey(b.title)));
    ex.topics = ex.topics.map(t => (numKey(t.title) ? numbered.shift() : t));
    commit(ex);
  },
  'set-diff': el => { const { ex, t } = ctx(el); if (!t) return; t.difficulty = +el.dataset.v; commit(ex, t); },
  'del-topic': el => {
    const { ex, t } = ctx(el); if (!t) return;
    if (!confirm(`Thema „${t.title}“ löschen?`)) return;
    ex.topics = ex.topics.filter(x => x !== t);
    ex.deletedTopics[t.id] = Date.now();
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
  day: el => { const { ex, t } = ctx(el); if (!t) return; setDone(t, el.dataset.day, el.checked); commit(ex, t); },
  session: el => { const ex = examById(el.dataset.ex); const s = ex?.sessions.find(x => x.id === el.dataset.s); if (!s) return; s.done = el.checked; commit(ex); },
  understood: el => {
    const { ex, t } = ctx(el); if (!t) return;
    t.understood = el.checked;
    commit(ex, t);
    if (el.checked && progress(ex) >= 100) toast(`Alles verstanden – viel Erfolg in ${ex.subject}!`);
  },
  title: el => {
    const { ex, t } = ctx(el); if (!t) return;
    const v = el.value.trim();
    if (!v) { el.value = t.title; autosize(el); return; }
    t.title = v.replace(/\s+/g, ' ');
    touch(t); save(); scheduleSync();
  },
};
// Themenname: Enter speichert statt Zeilenumbruch, Höhe wächst mit
app.addEventListener('input', e => { if (e.target.matches('textarea.topic-title')) autosize(e.target); });
app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('textarea.topic-title')) { e.preventDefault(); e.target.blur(); } });
window.addEventListener('resize', autosizeAll);

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
  insertTopic(ex, newTopic(title));
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
  const planned = open.some(t => t.days.some(d => d >= from)) || ex.sessions.some(s => s.d >= from);
  if (planned && !confirm('Der Lernplan ab heute wird neu erstellt. Deine Änderungen ab heute gehen dabei verloren. Fortfahren?')) return;
  const r = planSpaced(ex, from, end);
  commit(ex);
  const extra = [r.mock && 'Probeklausur', r.weak && 'Schwachstellen-Tag'].filter(Boolean).join(' + ');
  toast(`Lernplan über ${r.days} ${r.days === 1 ? 'Tag' : 'Tage'} erstellt${extra ? ` (inkl. ${extra})` : ''}.`);
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
      ${isNew ? '' : '<p class="hint">Wenn du Datum oder Lernbeginn änderst, danach „Lernplan erstellen“ drücken.</p>'}
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
      const cur = examById(ex.id);
      closeModal();
      if (!cur) return;
      Object.assign(cur, fields);
      commit(cur);
    }
  });
  $('[data-m="delete"]', m)?.addEventListener('click', () => {
    if (!confirm(`„${ex.title} ${ex.subject}“ mit allen Themen und Dateien löschen?`)) return;
    state.exams = state.exams.filter(x => x.id !== ex.id);
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
    return `${head}<button type="button" class="pick ${wd === 0 || wd === 6 ? 'we' : ''}" data-d="${d}"><span class="pick-check">${ic('check')}</span><span class="pick-date">${fmtShort(d)}${d === today ? ' <em>heute</em>' : ''}</span><span class="pick-kind"></span></button>`;
  }).join('');
  const m = openModal({
    title: `Lerntage: ${t.title}`,
    body: `<p class="muted small" style="margin-top:0">Tag antippen = hinzufügen, nochmal antippen = entfernen. Der erste Tag ist „Neu“, alle weiteren sind Wiederholungen.</p>
      <div class="row gap" style="margin-bottom:6px"><button type="button" class="btn small" data-m="clear">Alle abwählen</button><span class="muted small" id="pickCount"></span></div>
      <div class="picker">${chips}</div>`,
    footer: `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="button" class="btn primary" data-m="save">Speichern</button>`,
  });
  const paint = () => {
    const first = [...sel].sort()[0];
    $$('.pick', m).forEach(b => {
      const on = sel.has(b.dataset.d);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      $('.pick-kind', b).textContent = on ? (b.dataset.d === first ? 'Neu' : 'Wdh.') : '';
    });
    $('#pickCount', m).textContent = sel.size ? `${sel.size} ${sel.size === 1 ? 'Tag' : 'Tage'} ausgewählt` : 'Kein Tag ausgewählt';
  };
  paint();
  $('.picker', m).addEventListener('click', e => {
    const b = e.target.closest('.pick'); if (!b) return;
    if (sel.has(b.dataset.d)) sel.delete(b.dataset.d); else sel.add(b.dataset.d);
    paint();
  });
  $('[data-m="clear"]', m).addEventListener('click', () => { sel.clear(); paint(); });
  $('[data-m="save"]', m).addEventListener('click', () => {
    const cur = examById(ex.id), ct = cur?.topics.find(x => x.id === t.id);
    closeModal();
    if (!ct) return toast('Das Thema wurde inzwischen gelöscht.', 'error');
    ct.days = [...sel].sort();
    ct.doneDays = ct.doneDays.filter(d => sel.has(d));
    commit(cur, ct);
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
    const cur = examById(ex.id);
    if (!cur) return closeModal();
    cur.materials.push(mat);
    commit(cur);
    openSuggest(cur, mat);
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

/* ---------- Themen aus Stoff erkennen ----------
   Ausgewertet wird die Struktur der Unterlage, nicht einzelne Wörter – in dieser Reihenfolge:
   1. Lesezeichen (Gliederung) der PDF   2. Inhaltsverzeichnis
   3. Folientitel (bei Foliensätzen)     4. Kapitelüberschriften (Nummerierung + Schriftgröße)
   Kopf-/Fußzeilen, Seitenzahlen, Daten, Namen, Dozenten- und Uni-Angaben werden herausgefiltert.
   Optional wertet Claude die Unterlage aus (eigener API-Schlüssel in den Einstellungen). */
const NUM_PREFIX = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\)?\s+(?=\S)/;
const numLevel = s => { const mm = String(s).match(NUM_PREFIX); return mm ? mm[1].split('.').filter(Boolean).length : 0; };
const cleanTitle = s => String(s).replace(/\s+/g, ' ')
  .replace(/^[\s•·▪●○◦■□►▸\-–—*]+/, '')
  .replace(/^(vorlesung|lecture|kapitel|chapter|teil|part|lektion|einheit|modul|thema|topic|abschnitt|section)\s+\d+\s*[:.\-–]\s*/i, '')
  .replace(/[\s.:,;·…]+$/, '')
  .trim();
// „2.1 Bäume (Forts.)“ und „Bäume – Teil 2“ zählen als dasselbe Thema wie „Bäume“
const baseTitle = s => cleanTitle(s).replace(NUM_PREFIX, '')
  .replace(/\s*[([]\s*(forts(\.|etzung)?|cont(\.|inued)?|teil\s*\d+|\d+\s*\/\s*\d+|\d+)\s*[)\]]$/i, '')
  .replace(/\s*[-–:,]\s*(forts(\.|etzung)?|teil\s*\d+|part\s*\d+)$/i, '')
  .trim();
const topicKey = s => norm(baseTitle(s));

const NOISE = [
  /^(seite|page|folie|slide|blatt)\s*\d+/i,
  /^\d+\s*(\/|von|of)\s*\d+$/i,
  /\b(prof|dr|dipl|m\.\s?sc|b\.\s?sc|m\.\s?ed|b\.\s?ed|stud)\./i,
  /\b(universit(ä|ae)t|university|hochschule|fakult(ä|ae)t|lehrstuhl|institut|fachbereich|department|gymnasium|gesamtschule|oberstufe|kolleg)\b/i,
  /\b(wintersemester|sommersemester|semester|wise|sose)\b/i,
  /\b(ws|ss)\s?\d{2}(\/\d{2,4})?\b/i,
  /\b\d{1,2}\.\s?\d{1,2}\.\s?(\d{2,4})?\b/,
  /\b(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+\d{4}\b/i,
  /@|https?:\/\/|www\.|\.(de|com|org|edu)\b/i,
  /©|copyright|all rights reserved|alle rechte|lizenz|license/i,
  /^(inhalt|inhaltsverzeichnis|inhaltsübersicht|gliederung|agenda|übersicht|overview|contents|table of contents|outline|lernziele|ziele|literatur|literaturverzeichnis|quellen|quellenverzeichnis|references|bibliography|anhang|appendix|danke|vielen dank|fragen|questions|thank you|ende|zusammenfassung|summary|einleitung|introduction|vorwort|organisatorisches|organisation)[?!.]*$/i,
  /^(vorlesung|lecture|kapitel|chapter|übung|uebung|tutorium|exercise|aufgabe|lösung|loesung|beispiel|example)\s*\d*$/i,
  /^(abb|abbildung|fig|figure|tab|tabelle|table|quelle|source)\.?\s*\d/i,
  /^(dozent|dozentin|referent|referentin|autor|autorin|author|name|datum|date|von|by|stand)\b\s*:?/i,
];
function isNoise(t) {
  if (t.length < 3 || t.length > 90) return true;
  const letters = (t.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
  if (letters < 3 || letters / t.replace(/\s/g, '').length < 0.55) return true; // Formeln, Code, Zahlenkolonnen
  return NOISE.some(re => re.test(t));
}
function dedupe(list) {
  const seen = new Set();
  return list.filter(c => {
    const k = topicKey(c.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Hierarchische Quellen auf Hauptthemen verdichten: Ebene 1 vorausgewählt, Unterpunkte optional.
function pickLevels(entries) {
  const lv = entries.map(e => e.level || 1);
  const min = Math.min(...lv);
  const top = entries.filter(e => (e.level || 1) === min).length;
  const main = top >= 3 || !entries.some(e => (e.level || 1) === min + 1) ? min : min + 1;
  return entries.map(e => ({ title: e.title, level: Math.max(1, (e.level || 1) - main + 1), checked: (e.level || 1) === main }))
    .filter(e => e.level <= 2);
}

function suggestFromText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  let structured = false, bullets = false;
  for (const l of lines) {
    let mm;
    if ((mm = l.match(/^(#{1,6})\s+(.+)/))) { out.push({ title: cleanTitle(mm[2]), level: mm[1].length, checked: true }); structured = true; }
    else if (NUM_PREFIX.test(l) && l.length <= 100 && !/[.;!?]$/.test(l)) { out.push({ title: cleanTitle(l), level: numLevel(l), checked: true }); structured = true; }
    else if ((mm = l.match(/^[-*•–·▪●○◦►▸]\s*(.+)/)) && mm[1].length <= 100) { out.push({ title: cleanTitle(mm[1]), level: 2, checked: null, kind: 'b' }); bullets = true; }
    else if (l.length <= 80 && !/[.!?]$/.test(l)) out.push({ title: cleanTitle(l), level: 2, checked: null, kind: 's' });
  }
  let res = out.filter(c => c.title.length >= 2);
  if (structured) res = pickLevels(res.filter(c => c.checked !== null));
  else res.forEach(c => { c.level = 1; c.checked = c.kind === 'b' || !bullets; });
  return { source: structured ? 'den Überschriften' : 'den Zeilen', items: dedupe(res).slice(0, 80) };
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

// Liest die PDF: Zeilen mit Schriftgröße und Position pro Seite, dazu die Lesezeichen.
async function extractPdf(buf) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 400); p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
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
    pages.push({
      w: vp.width, h: vp.height,
      rows: rows.map(r => {
        r.items.sort((a, b) => a.x - b.x);
        let text = '', end = null;
        for (const it of r.items) {
          if (end !== null && it.x - end > it.size * 0.2 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
          text += it.s;
          end = it.x + it.w;
        }
        return { text: text.replace(/\s+/g, ' ').trim(), size: r.size, x: r.items[0].x, y: r.y };
      }).filter(l => l.text),
    });
    page.cleanup();
  }
  let outline = [];
  try { outline = (await pdf.getOutline()) || []; } catch { /* keine Lesezeichen */ }
  pdf.destroy();
  return { pages, outline };
}

function fromOutline(outline) {
  let items = outline;
  while (items.length === 1 && items[0].items?.length) items = items[0].items; // nur Dokumenttitel → eine Ebene tiefer
  const entries = [];
  for (const it of items) {
    entries.push({ title: cleanTitle(it.title || ''), level: 1 });
    for (const c of it.items || []) entries.push({ title: cleanTitle(c.title || ''), level: 2 });
  }
  return entries.filter(e => !isNoise(e.title));
}

// Inhaltsverzeichnis: Zeilen der ersten Seiten, die mit einer Seitenzahl enden („2.1 Bäume ...... 14“)
function fromToc(pages) {
  const TOC_LINE = /^(.*?[A-Za-zÄÖÜäöüß].*?)(?:\s*[.·…_\s]{2,}\s*|\s+)(\d{1,4})$/;
  const entries = [];
  let found = false;
  for (const pg of pages.slice(0, 15)) {
    const hits = pg.rows.map(r => ({ r, m: r.text.match(TOC_LINE) })).filter(h => h.m && +h.m[2] <= pages.length + 30);
    const hasHead = pg.rows.some(r => /^(inhalt|inhaltsverzeichnis|contents|table of contents|gliederung|inhaltsübersicht)$/i.test(r.text.trim()));
    const leaders = hits.filter(h => /[.·…_]{3,}/.test(h.r.text)).length;
    if (hits.length >= 4 && (hasHead || leaders >= 3 || found)) {
      found = true;
      const xs = [...new Set(hits.map(h => Math.round(h.r.x / 8)))].sort((a, b) => a - b);
      for (const { r, m } of hits) {
        const title = cleanTitle(m[1].replace(/[.·…_]+$/, ''));
        const level = numLevel(title) || xs.indexOf(Math.round(r.x / 8)) + 1;
        entries.push({ title, level });
      }
    } else if (found) break;
  }
  return entries.filter(e => !isNoise(e.title));
}

// Schriftgröße des Fließtexts = nach Zeichen gewichteter Median
function bodySize(rows) {
  const by = [...rows].sort((a, b) => a.size - b.size);
  const total = sum(rows.map(r => r.text.length));
  let acc = 0;
  for (const r of by) { acc += r.text.length; if (acc >= total / 2) return r.size; }
  return by.length ? by[by.length - 1].size : 0;
}
// Kopf- und Fußzeilen: im oberen/unteren Seitenrand und auf vielen Seiten gleich (Zahlen zählen als gleich)
function repeatedLines(pages) {
  const inMargin = (r, pg) => r.y > pg.h * 0.92 || r.y < pg.h * 0.08;
  const key = r => norm(r.text.replace(/\d+/g, '#'));
  const freq = new Map();
  for (const pg of pages) for (const k of new Set(pg.rows.filter(r => inMargin(r, pg)).map(key))) freq.set(k, (freq.get(k) || 0) + 1);
  const limit = pages.length >= 4 ? Math.max(3, pages.length * 0.25) : Infinity;
  return (r, pg) => inMargin(r, pg) && ((freq.get(key(r)) || 0) >= limit || /^\d{1,4}$/.test(r.text.trim()));
}

// Foliensätze: Titel = größte Zeile im oberen Drittel jeder Folie. Abschnittsfolien (fast nur Titel) = Hauptthemen.
function fromSlides(pages) {
  const repeated = repeatedLines(pages);
  const body = bodySize(pages.flatMap(p => p.rows));
  const slides = pages.length > 3 ? pages.slice(1) : pages; // Titelfolie (Kurs, Dozent, Datum) überspringen
  const titles = [];
  slides.forEach((pg, i) => {
    const rows = pg.rows.filter(r => !repeated(r, pg));
    if (!rows.length) return;
    const section = rows.length <= 2; // Abschnittsfolie: nur ein (ggf. zweizeiliger) Titel
    const top = section ? rows : rows.filter(r => r.y >= pg.h * 0.6);
    if (!top.length) return;
    const max = Math.max(...top.map(r => r.size));
    if (max < body * 1.1) return;
    const lines = top.filter(r => r.size >= max * 0.95).slice(0, 2); // zweizeilige Titel zusammenführen
    const title = cleanTitle(lines.map(r => r.text).join(' '));
    if (isNoise(title)) return;
    titles.push({ title, page: i, section });
  });
  const groups = new Map();
  for (const t of titles) {
    const k = topicKey(t.title);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { title: t.title, count: 0, section: false, first: t.page });
    const g = groups.get(k);
    g.count++;
    g.section = g.section || t.section;
  }
  const list = [...groups.values()];
  const sections = list.filter(g => g.section);
  if (sections.length >= 3) {
    return list.map(g => ({ title: g.title, level: g.section ? 1 : 2, checked: g.section })).filter(g => g.level === 1 || list.length <= 40);
  }
  // Ohne Abschnittsfolien: Themen, die über mehrere Folien gehen, sind die Hauptthemen
  const ranked = [...list].sort((a, b) => b.count - a.count);
  const keep = new Set((list.length <= 10 ? list : ranked.slice(0, 10)).map(g => g.title));
  return list.map(g => ({ title: g.title, level: keep.has(g.title) ? 1 : 2, checked: keep.has(g.title) }));
}

// Dokumente: nummerierte Kapitelüberschriften bzw. deutlich größere Zeilen am linken Rand
function fromHeadings(pages) {
  const repeated = repeatedLines(pages);
  const all = pages.flatMap(p => p.rows);
  const body = bodySize(all);
  const docPages = pages.length > 2 ? pages.slice(1) : pages;
  const entries = [];
  for (const pg of docPages) {
    const xs = pg.rows.map(r => r.x).sort((a, b) => a - b);
    const margin = xs[Math.floor(xs.length * 0.1)] ?? 0;
    for (const r of pg.rows) {
      if (repeated(r, pg)) continue;
      const title = cleanTitle(r.text);
      if (isNoise(title) || /[.;!?,]$/.test(r.text)) continue;
      const lvl = numLevel(r.text);
      const big = r.size >= body * 1.2;
      const atMargin = r.x <= margin + 25;
      if (lvl && lvl <= 3 && r.size >= body * 0.98 && title.length <= 80) entries.push({ title, level: lvl, big });
      else if (big && atMargin && title.split(' ').length <= 10) entries.push({ title, level: r.size >= body * 1.5 ? 1 : 2, big });
    }
  }
  return entries;
}

function suggestFromPdf({ pages, outline }) {
  const tryList = [];
  const o = fromOutline(outline);
  if (o.length >= 3) tryList.push(['den Lesezeichen der PDF', pickLevels(o)]);
  const t = fromToc(pages);
  if (t.length >= 4) tryList.push(['dem Inhaltsverzeichnis', pickLevels(t)]);
  const rowsPerPage = pages.length ? sum(pages.map(p => p.rows.length)) / pages.length : 0;
  const slideish = pages.length >= 3 && (pages.filter(p => p.w > p.h).length > pages.length / 2 || rowsPerPage < 18);
  if (slideish) { const s = fromSlides(pages); if (s.length >= 2) tryList.push(['den Folientiteln', s]); }
  const h = fromHeadings(pages);
  if (h.length >= 3) tryList.push(['den Überschriften', pickLevels(h)]);
  if (!slideish && !tryList.length) { const s = fromSlides(pages); if (s.length >= 2) tryList.push(['den Folientiteln', s]); }
  if (!tryList.length) return { source: '', items: [] };
  const [source, items] = tryList[0];
  return { source, items: dedupe(items).slice(0, 80) };
}

/* KI-Auswertung mit Claude (eigener API-Schlüssel, Aufruf direkt aus dem Browser) */
const AI_MODELS = { 'claude-opus-5-5': 'Claude Opus 5.5 (genauer)', 'claude-haiku-5-5': 'Claude Haiku 5.5 (günstiger)' };
let claudePromise = null;
function loadClaude() {
  if (!claudePromise) {
    claudePromise = import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.134.0/+esm')
      .then(mod => mod.default || mod.Anthropic)
      .catch(() => { claudePromise = null; throw new Error('Claude-SDK konnte nicht geladen werden (Internet?).'); });
  }
  return claudePromise;
}
const TOPIC_SCHEMA = {
  type: 'object',
  properties: { topics: { type: 'array', items: { type: 'string' } } },
  required: ['topics'],
  additionalProperties: false,
};
async function aiTopics(ex, m) {
  const Anthropic = await loadClaude();
  const client = new Anthropic({ apiKey: cfg.aiKey, dangerouslyAllowBrowser: true });
  let source;
  if (m.type === 'pdf') {
    const blob = await getPdfBlob(ex, m);
    if (blob.size > 30 * 1048576) throw new Error('Die PDF ist für die KI zu groß (max. 30 MB).');
    source = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToB64(blob) } };
  } else {
    source = { type: 'text', text: `<lernunterlage>\n${m.text}\n</lernunterlage>` };
  }
  const params = {
    model: cfg.aiModel || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: TOPIC_SCHEMA } },
    system: 'Du hilfst Schülerinnen, Schülern und Studierenden, Lernunterlagen für die Klausurvorbereitung in Lernthemen zu gliedern.',
    messages: [{
      role: 'user',
      content: [source, {
        type: 'text',
        text: `Das ist Lernstoff für: ${ex.title || 'Klausur'} ${ex.subject}.\nNenne die 3–10 Hauptthemen dieser Lernunterlage als kurze Titel (höchstens 60 Zeichen, auf Deutsch, in der Reihenfolge der Unterlage). Übernimm vorhandene Kapitelnummern. Organisatorisches wie Dozent, Termine, Literatur oder Inhaltsverzeichnis ist kein Thema.`,
      }],
    }],
  };
  let resp;
  try {
    // Opus: Ablehnungen durch Sicherheitsfilter fängt die API mit einem Ausweichmodell ab (Haiku hat keins)
    resp = params.model === 'claude-opus-5-5'
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (err) {
    if (err?.status === 401) throw new Error('Claude-API-Schlüssel ist ungültig.');
    if (err?.status === 400 && /fallback/i.test(err.message || '')) resp = await client.messages.create(params);
    else throw new Error(`KI-Fehler: ${err?.message || err}`);
  }
  if (resp.stop_reason === 'refusal') throw new Error('Die KI hat diese Unterlage nicht ausgewertet.');
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let topics;
  try { topics = JSON.parse(text).topics; } catch { throw new Error('Die Antwort der KI war unvollständig – bitte nochmal versuchen.'); }
  return { source: 'KI', items: dedupe(topics.map(t => ({ title: cleanTitle(t), level: 1, checked: true })).filter(c => c.title)) };
}

async function openSuggest(ex, m) {
  const modal = openModal({ title: 'Themen vorschlagen', wide: true, body: '' });
  const body = $('.modal-body', modal);
  let cands = [], source = '';
  const loading = msg => { body.innerHTML = `<div class="loading"><div class="spinner"></div>${msg}</div>`; };
  const fail = err => { if (modal.isConnected) body.innerHTML = `<div class="status-box error">${esc(err.message || 'Datei konnte nicht gelesen werden.')}</div>${aiButton()}`; };
  const aiButton = () => (cfg.aiKey
    ? `<button type="button" class="btn small" data-s="ai">${ic('wand')}Mit KI erkennen</button>`
    : `<p class="muted small">Tipp: Mit einem Claude-API-Schlüssel (Einstellungen) erkennt eine KI die Hauptthemen.</p>`);

  const exists = new Set(ex.topics.map(t => topicKey(t.title)));
  const show = res => {
    if (!modal.isConnected) return;
    source = res.source;
    cands = res.items.map(c => ({ ...c, exists: exists.has(topicKey(c.title)) }));
    cands.forEach(c => { if (c.exists) c.checked = false; });
    paint();
  };
  // Eingaben vor dem Neuzeichnen übernehmen
  const collect = () => $$('.sugg', body).forEach(row => {
    const c = cands[+row.dataset.i];
    if (!c) return;
    c.checked = $('input[type="checkbox"]', row).checked;
    c.title = $('input[type="text"]', row).value;
  });
  function paint() {
    body.innerHTML = `${cands.length
      ? `<p class="muted small" style="margin-top:0">${source === 'KI' ? '<strong>Von der KI (Claude) erkannt</strong>' : `Erkannt aus <strong>${esc(source)}</strong>`} in „${esc(m.name)}“. Häkchen = übernehmen. Namen kannst du direkt ändern.</p>`
      : `<div class="status-box">In „${esc(m.name)}“ wurde keine Gliederung gefunden (z. B. bei eingescannten PDFs). Du kannst die Themen unten selbst eintragen${cfg.aiKey ? ' oder die KI fragen' : ''}.</div>`}
      <div class="sugg-tools">
        ${cands.length ? '<button type="button" class="btn small" data-s="all">Alle</button><button type="button" class="btn small" data-s="none">Keine</button>' : ''}
        <span class="spacer"></span>${source !== 'KI' ? aiButton() : ''}
      </div>
      <div class="sugg-list">${cands.map((c, i) => `<div class="sugg ${c.checked ? '' : 'off'} lvl${c.level || 1}" data-i="${i}">
        <input type="checkbox" ${c.checked ? 'checked' : ''} aria-label="Übernehmen">
        <input type="text" value="${esc(c.title)}" maxlength="120" aria-label="Themenname">
        ${c.exists ? '<span class="exists">schon da</span>' : ''}
        <button type="button" class="tool" data-s="del" aria-label="Vorschlag entfernen">${ic('x')}</button>
      </div>`).join('')}</div>
      <form class="add-topic" data-s-form><input type="text" placeholder="Thema ergänzen" maxlength="120" aria-label="Thema ergänzen"><button type="submit" class="btn">${ic('plus')}<span>Ergänzen</span></button></form>`;
    update();
  }
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  foot.innerHTML = `<span class="spacer"></span><button type="button" class="btn ghost" data-close>Abbrechen</button><button type="button" class="btn primary" data-s="apply"></button>`;
  modal.appendChild(foot);
  const applyBtn = $('[data-s="apply"]', foot);
  function update() {
    const n = $$('.sugg input[type="checkbox"]:checked', body).length;
    applyBtn.textContent = n ? `${n} ${n === 1 ? 'Thema' : 'Themen'} übernehmen` : 'Nichts ausgewählt';
    applyBtn.disabled = !n;
    $$('.sugg', body).forEach(row => row.classList.toggle('off', !$('input[type="checkbox"]', row).checked));
  }
  body.addEventListener('change', e => { if (e.target.type === 'checkbox') update(); });
  body.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('input', e.target);
    const title = cleanTitle(input.value);
    if (!title) return;
    collect();
    cands.push({ title, level: 1, checked: true });
    paint();
    $('[data-s-form] input', body).focus();
  });
  body.addEventListener('click', async e => {
    const s = e.target.closest('[data-s]')?.dataset.s;
    if (s === 'all' || s === 'none') { $$('.sugg input[type="checkbox"]', body).forEach(cb => { cb.checked = s === 'all'; }); update(); }
    if (s === 'del') { collect(); cands.splice(+e.target.closest('.sugg').dataset.i, 1); paint(); }
    if (s === 'ai') {
      loading('Die KI liest den Stoff …');
      try { show(await aiTopics(ex, m)); } catch (err) { fail(err); }
    }
  });
  applyBtn.addEventListener('click', () => {
    collect();
    const target = examById(ex.id); // falls zwischendurch synchronisiert wurde
    if (!target) return closeModal();
    const titles = cands.filter(c => c.checked).map(c => cleanTitle(c.title)).filter(Boolean);
    titles.forEach(t => insertTopic(target, newTopic(t)));
    closeModal();
    commit(target);
    toast(`${titles.length} ${titles.length === 1 ? 'Thema' : 'Themen'} hinzugefügt. Jetzt Schwierigkeit einstellen und „Lernplan erstellen“.`);
  });

  loading(m.type === 'pdf' ? 'PDF wird gelesen …' : 'Text wird analysiert …');
  try {
    show(m.type === 'text' ? suggestFromText(m.text) : suggestFromPdf(await extractPdf(await (await getPdfBlob(ex, m)).arrayBuffer())));
  } catch (err) { fail(err); }
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

// Zusammenführen: Klausur-Felder (Name, Datum, Reihenfolge, Stoff, Sitzungen) nach der zuletzt
// geänderten Klausur, Themen einzeln nach ihrem eigenen Zeitstempel. Löschungen über Grabsteine.
const examTime = ex => Math.max(ex.updatedAt || 0, ...ex.topics.map(t => t.updatedAt || 0));
function mergeExam(x, y) {
  const [win, lose] = (y.updatedAt || 0) > (x.updatedAt || 0) ? [y, x] : [x, y];
  const deletedTopics = { ...lose.deletedTopics };
  for (const [k, v] of Object.entries(win.deletedTopics || {})) deletedTopics[k] = Math.max(deletedTopics[k] || 0, v);
  const byId = new Map();
  for (const t of [...win.topics, ...lose.topics]) {
    const cur = byId.get(t.id);
    if (!cur || (t.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(t.id, t);
  }
  const winIds = new Set(win.topics.map(t => t.id));
  const order = [...winIds, ...lose.topics.map(t => t.id).filter(id => !winIds.has(id))];
  const topics = order.map(id => byId.get(id)).filter(t => !(deletedTopics[t.id] >= (t.updatedAt || 0)));
  const materials = win.materials.map(m => {
    const om = lose.materials.find(o => o.id === m.id);
    return m.pending && om && !om.pending ? { ...m, pending: false, path: om.path } : m;
  });
  return { ...win, topics, materials, deletedTopics };
}
function merge(a, b) {
  const deleted = { ...a.deleted };
  for (const [k, v] of Object.entries(b.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, v);
  const A = new Map(a.exams.map(e => [e.id, e])), B = new Map(b.exams.map(e => [e.id, e]));
  const exams = [];
  for (const id of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(id), y = B.get(id);
    let ex = x && y ? mergeExam(x, y) : x || y;
    if (x && y) { // unverändert → vorhandenes Objekt behalten
      const js = JSON.stringify(ex);
      if (js === JSON.stringify(y)) ex = y; else if (js === JSON.stringify(x)) ex = x;
    }
    if (deleted[id] >= examTime(ex)) continue;
    exams.push(ex);
  }
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
  // Nicht verbunden: grauer Punkt. Verbunden: Wolke (grün mit Haken = synchronisiert).
  const mark = { ok: 'M9.2 13.6l2.1 2.1 3.9-3.9', error: 'M12 10.4v3.2M12 16.3v.01', offline: 'M4.5 4.5l15 15', busy: '' }[s];
  const icon = s === 'local' ? '<span class="dot"></span>'
    : `<svg class="ic cloud" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 18.5h10.1a4.2 4.2 0 0 0 .5-8.37 6 6 0 0 0-11.56 1.1A3.65 3.65 0 0 0 7.2 18.5z"/>${mark ? `<path d="${mark}"/>` : ''}</svg>`;
  btn.className = `sync ${s}`;
  btn.innerHTML = `${icon}<span class="label">${label}</span>`;
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
  cfg = { ...cfg, owner: owner.trim(), repo: repo.trim(), token: token.trim(), branch: '' };
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
function setupCode() { return SETUP_PREFIX + btoa(JSON.stringify({ o: cfg.owner, r: cfg.repo, t: cfg.token, ...(cfg.aiKey ? { k: cfg.aiKey, km: cfg.aiModel } : {}) })); }
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
      <p class="muted small">Statt alles abzutippen: Code hier kopieren, an dich selbst schicken und auf dem anderen Gerät einfügen. Der Code enthält deinen Token (und ggf. den Claude-Schlüssel) – behandle ihn wie ein Passwort.</p>
      ${configured() ? '<button type="button" class="btn small" data-m="copy">Einrichtungscode kopieren</button>' : ''}
      <div class="row gap" style="margin-top:8px"><input type="text" id="codeIn" placeholder="Einrichtungscode einfügen (LP1.…)" autocomplete="off" spellcheck="false"><button type="button" class="btn" data-m="usecode">Verbinden</button></div>
      <hr>
      <h3>KI-Themenerkennung (optional)</h3>
      <p class="muted small">Mit einem eigenen Claude-API-Schlüssel liest eine KI deine Unterlagen und schlägt die Hauptthemen vor. Der Schlüssel bleibt auf diesem Gerät und wird nicht ins Daten-Repo synchronisiert. Jede Auswertung kostet ein paar Cent auf deinem Anthropic-Konto. Schlüssel gibt es unter <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
      <form id="aiForm" class="form">
        <label class="field"><span>Claude-API-Schlüssel</span><input type="password" name="key" value="${esc(cfg.aiKey)}" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"></label>
        <label class="field"><span>Modell</span><select name="model">${Object.entries(AI_MODELS).map(([id, label]) => `<option value="${id}" ${cfg.aiModel === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <div class="row gap wrap"><button type="submit" class="btn">Speichern</button>${cfg.aiKey ? '<button type="button" class="btn ghost danger" data-m="aidel">Schlüssel entfernen</button>' : ''}</div>
      </form>
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
    cfg = { ...cfg, token: '', branch: '' };
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
    if (j.k) { cfg.aiKey = j.k; cfg.aiModel = AI_MODELS[j.km] ? j.km : cfg.aiModel; LS.set(CFG_KEY, cfg); }
    try { await connect(j.o, j.r, j.t); closeModal(); toast('Verbunden – Daten werden synchronisiert.'); render(); }
    catch (err) { busy(e.target, false, 'Verbinden'); toast(err.message, 'error'); }
  });
  $('#aiForm', m).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements;
    cfg.aiKey = f.key.value.trim();
    cfg.aiModel = f.model.value;
    LS.set(CFG_KEY, cfg);
    toast(cfg.aiKey ? 'KI-Themenerkennung ist eingerichtet.' : 'Kein Schlüssel gespeichert.');
  });
  $('[data-m="aidel"]', m)?.addEventListener('click', () => {
    cfg.aiKey = '';
    LS.set(CFG_KEY, cfg);
    closeModal();
    toast('Claude-Schlüssel entfernt.');
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
  if (e.key === CFG_KEY) { cfg = Object.assign({}, CFG_DEFAULT, LS.get(CFG_KEY) || {}); renderSync(); }
});
setInterval(() => { if (configured() && document.visibilityState === 'visible' && !syncing) sync(); }, 120000);

render();
if (configured()) { lastFocusSync = Date.now(); sync(); }
