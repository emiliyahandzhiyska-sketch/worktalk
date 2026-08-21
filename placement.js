// WorkTalk Placement Test — a standalone 40-question CEFR assessment.
// Deliberately separate from the learning app: no flashcards, no hints,
// no feedback until the end, one attempt per 30 days.

const TEST_MINUTES = 15;
const TOTAL_QUESTIONS = 40;
const RETAKE_DAYS = 30;

const K = {
  progress: 'worktalk_placement_progress', // in-flight attempt
  result:   'worktalk_placement_result',   // finished attempt (also the lock)
  team:     'worktalk_placement_team'      // codes pasted into the employer view
};

// Score bands agreed with the school
const BANDS = [
  { min: 35, level: 'C1', label: 'Advanced' },
  { min: 28, level: 'B2', label: 'Upper intermediate' },
  { min: 20, level: 'B1', label: 'Intermediate' },
  { min: 12, level: 'A2', label: 'Elementary' },
  { min: 0,  level: 'A1', label: 'Beginner' }
];

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1'];
const TYPE_LABEL = { grammar: 'Grammar', vocabulary: 'Workplace vocabulary', reading: 'Reading comprehension' };

let data = null;
let state = null; // { name, order, answers, started, readingShown }

// ---------- Helpers ----------

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || fallback); }
  catch { return JSON.parse(fallback); }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bandFor(score) {
  return BANDS.find(b => score >= b.min);
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Result codes travel by email or chat, so they must survive Cyrillic names
function encodeResult(r) {
  const compact = { n: r.name, s: r.score, g: r.byType.grammar, v: r.byType.vocabulary, rd: r.byType.reading, d: r.ts };
  return 'WT1-' + btoa(unescape(encodeURIComponent(JSON.stringify(compact))));
}

function decodeResult(code) {
  const raw = code.trim().replace(/^WT1-/, '');
  if (!raw) return null;
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (typeof o.s !== 'number' || !o.n) return null;
    return {
      name: o.n, score: o.s, ts: o.d,
      byType: { grammar: o.g || 0, vocabulary: o.v || 0, reading: o.rd || 0 }
    };
  } catch { return null; }
}

// ---------- Boot ----------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('placement.json');
    if (!res.ok) throw new Error(res.statusText);
    data = await res.json();
  } catch {
    document.getElementById('app').innerHTML = card(
      '<p class="font-bold mb-2">Couldn\'t load the test</p>' +
      '<p class="text-sm text-slate-500">Open this page through a web address, not as a local file.</p>');
    return;
  }

  // Both forms work: clean-URL redirects sometimes drop the query string,
  // so the hash is the reliable one to share.
  if (new URLSearchParams(location.search).has('team') || location.hash === '#team') {
    renderTeam();
    return;
  }

  const saved = localStorage.getItem(K.progress);
  if (saved) { state = JSON.parse(saved); resumeOrExpire(); return; }

  const done = readJson(K.result, 'null');
  if (done && Date.now() - done.ts < RETAKE_DAYS * 86400000) { renderResult(done, true); return; }

  renderStart();
});

function card(inner, extra = '') {
  return `<div class="bg-white dark:bg-slate-900 rounded-2xl shadow-md border border-slate-200 dark:border-slate-800 p-6 ${extra}">${inner}</div>`;
}

// ---------- Start ----------

function renderStart() {
  document.getElementById('testBar').classList.add('hidden');
  document.getElementById('app').innerHTML = card(`
    <div class="fade-in">
      <h2 class="text-lg font-extrabold mb-3">Before you begin</h2>
      <ul class="text-sm space-y-2 mb-5 text-slate-600 dark:text-slate-300">
        <li><b>40 questions</b> — grammar, workplace vocabulary and one reading passage.</li>
        <li><b>15 minutes.</b> The test submits itself when the time is up.</li>
        <li><b>No feedback during the test.</b> You'll see your level at the end.</li>
        <li><b>One attempt.</b> You can retake it after ${RETAKE_DAYS} days.</li>
        <li>Don't look anything up. A wrong answer costs nothing; a guessed one gives you the wrong course.</li>
      </ul>
      <label class="block text-xs font-semibold mb-1.5 text-slate-600 dark:text-slate-300">Your full name</label>
      <input id="nameInput" type="text" placeholder="e.g. Maria Petrova" autocomplete="name"
        class="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm mb-1 focus:outline-none focus:border-brand-500">
      <p id="nameError" class="hidden text-xs text-rose-500 mb-2"></p>
      <button id="startBtn" class="w-full mt-3 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">
        Start the test
      </button>
    </div>`);

  document.getElementById('startBtn').addEventListener('click', beginTest);
  document.getElementById('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') beginTest();
  });
}

function beginTest() {
  const name = document.getElementById('nameInput').value.trim();
  const err = document.getElementById('nameError');
  if (name.length < 2) {
    err.textContent = 'Please enter your name so the report can be identified.';
    err.classList.remove('hidden');
    return;
  }

  // Grammar and vocabulary are shuffled together so levels are mixed.
  // The reading block stays last: its questions share one passage.
  const mixed = shuffle(data.questions).map(prepare);
  const reading = data.reading.questions.map(prepare);

  state = {
    name: name.slice(0, 60),
    order: [...mixed, ...reading],
    answers: {},
    started: Date.now(),
    index: 0
  };
  saveProgress();
  renderQuestion();
}

// Correct answers are authored at index 0, so shuffle every option list
function prepare(q) {
  const right = q.options[0];
  const options = shuffle(q.options);
  return { id: q.id, type: q.type, level: q.level, q: q.q, options, correct: options.indexOf(right) };
}

function saveProgress() {
  localStorage.setItem(K.progress, JSON.stringify(state));
}

function resumeOrExpire() {
  if (secondsLeft() <= 0) { finishTest(); return; }
  // Land on the first unanswered question rather than where they left off
  const firstOpen = state.order.findIndex(q => state.answers[q.id] === undefined);
  state.index = firstOpen === -1 ? state.order.length - 1 : firstOpen;
  renderQuestion();
}

// ---------- Timer ----------

let timerId = null;

function secondsLeft() {
  return Math.max(0, TEST_MINUTES * 60 - Math.floor((Date.now() - state.started) / 1000));
}

function startTimer() {
  clearInterval(timerId);
  const tick = () => {
    const s = secondsLeft();
    const el = document.getElementById('timer');
    if (el) {
      const m = Math.floor(s / 60);
      el.textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
      el.className = 'tabular-nums font-bold ' + (s <= 60 ? 'text-rose-500' : 'text-slate-600 dark:text-slate-300');
    }
    if (s <= 0) { clearInterval(timerId); finishTest(); }
  };
  tick();
  timerId = setInterval(tick, 1000);
}

// ---------- Questions ----------

function renderQuestion() {
  const bar = document.getElementById('testBar');
  bar.classList.remove('hidden');

  const q = state.order[state.index];
  const answered = Object.keys(state.answers).length;
  document.getElementById('progressLabel').textContent =
    `Question ${state.index + 1} of ${TOTAL_QUESTIONS} · ${answered} answered`;
  document.getElementById('progressBar').style.width = `${(state.index / TOTAL_QUESTIONS) * 100}%`;
  startTimer();

  const isReading = q.type === 'reading';
  const firstReading = isReading && state.order.findIndex(x => x.type === 'reading') === state.index;
  const chosen = state.answers[q.id];

  document.getElementById('app').innerHTML = `
    <div class="fade-in">
      ${firstReading ? `
        <div class="rounded-2xl bg-brand-50 dark:bg-slate-800 p-4 mb-4">
          <p class="text-sm font-bold">📖 Reading section</p>
          <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">The last 8 questions are about the passage below. It stays on screen while you answer.</p>
        </div>` : ''}

      ${isReading ? `
        <div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 mb-4 max-h-56 overflow-y-auto">
          <p class="font-extrabold text-sm mb-2">${esc(data.reading.title)}</p>
          ${data.reading.text.split('\n\n').map(p => `<p class="text-sm leading-relaxed mb-2">${esc(p)}</p>`).join('')}
        </div>` : ''}

      ${card(`
        <p class="text-base font-semibold leading-relaxed mb-5">${esc(q.q)}</p>
        <div class="space-y-2.5">
          ${q.options.map((opt, i) => `
            <button onclick="choose(${i})"
              class="w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                chosen === i
                  ? 'border-brand-500 bg-brand-50 dark:bg-slate-800'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-brand-500'}">
              ${esc(opt)}
            </button>`).join('')}
        </div>`)}

      <div class="flex items-center justify-between gap-3 mt-4">
        <button onclick="goBack()" ${state.index === 0 ? 'disabled' : ''}
          class="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-semibold text-sm ${state.index === 0 ? 'opacity-40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}">← Back</button>
        ${state.index === state.order.length - 1
          ? `<button onclick="confirmFinish()" class="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm transition-colors">Finish and see my level</button>`
          : `<button onclick="goNext()" class="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">Next →</button>`}
      </div>
      <p class="text-[11px] text-slate-400 mt-3 text-center">You can go back and change answers until you finish.</p>
    </div>`;
}

function choose(i) {
  const q = state.order[state.index];
  state.answers[q.id] = i;
  saveProgress();
  // Auto-advance keeps the pace up, except on the very last question
  if (state.index < state.order.length - 1) { state.index++; renderQuestion(); }
  else renderQuestion();
}

function goNext() {
  if (state.index < state.order.length - 1) { state.index++; renderQuestion(); }
}

function goBack() {
  if (state.index > 0) { state.index--; renderQuestion(); }
}

function confirmFinish() {
  const unanswered = state.order.filter(q => state.answers[q.id] === undefined).length;
  if (unanswered && !confirm(`${unanswered} question${unanswered > 1 ? 's are' : ' is'} still unanswered. Finish anyway?`)) return;
  finishTest();
}

// ---------- Scoring ----------

function finishTest() {
  clearInterval(timerId);

  const byType = { grammar: 0, vocabulary: 0, reading: 0 };
  const totalByType = { grammar: 0, vocabulary: 0, reading: 0 };
  const byLevel = {}; const totalByLevel = {};
  let score = 0;

  for (const q of state.order) {
    totalByType[q.type]++;
    totalByLevel[q.level] = (totalByLevel[q.level] || 0) + 1;
    if (state.answers[q.id] === q.correct) {
      score++; byType[q.type]++;
      byLevel[q.level] = (byLevel[q.level] || 0) + 1;
    } else if (byLevel[q.level] === undefined) {
      byLevel[q.level] = 0;
    }
  }

  const result = {
    name: state.name, score, ts: Date.now(),
    byType, totalByType, byLevel, totalByLevel,
    answered: Object.keys(state.answers).length
  };

  localStorage.setItem(K.result, JSON.stringify(result));
  localStorage.removeItem(K.progress);
  state = null;
  renderResult(result, false);
}

// ---------- Result and employer report ----------

function renderResult(r, locked) {
  clearInterval(timerId);
  document.getElementById('testBar').classList.add('hidden');

  const band = bandFor(r.score);
  const pct = t => r.totalByType[t] ? Math.round(r.byType[t] / r.totalByType[t] * 100) : 0;

  // Strengths and weaknesses come from the three content areas
  const areas = Object.keys(TYPE_LABEL)
    .map(t => ({ t, pct: pct(t), got: r.byType[t], of: r.totalByType[t] }))
    .sort((a, b) => b.pct - a.pct);
  const strongest = areas[0], weakest = areas[areas.length - 1];

  const levelRows = LEVEL_ORDER.filter(l => r.totalByLevel[l]).map(l => {
    const got = r.byLevel[l] || 0, of = r.totalByLevel[l];
    const p = Math.round(got / of * 100);
    return `
      <div class="flex items-center gap-2">
        <span class="w-7 text-xs font-bold text-slate-500">${l}</span>
        <div class="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div class="h-full rounded-full ${p >= 70 ? 'bg-emerald-500' : p >= 40 ? 'bg-amber-500' : 'bg-rose-500'}" style="width:${p}%"></div>
        </div>
        <span class="w-12 text-right text-xs text-slate-500">${got}/${of}</span>
      </div>`;
  }).join('');

  const areaRows = areas.map(a => `
    <div class="flex items-center gap-2">
      <span class="w-40 text-xs font-semibold truncate">${TYPE_LABEL[a.t]}</span>
      <div class="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div class="h-full rounded-full bg-brand-500" style="width:${a.pct}%"></div>
      </div>
      <span class="w-12 text-right text-xs text-slate-500">${a.got}/${a.of}</span>
    </div>`).join('');

  const retakeOn = fmtDate(r.ts + RETAKE_DAYS * 86400000);

  document.getElementById('app').innerHTML = `
    <div class="fade-in">
      ${locked ? `<div class="rounded-2xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 p-4 mb-4 no-print">
        <p class="text-sm font-bold text-amber-900 dark:text-amber-200">You've already taken this test</p>
        <p class="text-xs text-amber-800 dark:text-amber-300 mt-1">Your result from ${fmtDate(r.ts)} is below. You can retake it on <b>${retakeOn}</b>.</p>
      </div>` : ''}

      <div id="report" class="bg-white text-slate-800 rounded-2xl p-6 sm:p-10 shadow-2xl">
        <div class="flex items-start justify-between border-b border-slate-200 pb-4 mb-5">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-brand-600 font-bold">Language Workshop</p>
            <h2 class="text-xl font-extrabold tracking-tight mt-0.5">English Placement Report</h2>
          </div>
          <div class="text-right text-xs text-slate-500">
            <p class="font-bold text-slate-800 text-sm">${esc(r.name)}</p>
            <p>${fmtDate(r.ts)}</p>
          </div>
        </div>

        <div class="text-center py-4 mb-5 rounded-2xl bg-brand-50">
          <p class="text-[10px] uppercase tracking-widest text-slate-500">Assessed level</p>
          <p class="text-5xl font-extrabold text-brand-700 my-1">${band.level}</p>
          <p class="text-sm font-semibold text-slate-600">${band.label}</p>
          <p class="text-xs text-slate-500 mt-2">${r.score} correct out of ${TOTAL_QUESTIONS}${r.answered < TOTAL_QUESTIONS ? ` · ${r.answered} answered` : ''}</p>
        </div>

        <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">By skill area</p>
        <div class="space-y-2 mb-5">${areaRows}</div>

        <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">By question level</p>
        <div class="space-y-2 mb-5">${levelRows}</div>

        <div class="grid sm:grid-cols-2 gap-3 mb-5">
          <div class="rounded-xl bg-emerald-50 p-3">
            <p class="text-[10px] uppercase tracking-widest text-emerald-700 font-bold mb-1">Strongest area</p>
            <p class="text-sm font-semibold">${TYPE_LABEL[strongest.t]}</p>
            <p class="text-xs text-slate-600">${strongest.got} of ${strongest.of} correct (${strongest.pct}%)</p>
          </div>
          <div class="rounded-xl bg-amber-50 p-3">
            <p class="text-[10px] uppercase tracking-widest text-amber-700 font-bold mb-1">Needs most work</p>
            <p class="text-sm font-semibold">${TYPE_LABEL[weakest.t]}</p>
            <p class="text-xs text-slate-600">${weakest.got} of ${weakest.of} correct (${weakest.pct}%)</p>
          </div>
        </div>

        <p class="text-xs text-slate-500 leading-relaxed">${recommendation(band.level, weakest)}</p>

        <div class="flex items-end justify-between text-xs text-slate-500 pt-5 mt-5 border-t border-slate-200">
          <p>40-question placement test · ${TEST_MINUTES} minutes</p>
          <p class="font-semibold text-slate-700">Language Workshop</p>
        </div>
      </div>

      <div class="no-print mt-4 bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-lg">
        <div class="flex flex-wrap gap-2">
          <button onclick="window.print()" class="flex-1 min-w-[140px] py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">🖨 Print or save as PDF</button>
          <button id="copyCodeBtn" class="px-5 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-sm">📋 Copy result code</button>
        </div>
        <p class="text-[11px] text-slate-400 mt-2">Send the result code to your employer or teacher so they can add it to the team report.</p>
        <p class="text-[11px] text-slate-400 mt-2"><a href="#team" onclick="setTimeout(()=>location.reload(),0)" class="font-semibold text-brand-500 hover:underline">Building a team report?</a></p>
      </div>
    </div>`;

  document.getElementById('copyCodeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('copyCodeBtn');
    try { await navigator.clipboard.writeText(encodeResult(r)); btn.textContent = '✅ Copied'; }
    catch { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = '📋 Copy result code'; }, 1800);
  });
}

function recommendation(level, weakest) {
  const start = {
    A1: 'Start with Everyday Workplace English and the A2 cards.',
    A2: 'Start with Everyday Workplace English, filtering cards to A2 and B1.',
    B1: 'Start with Everyday Workplace English at B1, then move into a department topic.',
    B2: 'Go straight to a department topic (Sales, HR, Finance) and filter to B2.',
    C1: 'Work in the specialist topics — Legal, IT and Accounting carry most of the C1 language.'
  }[level];
  const fix = {
    grammar: 'The Grammar tab is the fastest way to close the gap.',
    vocabulary: 'Daily flashcard review will move this fastest.',
    reading: 'The Reading exercises in Use of English target this directly.'
  }[weakest.t];
  return `<b>Recommended next step:</b> ${start} ${fix}`;
}

// ---------- Employer / team view ----------

function renderTeam(notice) {
  document.getElementById('testBar').classList.add('hidden');
  const codes = readJson(K.team, '[]');
  const people = codes.map(decodeResult).filter(Boolean);

  let body;
  if (!people.length) {
    body = '<p class="text-sm text-slate-500 dark:text-slate-400">No results added yet. Paste the codes your team members sent you.</p>';
  } else {
    const avg = people.reduce((s, p) => s + p.score, 0) / people.length;
    const avgBand = bandFor(Math.round(avg));

    const dist = {};
    for (const p of people) { const l = bandFor(p.score).level; dist[l] = (dist[l] || 0) + 1; }

    const areaAvg = t => Math.round(people.reduce((s, p) => s + p.byType[t], 0) / people.length * 10) / 10;
    const areaTotals = { grammar: 20, vocabulary: 12, reading: 8 };
    const areas = Object.keys(TYPE_LABEL)
      .map(t => ({ t, avg: areaAvg(t), of: areaTotals[t], pct: Math.round(areaAvg(t) / areaTotals[t] * 100) }))
      .sort((a, b) => b.pct - a.pct);

    body = `
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
        <div class="rounded-xl bg-brand-50 py-3 text-center">
          <p class="text-2xl font-extrabold text-brand-700">${avgBand.level}</p>
          <p class="text-[10px] uppercase tracking-widest text-slate-500">team average</p>
        </div>
        <div class="rounded-xl bg-slate-50 py-3 text-center">
          <p class="text-2xl font-extrabold text-slate-700">${people.length}</p>
          <p class="text-[10px] uppercase tracking-widest text-slate-500">people tested</p>
        </div>
        <div class="rounded-xl bg-slate-50 py-3 text-center">
          <p class="text-2xl font-extrabold text-slate-700">${avg.toFixed(1)}</p>
          <p class="text-[10px] uppercase tracking-widest text-slate-500">avg score / 40</p>
        </div>
      </div>

      <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Level distribution</p>
      <div class="space-y-2 mb-5">
        ${LEVEL_ORDER.map(l => {
          const n = dist[l] || 0;
          return `<div class="flex items-center gap-2">
            <span class="w-7 text-xs font-bold text-slate-500">${l}</span>
            <div class="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full rounded-full bg-brand-500" style="width:${n / people.length * 100}%"></div>
            </div>
            <span class="w-8 text-right text-xs text-slate-500">${n}</span>
          </div>`;
        }).join('')}
      </div>

      <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Team average by skill area</p>
      <div class="space-y-2 mb-5">
        ${areas.map(a => `
          <div class="flex items-center gap-2">
            <span class="w-40 text-xs font-semibold truncate">${TYPE_LABEL[a.t]}</span>
            <div class="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full rounded-full bg-brand-500" style="width:${a.pct}%"></div>
            </div>
            <span class="w-14 text-right text-xs text-slate-500">${a.avg}/${a.of}</span>
          </div>`).join('')}
      </div>
      <p class="text-xs text-slate-500 mb-5"><b>Weakest area across the team:</b> ${TYPE_LABEL[areas[areas.length - 1].t]}. Worth building the group programme around it.</p>

      <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">Individual results</p>
      <table class="w-full text-xs border-collapse">
        <thead>
          <tr class="text-left text-slate-500 border-b border-slate-200">
            <th class="py-2 font-semibold">Name</th>
            <th class="py-2 font-semibold text-center">Level</th>
            <th class="py-2 font-semibold text-center">Score</th>
            <th class="py-2 font-semibold text-center">Date</th>
          </tr>
        </thead>
        <tbody>
          ${people.slice().sort((a, b) => b.score - a.score).map(p => `
            <tr class="border-b border-slate-100">
              <td class="py-2 font-semibold">${esc(p.name)}</td>
              <td class="py-2 text-center font-bold text-brand-600">${bandFor(p.score).level}</td>
              <td class="py-2 text-center">${p.score}/40</td>
              <td class="py-2 text-center text-slate-500">${p.ts ? fmtDate(p.ts) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  document.getElementById('app').innerHTML = `
    <div class="fade-in">
      <div id="report" class="bg-white text-slate-800 rounded-2xl p-6 sm:p-10 shadow-2xl">
        <div class="border-b border-slate-200 pb-4 mb-5">
          <p class="text-xs uppercase tracking-[0.25em] text-brand-600 font-bold">Language Workshop</p>
          <h2 class="text-xl font-extrabold tracking-tight mt-0.5">Team Placement Report</h2>
          <p class="text-xs text-slate-500 mt-1">${fmtDate(Date.now())}</p>
        </div>
        ${body}
      </div>

      <div class="no-print mt-4 bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-lg">
        <label class="block text-xs font-semibold mb-1.5 text-slate-600 dark:text-slate-300">Paste result codes, one per line</label>
        <textarea id="codeInput" rows="4" placeholder="WT1-eyJuIjoi..."
          class="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-mono mb-2 focus:outline-none focus:border-brand-500"></textarea>
        <p id="codeMsg" class="hidden text-xs mb-2"></p>
        <div class="flex flex-wrap gap-2">
          <button id="addCodes" class="flex-1 min-w-[120px] py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm">Add to report</button>
          <button onclick="window.print()" class="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-sm">🖨 Print</button>
          <button id="clearTeam" class="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-sm">Clear</button>
        </div>
      </div>
    </div>`;

  document.getElementById('addCodes').addEventListener('click', () => {
    const lines = document.getElementById('codeInput').value.split('\n').map(s => s.trim()).filter(Boolean);
    const msg = document.getElementById('codeMsg');
    const existing = readJson(K.team, '[]');
    let added = 0, bad = 0, dupes = 0;
    for (const line of lines) {
      if (!decodeResult(line)) { bad++; continue; }
      if (existing.includes(line)) { dupes++; continue; }
      existing.push(line); added++;
    }
    localStorage.setItem(K.team, JSON.stringify(existing));

    const parts = [`${added} result${added === 1 ? '' : 's'} added`];
    if (dupes) parts.push(`${dupes} already in the report`);
    if (bad) parts.push(`${bad} code${bad === 1 ? '' : 's'} not recognised`);
    // Re-render first, then show the notice, or the rebuild would wipe it
    renderTeam({ text: parts.join(', ') + '.', bad: bad > 0 && added === 0 });
  });

  document.getElementById('clearTeam').addEventListener('click', () => {
    if (!confirm('Remove all results from this team report?')) return;
    localStorage.removeItem(K.team);
    renderTeam({ text: 'Report cleared.', bad: false });
  });

  if (notice) {
    const msg = document.getElementById('codeMsg');
    msg.textContent = notice.text;
    msg.className = 'text-xs mb-2 ' + (notice.bad ? 'text-rose-500' : 'text-emerald-600');
  }
}
