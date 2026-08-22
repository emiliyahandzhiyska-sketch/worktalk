// WorkTalk — ESL flashcards + quiz for adult learners
// Vanilla JS, no dependencies. Data lives in words.json.

const THEME_KEY = 'worktalk_theme';
const DECK_KEY = 'worktalk_deck';

const BRAND = {
  school: 'Language Workshop',
  ctaUrl: 'mailto:emiliya.handzhiyska@gmail.com?subject=Lesson%20inquiry%20(via%20WorkTalk)'
};

// Push reminders. Paste the OneSignal App ID here to switch them on.
// While it's empty nothing loads and students are never asked for permission.
const PUSH = {
  oneSignalAppId: ''
};

// Certificate email capture. Submissions land in the Formspree inbox for
// the address that owns this form. Clearing the endpoint switches capture
// off: emails then stay only on the student's own device.
// Free plan allows 50 submissions a month.
const LEADS = {
  endpoint: 'https://formspree.io/f/mqpzjlrk'
};

// Per-deck storage key, e.g. worktalk_marketing_mastered
function sKey(name) {
  return `worktalk_${deckId}_${name}`;
}

// Progress saved before decks existed belongs to the workplace deck
function migrateOldKeys() {
  const map = {
    worktalk_mastered: 'worktalk_workplace_mastered',
    worktalk_high_score: 'worktalk_workplace_high_score',
    worktalk_uoe_best: 'worktalk_workplace_uoe_best'
  };
  for (const [oldKey, newKey] of Object.entries(map)) {
    const v = localStorage.getItem(oldKey);
    if (v !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, v);
    }
    if (v !== null) localStorage.removeItem(oldKey);
  }
}

const QUIZ_LENGTH = 5;

let decks = [];
let deckId = 'workplace';
let words = [];
let exercises = { transformations: [], word_formation: [] };
let readings = [];
let mistakes = [];  // shared across every topic
let dialogues = {}; // keyed by deck id
let grammar = [];   // shared grammar points, independent of any topic
let grammarTopic = null; // { point, index, score, checked }, null = showing the menu
let enrich = {};    // phrase -> { l: level, c: [collocations] }
let currentCard = 0;
let mastered = new Set();
let quiz = null; // { questions, index, score, locked }
let uoe = null;  // { mode, items, index, score, checked }
let cardFilter = { category: null, unmasteredOnly: false, level: null };
let review = null; // spaced-repetition session: { queue, index, shown }

// Cards visible under the current category / unmastered filter
function visibleCards() {
  return words.filter(w =>
    (!cardFilter.category || w.category === cardFilter.category) &&
    (!cardFilter.level || w.level === cardFilter.level) &&
    (!cardFilter.unmasteredOnly || !mastered.has(w.phrase)));
}

function cur() {
  return visibleCards()[currentCard];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- Boot ----------

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initPalette();
  migrateOldKeys();
  document.getElementById('ctaLink').href = BRAND.ctaUrl;

  try {
    const [dRes, mRes, gRes, eRes, grRes] = await Promise.all([
      fetch('decks.json'), fetch('mistakes.json'), fetch('dialogues.json'), fetch('enrich.json'),
      fetch('grammar.json')
    ]);
    if (!dRes.ok) throw new Error(dRes.statusText);
    decks = await dRes.json();
    mistakes = mRes.ok ? await mRes.json() : [];
    dialogues = gRes.ok ? await gRes.json() : {};
    enrich = eRes.ok ? await eRes.json() : {};
    grammar = grRes.ok ? await grRes.json() : [];

    // One-time reset so everyone lands back on the first topic once. The app
    // still remembers your last topic after this.
    if (localStorage.getItem('worktalk_deck_reset') !== 'v2') {
      localStorage.removeItem(DECK_KEY);
      localStorage.setItem('worktalk_deck_reset', 'v2');
    }

    const saved = localStorage.getItem(DECK_KEY);
    deckId = decks.some(d => d.id === saved) ? saved : decks[0].id;

    bindEvents();
    await loadDeck(deckId);
  } catch (err) {
    // fetch() fails when index.html is opened straight from the file system
    // (file:// blocks it). Show a friendly hint instead of a blank screen.
    document.getElementById('viewFlashcards').innerHTML =
      '<div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-sm leading-relaxed">' +
      '<p class="font-bold mb-2">Couldn\'t load the app data</p>' +
      '<p>Open the app through a local server, for example:</p>' +
      '<code class="block mt-2 p-2 rounded bg-slate-100 dark:bg-slate-800">npx serve</code></div>';
    return;
  }

  // Warm up the voice list; Chrome loads voices async.
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }

  // PWA: installable + works offline
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(watchForUpdates).catch(() => {});
  }

  initPush();
});

// ---------- Toasts ----------

function showToast(id, html) {
  const zone = document.getElementById('toastZone');
  if (document.getElementById(id)) return;
  const el = document.createElement('div');
  el.id = id;
  el.className = 'fade-in pointer-events-auto w-full max-w-md bg-white dark:bg-slate-800 ' +
    'border border-slate-200 dark:border-slate-700 rounded-2xl shadow-lg p-4 text-sm';
  el.innerHTML = html;
  zone.appendChild(el);
}

function closeToast(id) {
  document.getElementById(id)?.remove();
}

// ---------- New version available ----------

function watchForUpdates(reg) {
  if (!reg) return;
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      // A previous worker was controlling the page, so this really is an update
      if (sw.state === 'installed' && navigator.serviceWorker.controller) {
        showToast('updateToast', `
          <p class="font-bold mb-1">✨ New version available</p>
          <p class="text-slate-500 dark:text-slate-400 mb-3">Refresh to get the latest phrases and exercises.</p>
          <div class="flex gap-2">
            <button onclick="location.reload()" class="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm">Refresh</button>
            <button onclick="closeToast('updateToast')" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 font-semibold text-sm">Later</button>
          </div>`);
      }
    });
  });
  // Ask the browser to look for a new version on every visit
  reg.update().catch(() => {});
}

// ---------- Push reminders (OneSignal) ----------

const PUSH_ASKED_KEY = 'worktalk_push_asked';

function pushReady() {
  return !!PUSH.oneSignalAppId && 'Notification' in window && 'serviceWorker' in navigator;
}

function initPush() {
  if (!pushReady()) return;
  const s = document.createElement('script');
  s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
  s.defer = true;
  document.head.appendChild(s);

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async OneSignal => {
    await OneSignal.init({
      appId: PUSH.oneSignalAppId,
      // Our own worker owns the root scope, so OneSignal gets its own corner
      serviceWorkerPath: 'push/onesignal/OneSignalSDKWorker.js',
      serviceWorkerParam: { scope: '/push/onesignal/' },
      // We ask in our own words first, at a good moment
      autoResume: true,
      promptOptions: { slidedown: { prompts: [] } }
    });
  });
}

// Called after a finished review, quiz or exercise: the moment a student
// is most likely to want a nudge tomorrow.
function maybeAskForReminders() {
  if (!pushReady()) return;
  if (localStorage.getItem(PUSH_ASKED_KEY)) return;
  if (Notification.permission !== 'default') return;

  showToast('pushToast', `
    <p class="font-bold mb-1">🔔 Want a daily nudge?</p>
    <p class="text-slate-500 dark:text-slate-400 mb-3">We'll remind you once a day when your review is ready. No spam, and you can turn it off anytime.</p>
    <div class="flex gap-2">
      <button onclick="acceptReminders()" class="flex-1 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm">Yes, remind me</button>
      <button onclick="declineReminders()" class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 font-semibold text-sm">No thanks</button>
    </div>`);
}

async function acceptReminders() {
  closeToast('pushToast');
  localStorage.setItem(PUSH_ASKED_KEY, 'yes');
  try {
    await window.OneSignal.Notifications.requestPermission();
  } catch { /* browser refused or SDK not ready */ }
}

function declineReminders() {
  closeToast('pushToast');
  // Remember the "no" so we never nag again
  localStorage.setItem(PUSH_ASKED_KEY, 'no');
}

// ---------- Decks ----------

async function loadDeck(id) {
  deckId = id;
  localStorage.setItem(DECK_KEY, id);
  const d = decks.find(x => x.id === id);

  const [wRes, eRes, rRes] = await Promise.all([
    fetch(d.words), fetch(d.exercises), fetch(d.readings)
  ]);
  if (!wRes.ok || !eRes.ok) throw new Error('deck load failed');
  words = await wRes.json();
  // Level and word partners live in one shared file, merged on by phrase
  words = words.map(w => {
    const extra = enrich[w.phrase];
    return extra ? { ...w, level: extra.l, collocations: extra.c || [] } : w;
  });
  exercises = await eRes.json();
  // Readings are optional: a deck without them simply hides the mode
  readings = rRes.ok ? await rRes.json() : [];

  // The report needs deck size and last-used date for decks that aren't loaded
  localStorage.setItem(sKey('size'), String(words.length));
  localStorage.setItem(sKey('last'), todayStr());

  currentCard = 0;
  quiz = null;
  uoe = null;
  review = null;
  cardFilter = { category: null, unmasteredOnly: false, level: null };
  loadProgress();

  const taglinePhrase = d.group === 'Beyond work'
    ? `${words.length} phrases you'll reach for again and again.`
    : `${words.length} phrases worth learning first.`;
  document.getElementById('tagline').textContent = `${d.name} · ${taglinePhrase}`;

  renderDeckPicker();
  renderCategoryChips();
  renderMotivation();
  renderTodayBanner();
  renderCard();
  renderProgress();
  renderQuizStart();
  renderUoeMenu();
}

function renderCategoryChips() {
  const cats = [...new Set(words.map(w => w.category))];
  const chip = (label, active, handler) => `
    <button onclick="${handler}"
      class="whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${active
        ? 'bg-brand-500 text-white border-brand-500'
        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-500'}">${label}</button>`;
  // Level chips only make sense once most of the topic carries a level.
  // A couple of phrases enriched via another topic would filter to one card.
  const levelled = words.filter(w => w.level).length;
  const levels = levelled >= words.length / 2
    ? ['A2', 'B1', 'B2', 'C1'].filter(l => words.some(w => w.level === l))
    : [];

  document.getElementById('categoryChips').innerHTML =
    chip('All', !cardFilter.category && !cardFilter.unmasteredOnly && !cardFilter.level, 'setCategory(null)') +
    cats.map(c => chip(c, cardFilter.category === c, `setCategory('${c}')`)).join('') +
    levels.map(l => chip(l, cardFilter.level === l, `setLevel('${l}')`)).join('') +
    chip('🎯 To learn', cardFilter.unmasteredOnly, 'toggleUnmastered()');
}

function setCategory(c) {
  cardFilter.category = c;
  if (c === null) { cardFilter.unmasteredOnly = false; cardFilter.level = null; }
  currentCard = 0;
  renderCategoryChips();
  renderCard();
}

function setLevel(l) {
  cardFilter.level = cardFilter.level === l ? null : l;
  currentCard = 0;
  renderCategoryChips();
  renderCard();
}

function toggleUnmastered() {
  cardFilter.unmasteredOnly = !cardFilter.unmasteredOnly;
  currentCard = 0;
  renderCategoryChips();
  renderCard();
}

let deckListOpen = false;

// With 9 decks a full grid pushes everything off screen, so only the active
// deck is shown until the learner asks to change it.
function renderDeckPicker() {
  const active = decks.find(d => d.id === deckId) || decks[0];
  document.getElementById('deckCount').textContent =
    `${decks.length} topics · ${active.group}`;
  document.getElementById('deckPicker').innerHTML = `
    <button onclick="toggleDeckList()"
      class="w-full text-left px-4 py-3 rounded-2xl bg-brand-500 text-white shadow-sm flex items-center gap-3">
      <span class="text-2xl">${active.icon}</span>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-bold truncate">${active.name}</span>
        <span class="block text-xs text-white/80 truncate">${active.tagline}</span>
      </span>
      <span class="text-xs font-bold bg-white/20 px-2.5 py-1 rounded-lg whitespace-nowrap">
        ${deckListOpen ? 'Close ▴' : 'Change ▾'}
      </span>
    </button>
    <div class="${deckListOpen ? '' : 'hidden'} mt-2">
      ${deckGroupsHtml()}
    </div>`;
}

// 15 topics in one flat list is a lot to scroll, so they sit under group headings.
function deckGroupsHtml() {
  const groups = [...new Set(decks.map(d => d.group))];
  return groups.map(g => {
    const inGroup = decks.filter(d => d.group === g);
    return `
      <div class="mb-3 last:mb-0">
        <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 px-1">${g}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          ${inGroup.map(d => `
            <button onclick="pickDeck('${d.id}')" ${d.id === deckId ? 'aria-current="true"' : ''}
              class="text-left px-4 py-3 rounded-2xl border transition-colors ${d.id === deckId
                ? 'bg-brand-50 dark:bg-slate-800 border-brand-500'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-brand-500 dark:hover:border-brand-500'}">
              <span class="block text-sm font-bold">${d.icon} ${d.name}${d.id === deckId ? ' ✓' : ''}</span>
              <span class="block text-xs mt-0.5 text-slate-500 dark:text-slate-400">${d.tagline}</span>
            </button>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function toggleDeckList() {
  deckListOpen = !deckListOpen;
  renderDeckPicker();
}

async function pickDeck(id) {
  deckListOpen = false;
  await switchDeckTo(id);
  renderDeckPicker();
}

async function switchDeckTo(id) {
  if (id !== deckId) await loadDeck(id);
}

// ---------- Brand palettes ----------

// Add "?palette" to the URL to get a colour switcher bar. Students never see it.
// v = [50, 100, 500, 600, 700]; bg = page background (defaults to cool grey).
const PAGE_DEFAULT = '241 245 249';
const CLOUD_DANCER = '240 238 233'; // Pantone 11-4201, approximate hex #F0EEE9

const PALETTES = {
  // --- Language Workshop red, from softest to the logo itself ---
  clay:    { group: 'Brand red', name: 'Clay rose (softest)', dot: '#b86b6b',
             v: ['253 244 243', '247 227 225', '184 107 107', '158 87 87', '129 70 70'] },
  coral:   { group: 'Brand red', name: 'Warm coral', dot: '#e0736b',
             v: ['255 244 242', '255 226 221', '224 115 107', '199 91 84', '163 73 67'] },
  brick:   { group: 'Brand red', name: 'Muted brick', dot: '#b4443c',
             v: ['253 243 242', '248 224 221', '180 68 60', '150 56 49', '122 46 40'] },
  logo:    { group: 'Brand red', name: 'Logo red (full)', dot: '#e30613',
             v: ['255 241 241', '255 223 223', '227 6 19', '192 5 16', '155 4 13'] },

  // --- Pantone 2026: Cloud Dancer as the page, companion shades as the accent ---
  woodrose:{ group: 'Pantone 2026', name: 'Cloud Dancer + Woodrose', dot: '#a5686f', bg: CLOUD_DANCER,
             v: ['250 245 245', '240 226 227', '165 104 111', '139 86 92', '112 63 69'] },
  rosebrown:{group: 'Pantone 2026', name: 'Cloud Dancer + Rose Brown', dot: '#9c6a5e', bg: CLOUD_DANCER,
             v: ['250 245 243', '240 226 220', '156 106 94', '131 87 76', '107 70 61'] },
  bluefusion:{group:'Pantone 2026', name: 'Cloud Dancer + Blue Fusion', dot: '#3f5d9e', bg: CLOUD_DANCER,
             v: ['242 245 251', '222 230 245', '63 93 158', '51 76 131', '40 60 104'] },
  violet:  { group: 'Pantone 2026', name: 'Cloud Dancer + Quiet Violet', dot: '#7a6a8a', bg: CLOUD_DANCER,
             v: ['247 245 249', '234 229 239', '122 106 138', '101 87 119', '81 69 99'] },

  // --- From Emi's reference photo: warm coral/red cylinders against pale mint ---
  photocoral: { group: 'From your photo', name: 'Coral (default)', dot: '#e64a3e', bg: '220 238 236',
             v: ['255 242 238', '255 217 208', '230 74 62', '201 51 39', '161 36 25'] },
  photomint:  { group: 'From your photo', name: 'Mint accent', dot: '#5c868a', bg: '255 240 236',
             v: ['239 248 247', '215 235 234', '127 169 172', '92 134 138', '69 101 104'] },

  // --- The previous look, for comparison ---
  blue:    { group: 'Previous', name: 'Classic blue', dot: '#2f6fed',
             v: ['238 246 255', '217 234 255', '47 111 237', '31 92 214', '26 76 176'] },
  teal:    { group: 'Previous', name: 'Teal', dot: '#0d9488',
             v: ['240 253 250', '204 251 241', '13 148 136', '15 118 110', '17 94 89'] }
};

const DEFAULT_PALETTE = 'photocoral';

const PALETTE_KEY = 'worktalk_palette';
const SHADES = ['--brand-50', '--brand-100', '--brand-500', '--brand-600', '--brand-700'];

function applyPalette(id) {
  const p = PALETTES[id];
  if (!p) return;
  SHADES.forEach((v, i) => document.documentElement.style.setProperty(v, p.v[i]));
  document.documentElement.style.setProperty('--page', p.bg || PAGE_DEFAULT);
  document.querySelector('meta[name=theme-color]').setAttribute('content', p.dot);
  localStorage.setItem(PALETTE_KEY, id);
  if (document.getElementById('paletteBar')) renderPaletteBar();
}

function initPalette() {
  const saved = localStorage.getItem(PALETTE_KEY);
  applyPalette(saved && PALETTES[saved] ? saved : DEFAULT_PALETTE);
  if (new URLSearchParams(location.search).has('palette')) renderPaletteBar();
}

function renderPaletteBar() {
  const active = localStorage.getItem(PALETTE_KEY) || DEFAULT_PALETTE;
  let bar = document.getElementById('paletteBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'paletteBar';
    bar.className = 'fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur ' +
      'text-white px-3 py-2 flex items-center gap-2 overflow-x-auto';
    document.body.prepend(bar);
    document.body.style.paddingTop = '52px';
  }
  const groups = [...new Set(Object.values(PALETTES).map(p => p.group))];
  bar.innerHTML = groups.map(g => `
    <span class="text-xs font-bold whitespace-nowrap opacity-60 ml-2 first:ml-0">${g}</span>` +
    Object.entries(PALETTES).filter(([, p]) => p.group === g).map(([id, p]) => `
      <button onclick="applyPalette('${id}')"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
          id === active ? 'bg-white text-slate-900' : 'bg-white/10 hover:bg-white/20'}">
        <span class="w-3 h-3 rounded-full border border-white/30" style="background:${p.dot}"></span>${p.name}
      </button>`).join('')).join('');
}

// ---------- Theme ----------

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved ? saved === 'dark' : prefersDark;
  applyTheme(dark);

  document.getElementById('themeToggle').addEventListener('click', () => {
    const nowDark = !document.documentElement.classList.contains('dark');
    applyTheme(nowDark);
    localStorage.setItem(THEME_KEY, nowDark ? 'dark' : 'light');
  });
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  document.getElementById('themeIcon').textContent = dark ? '☀️' : '🌙';
}

// ---------- Progress (LocalStorage) ----------

function loadProgress() {
  try {
    mastered = new Set(JSON.parse(localStorage.getItem(sKey('mastered')) || '[]'));
  } catch {
    mastered = new Set();
  }
}

function saveMastered() {
  localStorage.setItem(sKey('mastered'), JSON.stringify([...mastered]));
}

function getHighScore() {
  const v = parseInt(localStorage.getItem(sKey('high_score')), 10);
  return Number.isNaN(v) ? null : v;
}

function renderProgress() {
  const total = words.length;
  const done = [...mastered].filter(p => words.some(w => w.phrase === p)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = `${done} / ${total} mastered`;

  const hs = getHighScore();
  document.getElementById('highScoreLabel').textContent =
    hs === null ? 'Quiz best: not played yet' : `Quiz best: ${hs} / ${QUIZ_LENGTH}`;

  renderStreak();
  renderCertRow();
}

// ---------- Tabs ----------

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  styleTabs('flashcards');

  const card = document.getElementById('flashcard');
  card.addEventListener('click', e => {
    if (e.target.closest('button')) return; // the card's own buttons shouldn't flip it
    card.classList.toggle('flipped');
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.classList.toggle('flipped');
    }
  });

  document.getElementById('prevBtn').addEventListener('click', () => moveCard(-1));
  document.getElementById('nextBtn').addEventListener('click', () => moveCard(1));
  document.getElementById('masterBtn').addEventListener('click', toggleMastered);
  document.getElementById('shuffleBtn').addEventListener('click', () => {
    words = shuffle(words);
    currentCard = 0;
    renderCard();
  });
  document.getElementById('ttsBtn').addEventListener('click', e => {
    e.stopPropagation();
    const w = cur();
    if (w) speak(w.audio_text);
  });
  document.getElementById('bgBtn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('cardTranslation').classList.toggle('hidden');
  });
  document.getElementById('sentenceBtn').addEventListener('click', e => {
    e.stopPropagation();
    const w = cur();
    if (w) speak(w.business_context_example);
  });
  document.getElementById('slowBtn').addEventListener('click', e => {
    e.stopPropagation();
    const w = cur();
    if (w) speak(w.business_context_example, 0.6);
  });
  document.getElementById('shareBtn').addEventListener('click', shareProgress);
  document.getElementById('reportBtn').addEventListener('click', openReport);
  document.getElementById('reportClose').addEventListener('click', () =>
    document.getElementById('reportModal').classList.add('hidden'));
  document.getElementById('reportPrint').addEventListener('click', () => window.print());
  document.getElementById('reportCopy').addEventListener('click', copyReport);
  document.getElementById('reportNameInput').addEventListener('input', e => {
    const clean = e.target.value.trim().slice(0, 40);
    localStorage.setItem(NAME_KEY, clean);
    document.getElementById('reportName').textContent = clean || 'Learner';
  });
  // Certificate buttons are rendered per earned scope, so they bind inline
  document.getElementById('certClose').addEventListener('click', () =>
    document.getElementById('certModal').classList.add('hidden'));
  document.getElementById('certPrint').addEventListener('click', () => {
    const email = document.getElementById('certEmailInput').value;
    const note = document.getElementById('certEmailNote');
    if (email.trim() && !validEmail(email)) {
      note.textContent = 'That email doesn\'t look right — check it, or leave it blank.';
      note.className = 'text-[11px] text-rose-500 mt-1 mb-3';
      document.getElementById('certEmailInput').focus();
      return; // don't block on empty, only on a clearly broken address
    }
    if (email.trim()) {
      localStorage.setItem(EMAIL_KEY, email.trim());
      const d = decks.find(x => x.id === deckId);
      captureLead(email, document.getElementById('certName').textContent.trim(),
        certScope.label || d.name);
    }
    window.print();
  });
  document.getElementById('certNameInput').addEventListener('input', e => setCertName(e.target.value));
  document.getElementById('badgesToggle').addEventListener('click', () => {
    const grid = document.getElementById('badgesGrid');
    grid.classList.toggle('hidden');
    document.getElementById('badgesChevron').textContent =
      grid.classList.contains('hidden') ? '▾' : '▴';
  });
}

function switchTab(tab) {
  document.getElementById('viewFlashcards').classList.toggle('hidden', tab !== 'flashcards');
  document.getElementById('viewQuiz').classList.toggle('hidden', tab !== 'quiz');
  document.getElementById('viewUoe').classList.toggle('hidden', tab !== 'uoe');
  document.getElementById('viewGrammar').classList.toggle('hidden', tab !== 'grammar');
  styleTabs(tab);
  if (tab === 'quiz' && !quiz) renderQuizStart();
  if (tab === 'uoe' && !uoe) renderUoeMenu();
  if (tab === 'grammar' && !grammarTopic) renderGrammarMenu();
}

function styleTabs(active) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === active;
    btn.setAttribute('aria-selected', isActive);
    btn.className = 'tab-btn py-2.5 rounded-xl font-semibold text-[11px] sm:text-sm transition-colors ' +
      (isActive
        ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-white shadow-sm'
        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200');
  });
}

// ---------- Flashcards ----------

function moveCard(step) {
  const n = visibleCards().length;
  if (!n) return;
  currentCard = (currentCard + step + n) % n;
  renderCard();
}

function renderCard() {
  const list = visibleCards();
  const card = document.getElementById('flashcard');

  // Reset flip without animating backwards through the old content
  const inner = card.querySelector('.flip-inner');
  inner.style.transition = 'none';
  card.classList.remove('flipped');
  requestAnimationFrame(() => { inner.style.transition = ''; });

  document.getElementById('cardTranslation').classList.add('hidden');

  if (!list.length) {
    document.getElementById('cardPhrase').textContent = 'Nothing here 🎉';
    document.getElementById('cardDefinition').textContent =
      'Every card in this filter is mastered. Nice work!';
    document.getElementById('cardExample').textContent = '';
    document.getElementById('cardTranslation').textContent = '';
    document.getElementById('cardCounter').textContent = '0 / 0';
    renderMasterBtn();
    return;
  }

  currentCard = Math.min(currentCard, list.length - 1);
  const w = list[currentCard];
  document.getElementById('cardPhrase').textContent = w.phrase;
  document.getElementById('cardDefinition').textContent = w.definition;
  document.getElementById('cardExample').textContent = '“' + w.business_context_example + '”';
  document.getElementById('cardTranslation').textContent = '🇧🇬 ' + w.translation_bg;

  const lvl = document.getElementById('cardLevel');
  lvl.classList.toggle('hidden', !w.level);
  if (w.level) lvl.textContent = w.level;

  const colBox = document.getElementById('cardCollocations');
  const hasCol = w.collocations && w.collocations.length;
  colBox.classList.toggle('hidden', !hasCol);
  if (hasCol) {
    document.getElementById('cardCollocationsList').innerHTML =
      w.collocations.map(c => `<span class="inline-block bg-white/15 rounded-lg px-2 py-1 mr-1.5 mb-1.5">${c}</span>`).join('');
  }
  document.getElementById('cardCounter').textContent = `${currentCard + 1} / ${list.length}`;

  renderMasterBtn();
}

function renderMasterBtn() {
  const btn = document.getElementById('masterBtn');
  const w = cur();
  btn.disabled = !w;
  const isMastered = w && mastered.has(w.phrase);
  btn.textContent = !w ? '—' : isMastered ? '★ Mastered — tap to unmark' : '✓ Mark as mastered';
  btn.className = 'w-full mt-4 py-3 rounded-xl font-bold text-sm transition-colors ' +
    (!w
      ? 'bg-slate-200 dark:bg-slate-800 text-slate-400'
      : isMastered
        ? 'bg-amber-400 hover:bg-amber-500 text-amber-950'
        : 'bg-emerald-500 hover:bg-emerald-600 text-white');
}

function toggleMastered() {
  const w = cur();
  if (!w) return;
  if (mastered.has(w.phrase)) mastered.delete(w.phrase);
  else mastered.add(w.phrase);
  saveMastered();
  renderProgress();
  checkAchievements();
  // Under the "To learn" filter the card disappears once mastered
  if (cardFilter.unmasteredOnly) renderCard();
  else renderMasterBtn();
}

// ---------- Spaced repetition (Today's review) ----------

const NEW_PER_DAY = 5;

function getSrs() {
  try { return JSON.parse(localStorage.getItem(sKey('srs')) || '{}'); }
  catch { return {}; }
}

function setSrs(d) {
  localStorage.setItem(sKey('srs'), JSON.stringify(d));
}

function newIntroducedToday() {
  try {
    const d = JSON.parse(localStorage.getItem(sKey('srs_new')) || '{}');
    return d.date === todayStr() ? d.count : 0;
  } catch { return 0; }
}

function bumpNewIntroduced() {
  localStorage.setItem(sKey('srs_new'),
    JSON.stringify({ date: todayStr(), count: newIntroducedToday() + 1 }));
}

function buildTodayQueue() {
  const srs = getSrs();
  const t = todayStr();
  const due = words.filter(w => srs[w.phrase] && srs[w.phrase].due <= t);
  const newAllowed = Math.max(0, NEW_PER_DAY - newIntroducedToday());
  const fresh = words.filter(w => !srs[w.phrase]).slice(0, newAllowed);
  return shuffle([...due, ...fresh]);
}

function renderTodayBanner() {
  const box = document.getElementById('todayBanner');
  if (review) return; // session UI handles itself
  const q = buildTodayQueue();
  if (!q.length) {
    box.innerHTML = `
      <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
        ✅ Today's review is done. Come back tomorrow!
      </div>`;
  } else {
    box.innerHTML = `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-sm">
        <div>
          <p class="font-bold text-sm">📆 Today's review</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">${q.length} card${q.length > 1 ? 's' : ''} waiting for you</p>
        </div>
        <button onclick="startReview()" class="px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">Start</button>
      </div>`;
  }
}

function startReview() {
  review = { queue: buildTodayQueue(), index: 0, shown: false };
  renderReviewCard();
}

function renderReviewCard() {
  const box = document.getElementById('todayBanner');

  if (review.index >= review.queue.length) {
    const n = review.queue.length;
    review = null;
    markDayDone();
    renderProgress();
    box.innerHTML = `
      <div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 text-sm font-semibold text-emerald-800 dark:text-emerald-200 fade-in">
        🎉 Review done: ${n} card${n > 1 ? 's' : ''}. See you tomorrow!
      </div>`;
    return;
  }

  const w = review.queue[review.index];
  const header = `
    <div class="flex items-center justify-between mb-3">
      <span class="text-xs font-bold text-brand-500">📆 Today's review</span>
      <span class="text-xs text-slate-500 dark:text-slate-400">${review.index + 1} / ${review.queue.length}</span>
    </div>`;

  if (!review.shown) {
    box.innerHTML = `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm fade-in">
        ${header}
        <p class="text-xl font-extrabold text-center my-4">${w.phrase}</p>
        <div class="flex gap-2">
          <button onclick="reviewSpeak()" class="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 font-semibold text-sm">🔊</button>
          <button onclick="reviewShow()" class="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">Show answer</button>
        </div>
      </div>`;
  } else {
    box.innerHTML = `
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm fade-in">
        ${header}
        <p class="text-lg font-extrabold mb-1">${w.phrase}</p>
        <p class="text-sm mb-2">${w.definition}</p>
        <p class="text-xs italic text-slate-500 dark:text-slate-400 mb-4">“${w.business_context_example}”</p>
        <div class="grid grid-cols-2 gap-2">
          <button onclick="reviewGrade(false)" class="py-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-bold text-sm">😅 Still learning</button>
          <button onclick="reviewGrade(true)" class="py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm transition-colors">😎 I know it</button>
        </div>
      </div>`;
  }
}

function reviewShow() {
  review.shown = true;
  renderReviewCard();
}

function reviewSpeak() {
  speak(review.queue[review.index].audio_text);
}

function reviewGrade(known) {
  const w = review.queue[review.index];
  const srs = getSrs();
  const wasNew = !srs[w.phrase];
  // "Still learning" comes back tomorrow; "I know it" doubles the interval (max 60 days)
  const interval = known ? (wasNew ? 2 : Math.min(60, (srs[w.phrase].i || 1) * 2)) : 1;
  const due = new Date();
  due.setDate(due.getDate() + interval);
  srs[w.phrase] = { i: interval, due: due.toISOString().slice(0, 10) };
  setSrs(srs);
  if (wasNew) bumpNewIntroduced();
  review.index++;
  review.shown = false;
  renderReviewCard();
}

// ---------- Streak (global, all decks count) ----------

const STREAK_COUNT_KEY = 'worktalk_streak_count';
const STREAK_LAST_KEY = 'worktalk_streak_last';

function yesterdayStr() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return y.toISOString().slice(0, 10);
}

function getStreak() {
  const last = localStorage.getItem(STREAK_LAST_KEY);
  if (!last || (last !== todayStr() && last !== yesterdayStr())) return 0;
  return parseInt(localStorage.getItem(STREAK_COUNT_KEY), 10) || 0;
}

function markDayDone() {
  const t = todayStr();
  const last = localStorage.getItem(STREAK_LAST_KEY);
  if (last === t) return;
  const count = last === yesterdayStr()
    ? (parseInt(localStorage.getItem(STREAK_COUNT_KEY), 10) || 0) + 1
    : 1;
  localStorage.setItem(STREAK_COUNT_KEY, String(count));
  localStorage.setItem(STREAK_LAST_KEY, t);
  renderStreak();
  maybeAskForReminders();
  checkAchievements();
}

function renderStreak() {
  const n = getStreak();
  const el = document.getElementById('streakLabel');
  el.classList.toggle('hidden', n === 0);
  el.textContent = `🔥 ${n}-day streak`;
}

// ---------- Daily encouragement ----------

// Short, real English. Doubles as reading practice, with a Bulgarian version
// for the days when the English alone doesn't land.
const ENCOURAGEMENTS = [
  { en: "Five minutes today beats an hour next Sunday.", bg: "Пет минути днес струват повече от час следващата неделя." },
  { en: "You don't need perfect English. You need English people understand.", bg: "Не ти трябва перфектен английски. Трябва ти английски, който хората разбират." },
  { en: "The phrase you use today is the one you'll keep.", bg: "Фразата, която използваш днес, е тази, която ще ти остане." },
  { en: "Mistakes are how the words move from your notes into your mouth.", bg: "Грешките са начинът думите да минат от бележките в устата ти." },
  { en: "Nobody remembers your grammar. They remember that you spoke.", bg: "Никой не помни граматиката ти. Помнят, че си проговорил." },
  { en: "One card is progress. Zero cards is the only bad day.", bg: "Една карта е напредък. Само нула карти е лош ден." },
  { en: "You already understand more than you did last month.", bg: "Вече разбираш повече, отколкото миналия месец." },
  { en: "Say it out loud. Reading silently teaches your eyes, not your mouth.", bg: "Кажи го на глас. Тихото четене учи очите, не устата." },
  { en: "The hardest email gets easier the third time you write one.", bg: "Най-трудният имейл олеква на третия път." },
  { en: "Slow English that arrives beats fast English that never starts.", bg: "Бавен английски, който стига до целта, бие бърз, който не тръгва." },
  { en: "Learn the phrase your job actually needs. Skip the rest for now.", bg: "Учи фразата, която работата ти иска. Останалото може да чака." },
  { en: "Your accent is not a problem to fix. It's information about you.", bg: "Акцентът ти не е проблем за поправяне. Той е информация за теб." },
  { en: "Ten minutes a day for a month is five hours you didn't have before.", bg: "Десет минути дневно за месец са пет часа, които не си имал." },
  { en: "If you can explain your job in English, you can do the interview.", bg: "Ако можеш да обясниш работата си на английски, можеш и интервюто." },
  { en: "Don't wait to feel ready. Ready comes after, not before.", bg: "Не чакай да се почувстваш готов. Готовността идва след, не преди." },
  { en: "Every phrase you master is one less pause in your next meeting.", bg: "Всяка усвоена фраза е една пауза по-малко на следващата ти среща." },
  { en: "You're not behind. You're in the middle, and the middle is quiet.", bg: "Не изоставаш. В средата си, а средата е тиха." },
  { en: "Small and boring beats big and once.", bg: "Малко и скучно бие много и веднъж." },
  { en: "Reading the definition is easy. Using it on Tuesday is the work.", bg: "Да прочетеш значението е лесно. Работата е да го използваш във вторник." },
  { en: "Come back tomorrow. That's the whole method.", bg: "Върни се утре. Това е целият метод." }
];

function encouragementOfTheDay() {
  const d = new Date();
  const dayNumber = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return ENCOURAGEMENTS[dayNumber % ENCOURAGEMENTS.length];
}

function renderMotivation() {
  const e = encouragementOfTheDay();
  document.getElementById('motivationCard').innerHTML = `
    <div class="bg-brand-50 dark:bg-slate-900 border border-brand-100 dark:border-slate-800 rounded-2xl p-4">
      <p class="text-sm font-semibold leading-snug text-brand-700 dark:text-brand-100">💡 ${e.en}</p>
      <button onclick="document.getElementById('motivationBg').classList.toggle('hidden')"
        class="text-xs font-semibold text-brand-500 mt-1.5">🇧🇬 Превод</button>
      <p id="motivationBg" class="hidden text-xs text-slate-500 dark:text-slate-400 mt-1">${e.bg}</p>
    </div>`;
}

// ---------- Achievements ----------

const BADGES_KEY = 'worktalk_badges';

const ACHIEVEMENTS = [
  { id: 'first',     icon: '🌱', title: 'First step',    desc: 'Master your first phrase',        test: s => s.masteredAll >= 1 },
  { id: 'ten',       icon: '🔟', title: 'Ten down',      desc: 'Master 10 phrases',               test: s => s.masteredAll >= 10 },
  { id: 'fifty',     icon: '🏅', title: 'Fifty strong',  desc: 'Master 50 phrases',               test: s => s.masteredAll >= 50 },
  { id: 'hundred',   icon: '💯', title: 'Century',       desc: 'Master 100 phrases',              test: s => s.masteredAll >= 100 },
  { id: 'halfdeck',  icon: '📗', title: 'Half a deck',   desc: 'Master half of any deck',         test: s => s.bestDeckPct >= 50 },
  { id: 'fulldeck',  icon: '👑', title: 'Deck complete', desc: 'Master a whole deck',             test: s => s.bestDeckPct >= 100 },
  { id: 'streak7',   icon: '🔥', title: 'One week',      desc: 'Practise 7 days in a row',        test: s => s.streak >= 7 },
  { id: 'streak30',  icon: '🚀', title: 'One month',     desc: 'Practise 30 days in a row',       test: s => s.streak >= 30 },
  { id: 'quiz',      icon: '🎯', title: 'Perfect quiz',  desc: 'Score 5 out of 5',                test: s => s.bestQuiz >= 5 },
  { id: 'exam',      icon: '🧠', title: 'Exam ready',    desc: 'Perfect round in any exercise',   test: s => s.bestUoe >= UOE_ROUND },
  { id: 'listener',  icon: '🎧', title: 'Good ear',      desc: 'Score 6+ in listening or dictation', test: s => s.bestListening >= 6 },
  { id: 'explorer',  icon: '🗺️', title: 'Explorer',      desc: 'Try 5 different topics',          test: s => s.decksTouched >= 5 },
  { id: 'reviewer',  icon: '📆', title: 'Regular',       desc: 'Review 25 cards',                 test: s => s.reviewed >= 25 },
  { id: 'devoted',   icon: '💎', title: 'Devoted',       desc: 'Review 200 cards',                test: s => s.reviewed >= 200 }
];

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || fallback); }
  catch { return JSON.parse(fallback); }
}

function collectStats() {
  let masteredAll = 0, bestDeckPct = 0, bestQuiz = 0, bestUoe = 0,
      bestListening = 0, reviewed = 0, decksTouched = 0;

  for (const d of decks) {
    const m = readJson(`worktalk_${d.id}_mastered`, '[]').length;
    const srs = readJson(`worktalk_${d.id}_srs`, '{}');
    const hs = parseInt(localStorage.getItem(`worktalk_${d.id}_high_score`), 10) || 0;
    const uoeBest = readJson(`worktalk_${d.id}_uoe_best`, '{}');

    masteredAll += m;
    reviewed += Object.keys(srs).length;
    bestQuiz = Math.max(bestQuiz, hs);
    for (const [mode, score] of Object.entries(uoeBest)) {
      bestUoe = Math.max(bestUoe, score);
      if (mode === 'listen' || mode === 'dictation') bestListening = Math.max(bestListening, score);
    }
    // Deck size is only known for the loaded deck; use it where we can
    const size = d.id === deckId ? words.length : null;
    if (size) bestDeckPct = Math.max(bestDeckPct, Math.round((m / size) * 100));
    if (m || hs || Object.keys(srs).length || Object.keys(uoeBest).length) decksTouched++;
  }
  return { masteredAll, bestDeckPct, bestQuiz, bestUoe, bestListening, reviewed,
           decksTouched, streak: getStreak() };
}

function earnedBadges() {
  return new Set(readJson(BADGES_KEY, '[]'));
}

function checkAchievements() {
  const stats = collectStats();
  const had = earnedBadges();
  const now = ACHIEVEMENTS.filter(a => a.test(stats));
  const fresh = now.filter(a => !had.has(a.id));

  if (fresh.length) {
    localStorage.setItem(BADGES_KEY, JSON.stringify([...had, ...fresh.map(a => a.id)]));
    celebrate(fresh);
  }
  renderBadges();
}

function celebrate(list) {
  const a = list[0];
  const extra = list.length > 1 ? ` (+${list.length - 1} more)` : '';
  showToast('badgeToast', `
    <div class="flex items-center gap-3">
      <span class="text-3xl">${a.icon}</span>
      <div class="flex-1">
        <p class="font-bold">Achievement unlocked${extra}</p>
        <p class="text-slate-500 dark:text-slate-400">${a.title}: ${a.desc.toLowerCase()}</p>
      </div>
      <button onclick="closeToast('badgeToast')" class="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 font-semibold text-xs">Nice</button>
    </div>`);
  setTimeout(() => closeToast('badgeToast'), 6000);
}

function renderBadges() {
  const had = earnedBadges();
  document.getElementById('badgesSummary').textContent =
    `Achievements · ${had.size} / ${ACHIEVEMENTS.length}`;
  document.getElementById('badgesGrid').innerHTML = ACHIEVEMENTS.map(a => {
    const got = had.has(a.id);
    return `<div title="${a.title}: ${a.desc}"
      class="flex flex-col items-center gap-1 p-2 rounded-xl text-center ${got
        ? 'bg-brand-50 dark:bg-slate-800'
        : 'bg-slate-50 dark:bg-slate-900 opacity-40 grayscale'}">
      <span class="text-xl">${a.icon}</span>
      <span class="text-[10px] font-semibold leading-tight">${a.title}</span>
    </div>`;
  }).join('');
}

// ---------- Progress report ----------

// Everything the report needs, read straight from storage so decks that
// aren't currently loaded still appear.
function collectReport() {
  const rows = [];
  for (const d of decks) {
    const size = parseInt(localStorage.getItem(`worktalk_${d.id}_size`), 10);
    if (!size) continue;                       // never opened, nothing to report
    const m = readJson(`worktalk_${d.id}_mastered`, '[]').length;
    const hs = parseInt(localStorage.getItem(`worktalk_${d.id}_high_score`), 10);
    const uoeBest = readJson(`worktalk_${d.id}_uoe_best`, '{}');
    const srs = Object.keys(readJson(`worktalk_${d.id}_srs`, '{}')).length;
    rows.push({
      name: `${d.icon} ${d.name}`,
      group: d.group,
      size, mastered: m,
      pct: Math.round((m / size) * 100),
      quiz: Number.isNaN(hs) ? null : hs,
      uoeBest, inReview: srs,
      last: localStorage.getItem(`worktalk_${d.id}_last`) || null
    });
  }
  rows.sort((a, b) => b.pct - a.pct);
  return rows;
}

// CEFR level of every mastered phrase, tallied straight from the shared
// enrich map so it works even for decks that aren't currently loaded.
function collectCEFR() {
  const counts = { A2: 0, B1: 0, B2: 0, C1: 0 };
  let total = 0;
  for (const d of decks) {
    for (const phrase of readJson(`worktalk_${d.id}_mastered`, '[]')) {
      const lvl = enrich[phrase]?.l;
      if (lvl && lvl in counts) { counts[lvl]++; total++; }
    }
  }
  return { counts, total };
}

function cefrBarsHtml(counts, total) {
  const cefrColor = { A2: 'bg-emerald-400', B1: 'bg-brand-500', B2: 'bg-amber-500', C1: 'bg-rose-500' };
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return `
    <div class="rounded-xl border border-slate-200 p-4 mb-6">
      <div class="flex items-center justify-between mb-3">
        <p class="font-bold text-sm">CEFR level of mastered phrases</p>
        <span class="text-xs text-slate-500">${total} phrase${total === 1 ? '' : 's'} rated</span>
      </div>
      <div class="space-y-2">
        ${Object.entries(counts).map(([lvl, n]) => `
          <div class="flex items-center gap-2">
            <span class="w-6 text-xs font-bold text-slate-500">${lvl}</span>
            <div class="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full ${cefrColor[lvl]} rounded-full" style="width:${total ? (n / total * 100) : 0}%"></div>
            </div>
            <span class="w-8 text-right text-xs text-slate-500">${n}</span>
          </div>`).join('')}
      </div>
      ${total ? `<p class="text-xs text-slate-500 mt-3">Most mastered phrases are at <b>${top[0]}</b>.</p>` : ''}
    </div>`;
}

function openReport() {
  const rows = collectReport();
  const badges = earnedBadges();
  const totalMastered = rows.reduce((s, r) => s + r.mastered, 0);
  const totalReview = rows.reduce((s, r) => s + r.inReview, 0);
  const cefr = collectCEFR();

  document.getElementById('reportDate').textContent =
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const saved = localStorage.getItem(NAME_KEY) || '';
  const input = document.getElementById('reportNameInput');
  input.value = saved;
  document.getElementById('reportName').textContent = saved || 'Learner';

  const tile = (v, l) => `
    <div class="rounded-xl bg-slate-50 py-3 px-2 text-center">
      <p class="text-xl font-extrabold text-brand-600">${v}</p>
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mt-0.5">${l}</p>
    </div>`;
  document.getElementById('reportSummary').innerHTML =
    tile(totalMastered, 'phrases mastered') +
    tile(rows.length, 'topics started') +
    tile(getStreak(), 'day streak') +
    tile(`${badges.size}/${ACHIEVEMENTS.length}`, 'achievements');

  if (!rows.length) {
    document.getElementById('reportBody').innerHTML =
      '<p class="text-sm text-slate-500">No practice recorded yet. Open a topic and master a few cards first.</p>';
    document.getElementById('reportModal').classList.remove('hidden');
    return;
  }

  const modeLabel = m => (UOE_MODES[m] ? UOE_MODES[m].title : m);
  const bestList = b => Object.entries(b).length
    ? Object.entries(b).map(([m, s]) => `${modeLabel(m)} ${s}/${UOE_ROUND}`).join(', ')
    : '—';

  const table = `
    <table class="w-full text-xs border-collapse mb-6">
      <thead>
        <tr class="text-left text-slate-500 border-b border-slate-200">
          <th class="py-2 font-semibold">Topic</th>
          <th class="py-2 font-semibold text-center">Mastered</th>
          <th class="py-2 font-semibold text-center">Quiz</th>
          <th class="py-2 font-semibold">Exercise bests</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="border-b border-slate-100 align-top">
            <td class="py-2 pr-2 font-semibold">${r.name}</td>
            <td class="py-2 text-center whitespace-nowrap">
              ${r.mastered}/${r.size}
              <span class="block text-[10px] text-slate-400">${r.pct}%</span>
            </td>
            <td class="py-2 text-center">${r.quiz === null ? '—' : `${r.quiz}/${QUIZ_LENGTH}`}</td>
            <td class="py-2 text-slate-600">${bestList(r.uoeBest)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  // What a teacher would actually plan a lesson around
  const weakest = rows.filter(r => r.pct < 50).slice(0, 3);
  const triedModes = new Set(rows.flatMap(r => Object.keys(r.uoeBest)));
  const untried = Object.keys(UOE_MODES).filter(m => m !== 'own' && !triedModes.has(m));

  const focus = `
    <div class="rounded-xl bg-amber-50 p-4 text-xs leading-relaxed">
      <p class="font-bold text-sm mb-2">Suggested focus</p>
      ${weakest.length
        ? `<p class="mb-1"><b>Topics to revisit:</b> ${weakest.map(r => `${r.name} (${r.pct}%)`).join(', ')}</p>`
        : '<p class="mb-1">Every started topic is above 50%. Good coverage.</p>'}
      ${untried.length
        ? `<p><b>Exercise types not tried yet:</b> ${untried.map(modeLabel).join(', ')}</p>`
        : '<p>Every exercise type has been tried at least once.</p>'}
      <p class="mt-1"><b>Cards in the daily review system:</b> ${totalReview}</p>
    </div>`;

  document.getElementById('reportBody').innerHTML =
    (cefr.total ? cefrBarsHtml(cefr.counts, cefr.total) : '') + table + focus;
  document.getElementById('reportModal').classList.remove('hidden');
}

// A plain-text version, for pasting into a message to the teacher
function reportAsText() {
  const rows = collectReport();
  const name = localStorage.getItem(NAME_KEY) || 'Learner';
  const lines = [
    `WorkTalk progress report — ${name}`,
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    ''
  ];
  for (const r of rows) {
    const bests = Object.entries(r.uoeBest)
      .map(([m, s]) => `${UOE_MODES[m] ? UOE_MODES[m].title : m} ${s}/${UOE_ROUND}`).join(', ');
    lines.push(`${r.name}: ${r.mastered}/${r.size} mastered (${r.pct}%)` +
      (r.quiz !== null ? `, quiz ${r.quiz}/${QUIZ_LENGTH}` : '') +
      (bests ? `, ${bests}` : ''));
  }
  const cefr = collectCEFR();
  if (cefr.total) {
    lines.push('', 'CEFR level of mastered phrases:');
    for (const [lvl, n] of Object.entries(cefr.counts)) {
      if (n) lines.push(`  ${lvl}: ${n} (${Math.round(n / cefr.total * 100)}%)`);
    }
  }

  const st = getStreak();
  if (st) lines.push('', `Streak: ${st} day${st > 1 ? 's' : ''}`);
  lines.push(location.origin);
  return lines.join('\n');
}

async function copyReport() {
  const btn = document.getElementById('reportCopy');
  try {
    await navigator.clipboard.writeText(reportAsText());
    btn.textContent = '✅ Copied';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = '📋 Copy for your teacher'; }, 1800);
}

// ---------- Certificate ----------

const NAME_KEY = 'worktalk_student_name';
const LEVEL_SORT = ['A2', 'B1', 'B2', 'C1'];
// What the open certificate is for, so printing and email capture agree
let certScope = { scope: 'deck', sectionKey: null, label: '' };
const EMAIL_KEY = 'worktalk_student_email';
const LEADS_LOCAL_KEY = 'worktalk_leads'; // local fallback record, per device
const LEADS_SENT_KEY = 'worktalk_leads_sent'; // avoid re-submitting the same email+deck every print

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function leadsReady() {
  return !!LEADS.endpoint;
}

// Fire-and-forget: never blocks printing, never shows an error to the student
async function captureLead(email, name, deckName) {
  const clean = email.trim();
  if (!validEmail(clean)) return;

  // Always keep a local record, even if no endpoint is configured yet —
  // that way switching the endpoint on later doesn't lose earlier signups
  const local = readJson(LEADS_LOCAL_KEY, '[]');
  local.push({ email: clean, name, topic: deckName, date: new Date().toISOString() });
  localStorage.setItem(LEADS_LOCAL_KEY, JSON.stringify(local.slice(-200)));

  if (!leadsReady()) return;

  const sentKey = `${clean.toLowerCase()}|${deckName}`;
  const sent = new Set(readJson(LEADS_SENT_KEY, '[]'));
  if (sent.has(sentKey)) return; // already captured this email for this topic

  try {
    const res = await fetch(LEADS.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        // _subject is a Formspree field: it becomes the inbox subject line
        _subject: `WorkTalk certificate: ${name || 'unnamed'} — ${deckName}`,
        email: clean, name: name || '(no name given)',
        topic: deckName, source: 'WorkTalk certificate', app: location.origin
      })
    });
    // fetch only throws on network failure, so a rejected submission
    // (monthly limit reached, form paused) would otherwise be recorded as
    // sent and never retried. Only mark it sent when Formspree accepted it.
    if (!res.ok) return;
    sent.add(sentKey);
    localStorage.setItem(LEADS_SENT_KEY, JSON.stringify([...sent]));
  } catch { /* offline or blocked — the local record above still has it */ }
}

function deckComplete() {
  return words.length > 0 &&
    words.every(w => mastered.has(w.phrase));
}

// A section is a category inside the loaded deck. Finishing one earns its
// own certificate, so a 100-phrase topic rewards progress long before the end.
function completedSections() {
  const byCat = {};
  for (const w of words) (byCat[w.category] ||= []).push(w);
  return Object.entries(byCat)
    .filter(([, list]) => list.every(w => mastered.has(w.phrase)))
    .map(([cat, list]) => ({ key: cat, count: list.length }));
}

function renderCertRow() {
  const row = document.getElementById('certRow');
  const sections = completedSections();
  const whole = deckComplete();

  if (!whole && !sections.length) {
    row.classList.add('hidden');
    row.innerHTML = '';
    return;
  }

  row.classList.remove('hidden');
  row.innerHTML = `
    ${whole ? `
      <button onclick="openCertificate('deck')"
        class="w-full py-2.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-amber-950 font-bold text-sm transition-colors mb-2">
        👑 Get your topic certificate
      </button>` : ''}
    ${sections.length ? `
      <p class="text-[10px] uppercase tracking-widest text-slate-400 mb-1.5">
        Section certificate${sections.length > 1 ? 's' : ''} earned
      </p>
      <div class="flex flex-wrap gap-1.5">
        ${sections.map(s => `
          <button onclick="openCertificate('section', ${JSON.stringify(s.key).replace(/"/g, '&quot;')})"
            class="px-3 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 text-xs font-bold hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors">
            🎓 ${s.key}
          </button>`).join('')}
      </div>` : ''}`;
}

// scope: 'deck' for the whole topic, 'section' for one category inside it
function openCertificate(scope = 'deck', sectionKey = null) {
  const d = decks.find(x => x.id === deckId);
  const isSection = scope === 'section' && sectionKey;
  const inScope = isSection ? words.filter(w => w.category === sectionKey) : words;

  certScope = { scope, sectionKey, label: isSection ? `${sectionKey} — ${d.name}` : d.name };

  document.getElementById('certIntro').textContent = isSection
    ? 'has completed the section'
    : 'has completed the WorkTalk topic';

  document.getElementById('certDeck').textContent = isSection
    ? sectionKey
    : `${d.icon} ${d.name}`;

  const sub = document.getElementById('certSubtitle');
  sub.classList.toggle('hidden', !isSection);
  if (isSection) sub.textContent = `of ${d.icon} ${d.name}`;

  document.getElementById('certDate').textContent =
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const stat = (value, label) => `
    <div class="rounded-xl bg-amber-50 py-3 px-2">
      <p class="text-xl font-extrabold text-amber-700">${value}</p>
      <p class="text-[10px] uppercase tracking-widest text-slate-500 mt-0.5">${label}</p>
    </div>`;

  if (isSection) {
    // Quiz and exercise scores are deck-wide, so a section certificate
    // reports what actually belongs to the section instead.
    const levels = [...new Set(inScope.map(w => w.level).filter(Boolean))]
      .sort((a, b) => LEVEL_SORT.indexOf(a) - LEVEL_SORT.indexOf(b));
    const range = levels.length ? (levels.length > 1 ? `${levels[0]}–${levels[levels.length - 1]}` : levels[0]) : '—';
    const sectionCount = completedSections().length;
    const totalSections = new Set(words.map(w => w.category)).size;
    document.getElementById('certStats').innerHTML =
      stat(inScope.length, 'phrases mastered') +
      stat(range, 'CEFR range') +
      stat(`${sectionCount}/${totalSections}`, 'sections done');
  } else {
    const hs = getHighScore();
    const uoeBest = getUoeBest();
    const bestExercise = Object.values(uoeBest).length ? Math.max(...Object.values(uoeBest)) : null;
    document.getElementById('certStats').innerHTML =
      stat(words.length, 'phrases mastered') +
      stat(hs === null ? '—' : `${hs}/${QUIZ_LENGTH}`, 'best quiz') +
      stat(bestExercise === null ? '—' : `${bestExercise}/${UOE_ROUND}`, 'best exercise');
  }

  const saved = localStorage.getItem(NAME_KEY) || '';
  const input = document.getElementById('certNameInput');
  input.value = saved;
  setCertName(saved);

  document.getElementById('certEmailInput').value = localStorage.getItem(EMAIL_KEY) || '';

  document.getElementById('certModal').classList.remove('hidden');
  if (!saved) input.focus();
}

function setCertName(name) {
  const clean = name.trim().slice(0, 40);
  document.getElementById('certName').textContent = clean || ' ';
  localStorage.setItem(NAME_KEY, clean);
}

// ---------- Share progress ----------

async function shareProgress() {
  const lines = ['My WorkTalk progress 📚'];
  for (const d of decks) {
    let m = 0;
    try { m = JSON.parse(localStorage.getItem(`worktalk_${d.id}_mastered`) || '[]').length; }
    catch { /* ignore */ }
    const hs = localStorage.getItem(`worktalk_${d.id}_high_score`);
    if (m || hs) lines.push(`${d.icon} ${d.name}: ${m} mastered${hs ? `, quiz best ${hs}/${QUIZ_LENGTH}` : ''}`);
  }
  const st = getStreak();
  if (st) lines.push(`🔥 ${st}-day streak`);
  lines.push(location.origin);
  const text = lines.join('\n');

  if (navigator.share) {
    try { await navigator.share({ text }); return; }
    catch { /* fall through to clipboard */ }
  }
  await navigator.clipboard.writeText(text);
  const btn = document.getElementById('shareBtn');
  btn.textContent = '✅ Copied';
  setTimeout(() => { btn.textContent = '📤 Share'; }, 1500);
}

// ---------- Text-to-speech ----------

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;

  const english = voices.filter(v => /^en[-_](US|GB)/i.test(v.lang));
  if (!english.length) return voices.find(v => v.lang.startsWith('en')) || null;

  // Prefer higher-quality natural voices when the browser has them
  const preferred = english.find(v => /natural|neural|premium|google/i.test(v.name));
  return preferred || english[0];
}

function speak(text, rate = 0.9) {
  if (!('speechSynthesis' in window)) {
    alert('Your browser doesn\'t support speech. Try Chrome or Edge.');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = 'en-US';
  }
  u.rate = rate; // 0.9 default, slower on request
  speechSynthesis.speak(u);
}

// ---------- Speech recognition (speaking practice) ----------

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function speechSupported() {
  return !!SpeechRec;
}

// Word-level similarity, so "I'll touch base" still counts for "touch base"
// and a missing article doesn't fail an otherwise correct attempt.
function similarity(said, target) {
  const a = normalize(said).split(' ').filter(Boolean);
  const b = normalize(target).split(' ').filter(Boolean);
  if (!b.length) return 0;
  const pool = [...a];
  let hits = 0;
  for (const w of b) {
    const i = pool.indexOf(w);
    if (i > -1) { hits++; pool.splice(i, 1); }
  }
  return hits / b.length;
}

// ---------- Quiz ----------

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuiz() {
  const picked = shuffle(words).slice(0, QUIZ_LENGTH);
  const questions = picked.map(w => {
    const wrong = shuffle(words.filter(x => x.phrase !== w.phrase))
      .slice(0, 3)
      .map(x => x.definition);
    return {
      phrase: w.phrase,
      correct: w.definition,
      options: shuffle([w.definition, ...wrong])
    };
  });
  return { questions, index: 0, score: 0, locked: false };
}

function renderQuizStart() {
  quiz = null;
  const hs = getHighScore();
  document.getElementById('quizBox').innerHTML = `
    <div class="text-center py-6 fade-in">
      <p class="text-4xl mb-3">🎯</p>
      <h2 class="text-xl font-extrabold mb-2">Ready for a quick check?</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-1">${QUIZ_LENGTH} questions. Pick the right meaning for each phrase.</p>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">${hs === null ? 'First try — good luck!' : `Your best so far: <b>${hs} / ${QUIZ_LENGTH}</b>`}</p>
      <button onclick="startQuiz()" class="px-8 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition-colors">Start quiz</button>
    </div>`;
}

function startQuiz() {
  quiz = buildQuiz();
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.questions[quiz.index];
  quiz.locked = false;
  document.getElementById('quizBox').innerHTML = `
    <div class="fade-in">
      <div class="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-4">
        <span>Question ${quiz.index + 1} of ${quiz.questions.length}</span>
        <span>Score: ${quiz.score}</span>
      </div>
      <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">What does this mean?</p>
      <h2 class="text-2xl font-extrabold mb-5">“${q.phrase}”</h2>
      <div class="space-y-2.5">
        ${q.options.map((opt, i) => `
          <button data-opt="${i}" onclick="answer(${i})"
            class="opt-btn w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-medium hover:border-brand-500 dark:hover:border-brand-500 transition-colors">
            ${opt}
          </button>`).join('')}
      </div>
    </div>`;
}

function answer(i) {
  if (quiz.locked) return;
  quiz.locked = true;

  const q = quiz.questions[quiz.index];
  const chosen = q.options[i];
  const correct = chosen === q.correct;
  if (correct) quiz.score++;

  document.querySelectorAll('.opt-btn').forEach(btn => {
    const opt = q.options[+btn.dataset.opt];
    btn.disabled = true;
    if (opt === q.correct) {
      btn.className = btn.className.replace(/bg-slate-50 dark:bg-slate-800/, '') +
        ' bg-emerald-100 dark:bg-emerald-900/50 border-emerald-500 text-emerald-800 dark:text-emerald-200';
    } else if (+btn.dataset.opt === i) {
      btn.className = btn.className.replace(/bg-slate-50 dark:bg-slate-800/, '') +
        ' bg-rose-100 dark:bg-rose-900/40 border-rose-500 text-rose-800 dark:text-rose-200';
    }
  });

  setTimeout(() => {
    quiz.index++;
    if (quiz.index < quiz.questions.length) renderQuestion();
    else renderQuizEnd();
  }, 1200);
}

function renderQuizEnd() {
  const { score, questions } = quiz;
  const prev = getHighScore();
  const isRecord = prev === null || score > prev;
  if (isRecord) localStorage.setItem(sKey('high_score'), String(score));
  markDayDone();
  renderProgress();

  const msg =
    score === questions.length ? 'Perfect. Seriously well done! 🏆' :
    score >= 4 ? 'Strong result. Almost there!' :
    score >= 3 ? 'Good work. Review the tricky ones and try again.' :
    'No stress. Flip through the cards once more and retry.';

  document.getElementById('quizBox').innerHTML = `
    <div class="text-center py-6 fade-in">
      <p class="text-4xl mb-3">${score >= 4 ? '🎉' : '💪'}</p>
      <h2 class="text-xl font-extrabold mb-2">You scored ${score} / ${questions.length}</h2>
      ${isRecord ? '<p class="text-sm font-semibold text-emerald-500 mb-2">New personal best!</p>' : ''}
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">${msg}</p>
      <button onclick="startQuiz()" class="px-8 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition-colors">Try again</button>
    </div>`;
}

// ---------- Use of English ----------

const UOE_ROUND = 8;

const UOE_MODES = {
  cloze:     { icon: '🧩', title: 'Cloze test',        desc: 'Pick the phrase that fits the gap.' },
  open:      { icon: '⌨️', title: 'Open cloze',        desc: 'Type the missing phrase yourself.' },
  transform: { icon: '🔁', title: 'Transformations',   desc: 'Rewrite the sentence using a key word.' },
  wordform:  { icon: '🔤', title: 'Word formation',    desc: 'Build the right form of the word.' },
  speaking:  { icon: '🎤', title: 'Speaking',          desc: 'Say the phrase out loud and get scored.' },
  mistakes:  { icon: '🚫', title: 'Common mistakes',   desc: 'Errors Bulgarian speakers actually make.' },
  dialogue:  { icon: '💬', title: 'Dialogues',         desc: 'Hear a real conversation, then take a role.' },
  reading:   { icon: '📖', title: 'Reading',           desc: 'Read a short story, answer questions.' },
  listen:    { icon: '👂', title: 'Listening',         desc: 'Hear the phrase, pick the meaning.' },
  dictation: { icon: '🎧', title: 'Dictation',         desc: 'Listen and type what you hear.' },
  own:       { icon: '💡', title: 'Your own sentence', desc: 'Use a phrase in a sentence about your life.' }
};

function getUoeBest() {
  try { return JSON.parse(localStorage.getItem(sKey('uoe_best')) || '{}'); }
  catch { return {}; }
}

function saveUoeBest(mode, score) {
  const best = getUoeBest();
  if (best[mode] === undefined || score > best[mode]) {
    best[mode] = score;
    localStorage.setItem(sKey('uoe_best'), JSON.stringify(best));
  }
}

function normalize(s) {
  return s.toLowerCase().replace(/[.,!?;:'"’]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Entries whose example contains the phrase word for word (no inflection),
// so we can blank it out cleanly.
function clozeEligible() {
  return words.filter(w =>
    w.business_context_example.toLowerCase().includes(w.phrase.toLowerCase()));
}

function blankOut(w) {
  return w.business_context_example.replace(
    new RegExp(escapeRegex(w.phrase), 'i'), '_______');
}

function renderUoeMenu() {
  uoe = null;
  const best = getUoeBest();
  const scored = ['cloze', 'open', 'transform', 'wordform', 'speaking', 'mistakes', 'reading', 'listen', 'dictation'];
  document.getElementById('uoeBox').innerHTML = `
    <div class="fade-in">
      <h2 class="text-xl font-extrabold mb-1">Use of English</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-5">Exam-style practice with the phrases from your cards.</p>
      <div class="space-y-2.5">
        ${Object.entries(UOE_MODES).map(([mode, m]) => {
          const off = (mode === 'speaking' && !speechSupported()) ||
                      (mode === 'dialogue' && !dialoguesForDeck().length);
          return `
          <button ${off ? 'disabled' : `onclick="startUoe('${mode}')"`}
            class="w-full text-left px-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ${off
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:border-brand-500 dark:hover:border-brand-500'} transition-colors flex items-center gap-3">
            <span class="text-2xl">${m.icon}</span>
            <span class="flex-1">
              <span class="block font-bold text-sm">${m.title}</span>
              <span class="block text-xs text-slate-500 dark:text-slate-400">${
                off ? (mode === 'dialogue' ? 'Coming soon for this topic' : 'Needs Chrome or Edge') : m.desc}</span>
            </span>
            ${!off && scored.includes(mode) && best[mode] !== undefined
              ? `<span class="text-xs font-semibold text-brand-500">Best: ${best[mode]}/${UOE_ROUND}</span>` : ''}
          </button>`; }).join('')}
      </div>
      <button onclick="browseMistakes()"
        class="w-full mt-3 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:border-brand-500 hover:text-brand-500 transition-colors">
        📕 Browse all ${mistakes.length} common mistakes
      </button>
    </div>`;
}

function startUoe(mode) {
  let items;
  if (mode === 'cloze') {
    items = shuffle(clozeEligible()).slice(0, UOE_ROUND).map(w => ({
      sentence: blankOut(w),
      correct: w.phrase,
      options: shuffle([w.phrase,
        ...shuffle(words.filter(x => x.phrase !== w.phrase)).slice(0, 3).map(x => x.phrase)])
    }));
  } else if (mode === 'open') {
    items = shuffle(clozeEligible()).slice(0, UOE_ROUND).map(w => ({
      sentence: blankOut(w),
      answer: w.phrase,
      hint: w.phrase.split(' ').map(x => x[0] + '···').join(' ')
    }));
  } else if (mode === 'transform') {
    items = shuffle(exercises.transformations).slice(0, UOE_ROUND);
  } else if (mode === 'wordform') {
    items = shuffle(exercises.word_formation).slice(0, UOE_ROUND);
  } else if (mode === 'dialogue') {
    renderDialogueList();
    return;
  } else if (mode === 'mistakes') {
    items = shuffle(mistakes).slice(0, UOE_ROUND).map(m => {
      const options = shuffle([m.right, m.wrong]);
      return { ...m, options, correct: options.indexOf(m.right) };
    });
  } else if (mode === 'speaking') {
    items = shuffle(words).slice(0, UOE_ROUND).map(w => ({
      target: w.phrase,
      audio: w.audio_text,
      example: w.business_context_example
    }));
  } else if (mode === 'reading') {
    const passage = shuffle(readings)[0];
    if (!passage) return;
    // Options are authored with the correct answer first, so shuffle each one
    // and remember where the right answer landed.
    const qs = passage.questions.map(q => {
      const right = q.options[q.correct];
      const options = shuffle(q.options);
      return { q: q.q, options, correct: options.indexOf(right) };
    });
    uoe = { mode, passage, items: qs, index: 0, score: 0, checked: false };
    renderUoeItem();
    return;
  } else if (mode === 'listen') {
    items = shuffle(words).slice(0, UOE_ROUND).map(w => ({
      audio: w.audio_text,
      correct: w.definition,
      options: shuffle([w.definition,
        ...shuffle(words.filter(x => x.phrase !== w.phrase)).slice(0, 3).map(x => x.definition)])
    }));
  } else if (mode === 'dictation') {
    items = shuffle(words).slice(0, UOE_ROUND).map(w => ({
      audio: w.audio_text,
      answer: w.phrase,
      hint: `${w.phrase.split(' ').length} word${w.phrase.split(' ').length > 1 ? 's' : ''}`
    }));
  } else {
    items = shuffle(words);
  }
  uoe = { mode, items, index: 0, score: 0, checked: false };
  renderUoeItem();
}

function uoeHeader() {
  const m = UOE_MODES[uoe.mode];
  const progress = uoe.mode === 'own'
    ? `Sentence ${uoe.index + 1}`
    : `${uoe.index + 1} of ${uoe.items.length} · Score: ${uoe.score}`;
  return `
    <div class="flex items-center justify-between mb-4">
      <button onclick="renderUoeMenu()" class="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-500">← Menu</button>
      <span class="text-xs text-slate-500 dark:text-slate-400">${m.icon} ${m.title} · ${progress}</span>
    </div>`;
}

function uoeInput(placeholder) {
  return `
    <input id="uoeAnswer" type="text" autocomplete="off" placeholder="${placeholder}"
      onkeydown="if(event.key==='Enter')uoeCheck()"
      class="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:border-brand-500 mb-3">
    <button onclick="uoeCheck()" class="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">Check</button>
    <div id="uoeFeedback" class="mt-3"></div>`;
}

function renderUoeItem() {
  const box = document.getElementById('uoeBox');
  const it = uoe.items[uoe.index];
  uoe.checked = false;

  if (uoe.mode === 'cloze') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <p class="text-base leading-relaxed mb-5">${it.sentence}</p>
        <div class="space-y-2.5">
          ${it.options.map((opt, i) => `
            <button data-opt="${i}" onclick="uoeClozeAnswer(${i})"
              class="opt-btn w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-medium hover:border-brand-500 dark:hover:border-brand-500 transition-colors">
              ${opt}
            </button>`).join('')}
        </div>
      </div>`;
  } else if (uoe.mode === 'open') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <p class="text-base leading-relaxed mb-2">${it.sentence}</p>
        <button onclick="document.getElementById('uoeHint').classList.remove('hidden')"
          class="text-xs font-semibold text-brand-500 mb-3">Show hint</button>
        <p id="uoeHint" class="hidden text-sm text-slate-500 dark:text-slate-400 mb-3">Hint: <b>${it.hint}</b></p>
        ${uoeInput('Type the missing phrase…')}
      </div>`;
  } else if (uoe.mode === 'transform') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">Rewrite this sentence</p>
        <p class="text-base font-semibold leading-relaxed mb-2">“${it.original}”</p>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">Use the word: <b class="text-brand-500">${it.key}</b> (keep the meaning the same)</p>
        ${uoeInput('Write the new sentence…')}
      </div>`;
  } else if (uoe.mode === 'wordform') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <p class="text-base leading-relaxed mb-2">${it.sentence.replace('___', '<b class="text-brand-500">_______</b>')}</p>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">Use the correct form of: <b class="text-brand-500">${it.base}</b></p>
        ${uoeInput('Type the word…')}
      </div>`;
  } else if (uoe.mode === 'mistakes') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">${it.category}</p>
        <p class="text-sm font-bold mb-4">Which one is correct?</p>
        <div class="space-y-2.5">
          ${it.options.map((opt, i) => `
            <button data-opt="${i}" onclick="uoeMistakeAnswer(${i})"
              class="opt-btn w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-medium hover:border-brand-500 dark:hover:border-brand-500 transition-colors">
              ${opt}
            </button>`).join('')}
        </div>
        <div id="uoeFeedback" class="mt-3"></div>
      </div>`;
  } else if (uoe.mode === 'speaking') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">Say this out loud</p>
        <p class="text-2xl font-extrabold mb-1">${it.target}</p>
        <p class="text-xs italic text-slate-500 dark:text-slate-400 mb-5">“${it.example}”</p>
        <div class="flex gap-2 mb-3">
          <button onclick="speak(uoe.items[uoe.index].audio)" class="px-4 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-semibold text-sm">🔊 Hear it</button>
          <button id="micBtn" onclick="startListening()" class="flex-1 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">🎤 Tap and speak</button>
        </div>
        <button onclick="uoeSpeakingSkip()" class="w-full py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-500">Skip this one</button>
        <div id="uoeFeedback" class="mt-3"></div>
      </div>`;
  } else if (uoe.mode === 'reading') {
    const p = uoe.passage;
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <div class="mb-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800 max-h-64 overflow-y-auto">
          <p class="font-extrabold text-sm mb-1">${p.title}</p>
          <p class="text-[10px] uppercase tracking-widest text-slate-400 mb-2">Level ${p.level}</p>
          ${p.text.split('\n\n').map(par =>
            `<p class="text-sm leading-relaxed mb-2">${par}</p>`).join('')}
        </div>
        <p class="text-sm font-bold mb-3">${it.q}</p>
        <div class="space-y-2.5">
          ${it.options.map((opt, i) => `
            <button data-opt="${i}" onclick="uoeReadingAnswer(${i})"
              class="opt-btn w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-medium hover:border-brand-500 dark:hover:border-brand-500 transition-colors">
              ${opt}
            </button>`).join('')}
        </div>
      </div>`;
  } else if (uoe.mode === 'listen') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <div class="text-center mb-5">
          <button onclick="uoePlay()" class="px-8 py-4 rounded-2xl bg-brand-50 dark:bg-slate-800 text-brand-600 dark:text-brand-100 font-bold text-lg hover:bg-brand-100 dark:hover:bg-slate-700 transition-colors">🔊 Play</button>
          <p class="text-xs text-slate-400 mt-2">What does the phrase mean?</p>
        </div>
        <div class="space-y-2.5">
          ${it.options.map((opt, i) => `
            <button data-opt="${i}" onclick="uoeClozeAnswer(${i})"
              class="opt-btn w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-medium hover:border-brand-500 dark:hover:border-brand-500 transition-colors">
              ${opt}
            </button>`).join('')}
        </div>
      </div>`;
    uoePlay();
  } else if (uoe.mode === 'dictation') {
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <div class="text-center mb-4">
          <button onclick="uoePlay()" class="px-8 py-4 rounded-2xl bg-brand-50 dark:bg-slate-800 text-brand-600 dark:text-brand-100 font-bold text-lg hover:bg-brand-100 dark:hover:bg-slate-700 transition-colors">🔊 Play</button>
          <p class="text-xs text-slate-400 mt-2">Type what you hear (${it.hint})</p>
        </div>
        ${uoeInput('Type the phrase…')}
      </div>`;
    uoePlay();
  } else {
    const w = it;
    box.innerHTML = `
      <div class="fade-in">${uoeHeader()}
        <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">Your phrase</p>
        <p class="text-2xl font-extrabold mb-1">${w.phrase}</p>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">${w.definition}</p>
        <p class="text-sm mb-3">Write your own sentence about <b>your</b> work or life:</p>
        ${uoeInput('My sentence…')}
      </div>`;
  }
  const inp = document.getElementById('uoeAnswer');
  if (inp) inp.focus();
}

function uoeClozeAnswer(i) {
  if (uoe.checked) return;
  uoe.checked = true;
  const it = uoe.items[uoe.index];
  const correct = it.options[i] === it.correct;
  if (correct) uoe.score++;

  document.querySelectorAll('.opt-btn').forEach(btn => {
    const opt = it.options[+btn.dataset.opt];
    btn.disabled = true;
    if (opt === it.correct) {
      btn.className += ' !bg-emerald-100 dark:!bg-emerald-900/50 !border-emerald-500';
    } else if (+btn.dataset.opt === i) {
      btn.className += ' !bg-rose-100 dark:!bg-rose-900/40 !border-rose-500';
    }
  });
  setTimeout(uoeNext, 1100);
}

function uoeCheck() {
  if (uoe.checked) return;
  const it = uoe.items[uoe.index];
  const raw = document.getElementById('uoeAnswer').value;
  const ans = normalize(raw);
  if (!ans) return;
  uoe.checked = true;

  let correct, revealHtml;
  if (uoe.mode === 'open' || uoe.mode === 'dictation') {
    correct = ans === normalize(it.answer);
    revealHtml = `Answer: <b>${it.answer}</b>`;
  } else if (uoe.mode === 'transform') {
    correct = it.accept.some(a => ans.includes(normalize(a)));
    revealHtml = `Model answer: <b>${it.model}</b>`;
  } else if (uoe.mode === 'wordform') {
    correct = it.accept.some(a => ans === normalize(a));
    revealHtml = `Answer: <b>${it.accept[0]}</b>`;
  } else {
    // Own sentence: check they used the phrase (longest word as the anchor,
    // so inflections like "reached out" still count) and wrote a real sentence.
    const anchor = it.phrase.split(' ').sort((a, b) => b.length - a.length)[0]
      .toLowerCase().slice(0, 4);
    correct = ans.includes(anchor) && ans.split(' ').length >= 4;
    revealHtml = `Example: <i>${it.business_context_example}</i>`;
  }

  const fb = document.getElementById('uoeFeedback');
  const isOwn = uoe.mode === 'own';
  if (!isOwn && correct) uoe.score++;
  fb.innerHTML = `
    <div class="fade-in p-3 rounded-xl text-sm ${correct
      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'}">
      <p class="font-bold mb-1">${correct
        ? (isOwn ? 'Nice sentence! 👏' : 'Correct! ✅')
        : (isOwn ? 'Almost. Try to include the phrase itself.' : 'Not quite.')}</p>
      <p>${revealHtml}</p>
    </div>
    <button onclick="uoeNext()" class="w-full mt-3 py-2.5 rounded-xl bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-bold text-sm">
      ${isOwn ? 'Next phrase →' : 'Continue →'}
    </button>`;
  document.getElementById('uoeAnswer').disabled = true;
}

function uoeReadingAnswer(i) {
  if (uoe.checked) return;
  uoe.checked = true;
  const it = uoe.items[uoe.index];
  if (i === it.correct) uoe.score++;

  document.querySelectorAll('.opt-btn').forEach(btn => {
    const idx = +btn.dataset.opt;
    btn.disabled = true;
    if (idx === it.correct) {
      btn.className += ' !bg-emerald-100 dark:!bg-emerald-900/50 !border-emerald-500';
    } else if (idx === i) {
      btn.className += ' !bg-rose-100 dark:!bg-rose-900/40 !border-rose-500';
    }
  });
  setTimeout(uoeNext, 1100);
}

function uoeMistakeAnswer(i) {
  if (uoe.checked) return;
  uoe.checked = true;
  const it = uoe.items[uoe.index];
  const correct = i === it.correct;
  if (correct) uoe.score++;

  document.querySelectorAll('.opt-btn').forEach(btn => {
    const idx = +btn.dataset.opt;
    btn.disabled = true;
    if (idx === it.correct) btn.className += ' !bg-emerald-100 dark:!bg-emerald-900/50 !border-emerald-500';
    else btn.className += ' !bg-rose-100 dark:!bg-rose-900/40 !border-rose-500 line-through opacity-70';
  });

  document.getElementById('uoeFeedback').innerHTML = `
    <div class="fade-in p-3 rounded-xl text-sm ${correct
      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'}">
      <p class="font-bold mb-1">${correct ? 'Correct! ✅' : 'Not quite.'}</p>
      <p>${it.why}</p>
      <button onclick="document.getElementById('mistakeBg').classList.toggle('hidden')"
        class="text-xs font-semibold underline mt-1.5">🇧🇬 Обяснение на български</button>
      <p id="mistakeBg" class="hidden mt-1">${it.why_bg}</p>
    </div>
    <button onclick="uoeNext()" class="w-full mt-3 py-2.5 rounded-xl bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-bold text-sm">Continue →</button>`;
}

// ---------- Grammar ----------
// Shared across all topics, independent of the loaded deck. Each point has a
// plain-English rule, a Bulgarian version, examples, and its own 5-question
// mini quiz. More categories (Prepositions, Word order, ...) join later —
// grouping by `category` already supports that without any restructuring.

const GRAMMAR_BEST_KEY = 'worktalk_grammar_best';

function grammarBest() {
  return readJson(GRAMMAR_BEST_KEY, '{}');
}

function saveGrammarBest(id, score) {
  const best = grammarBest();
  if (best[id] === undefined || score > best[id]) {
    best[id] = score;
    localStorage.setItem(GRAMMAR_BEST_KEY, JSON.stringify(best));
  }
}

function renderGrammarMenu() {
  grammarTopic = null;
  const best = grammarBest();
  const box = document.getElementById('grammarBox');

  if (!grammar.length) {
    box.innerHTML = '<p class="text-sm text-slate-500 dark:text-slate-400">Grammar content isn\'t available right now.</p>';
    return;
  }

  const byCat = {};
  for (const g of grammar) (byCat[g.category] ||= []).push(g);

  box.innerHTML = `
    <div class="fade-in">
      <h2 class="text-xl font-extrabold mb-1">Grammar</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-5">Short rules, real examples, a 5-question check. Works the same across every topic.</p>
      ${Object.entries(byCat).map(([cat, points]) => `
        <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-4 mb-2 first:mt-0">${cat}</p>
        <div class="space-y-2.5">
          ${points.map(g => `
            <button onclick="openGrammarTopic('${g.id}')"
              class="w-full text-left px-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-brand-500 transition-colors flex items-center gap-3">
              <span class="flex-1">
                <span class="block font-bold text-sm">${g.title}</span>
                <span class="block text-[10px] font-bold uppercase tracking-widest text-brand-500 mt-1">Level ${g.level}</span>
              </span>
              ${best[g.id] !== undefined ? `<span class="text-xs font-semibold text-brand-500 whitespace-nowrap">Best: ${best[g.id]}/${g.exercises.length}</span>` : ''}
            </button>`).join('')}
        </div>`).join('')}
    </div>`;
}

function openGrammarTopic(id) {
  const point = grammar.find(g => g.id === id);
  if (!point) return;
  grammarTopic = { point, index: -1, score: 0, checked: false }; // -1 = explanation screen
  renderGrammarExplanation();
}

function renderGrammarExplanation() {
  const { point } = grammarTopic;
  document.getElementById('grammarBox').innerHTML = `
    <div class="fade-in">
      <button onclick="renderGrammarMenu()" class="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-500 mb-3">← All grammar</button>
      <p class="text-[11px] font-bold uppercase tracking-widest text-brand-500 mb-1">${point.category} · Level ${point.level}</p>
      <h2 class="text-xl font-extrabold mb-3">${point.title}</h2>

      <p class="text-sm leading-relaxed mb-3">${point.rule_en}</p>
      <button onclick="document.getElementById('grammarRuleBg').classList.toggle('hidden')"
        class="text-xs font-semibold text-brand-500 mb-3">🇧🇬 Правилото на български</button>
      <p id="grammarRuleBg" class="hidden text-sm leading-relaxed text-slate-600 dark:text-slate-300 mb-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800">${point.rule_bg}</p>

      <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-4 mb-2">Examples</p>
      <div class="space-y-2 mb-5">
        ${point.examples.map(ex => `
          <div class="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <p class="text-sm">${ex.en}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${ex.bg}</p>
          </div>`).join('')}
      </div>

      <button onclick="startGrammarQuiz()" class="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">Start the 5-question check →</button>
    </div>`;
}

function startGrammarQuiz() {
  grammarTopic.index = 0;
  grammarTopic.score = 0;
  grammarTopic.checked = false;
  renderGrammarQuestion();
}

function renderGrammarQuestion() {
  const { point, index } = grammarTopic;
  const it = point.exercises[index];
  grammarTopic.checked = false;

  document.getElementById('grammarBox').innerHTML = `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <span class="text-xs font-bold text-brand-500">${point.title}</span>
        <span class="text-xs text-slate-500 dark:text-slate-400">${index + 1} / ${point.exercises.length} · Score: ${grammarTopic.score}</span>
      </div>
      <p class="text-lg leading-relaxed mb-5">${it.sentence}</p>
      <div class="space-y-2.5">
        ${it.options.map((opt, i) => `
          <button data-opt="${i}" onclick="grammarAnswer(${i})"
            class="opt-btn w-full text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-medium hover:border-brand-500 dark:hover:border-brand-500 transition-colors">
            ${opt}
          </button>`).join('')}
      </div>
      <div id="grammarFeedback" class="mt-3"></div>
    </div>`;
}

function grammarAnswer(i) {
  if (grammarTopic.checked) return;
  grammarTopic.checked = true;
  const it = grammarTopic.point.exercises[grammarTopic.index];
  const correct = i === it.correct;
  if (correct) grammarTopic.score++;

  document.querySelectorAll('.opt-btn').forEach(btn => {
    const idx = +btn.dataset.opt;
    btn.disabled = true;
    if (idx === it.correct) btn.className += ' !bg-emerald-100 dark:!bg-emerald-900/50 !border-emerald-500';
    else if (idx === i) btn.className += ' !bg-rose-100 dark:!bg-rose-900/40 !border-rose-500';
  });

  document.getElementById('grammarFeedback').innerHTML = `
    <button onclick="grammarNext()" class="w-full mt-1 py-2.5 rounded-xl bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-bold text-sm">
      ${correct ? 'Correct! Continue →' : 'Continue →'}
    </button>`;
}

function grammarNext() {
  grammarTopic.index++;
  if (grammarTopic.index < grammarTopic.point.exercises.length) renderGrammarQuestion();
  else renderGrammarEnd();
}

function renderGrammarEnd() {
  const { point, score } = grammarTopic;
  const total = point.exercises.length;
  const prevBest = grammarBest()[point.id];
  const isRecord = prevBest === undefined || score > prevBest;
  saveGrammarBest(point.id, score);
  markDayDone();

  const msg =
    score === total ? 'Perfect. That rule is yours now. 🏆' :
    score >= total * 0.7 ? 'Strong result. One more pass and it will stick.' :
    'Good practice. Reread the rule above and try again.';

  document.getElementById('grammarBox').innerHTML = `
    <div class="text-center py-6 fade-in">
      <p class="text-4xl mb-3">${score >= total * 0.7 ? '🎉' : '💪'}</p>
      <h2 class="text-xl font-extrabold mb-2">${point.title}: ${score} / ${total}</h2>
      ${isRecord ? '<p class="text-sm font-semibold text-emerald-500 mb-2">New personal best!</p>' : ''}
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">${msg}</p>
      <div class="flex gap-2 justify-center">
        <button onclick="startGrammarQuiz()" class="px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">Try again</button>
        <button onclick="renderGrammarMenu()" class="px-6 py-3 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-sm hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors">All grammar</button>
      </div>
    </div>`;
}

// ---------- Dialogues ----------

let dlg = null; // { list, item, role, playing, index }

// Two different English voices, so the two speakers don't sound identical
function voicePair() {
  const voices = speechSynthesis.getVoices()
    .filter(v => /^en[-_](US|GB)/i.test(v.lang));
  if (!voices.length) return [null, null];
  return [voices[0], voices[1] || voices[0]];
}

function speakAs(text, speaker, onDone) {
  if (!('speechSynthesis' in window)) { onDone && onDone(); return; }
  const [vA, vB] = voicePair();
  const u = new SpeechSynthesisUtterance(text);
  const v = speaker === 'A' ? vA : vB;
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
  u.rate = 0.9;
  u.pitch = speaker === 'A' ? 1 : 0.85; // extra separation when only one voice exists
  u.onend = () => onDone && onDone();
  u.onerror = () => onDone && onDone();
  speechSynthesis.speak(u);
}

function dialoguesForDeck() {
  return dialogues[deckId] || [];
}

function renderDialogueList() {
  const list = dialoguesForDeck();
  dlg = null;
  speechSynthesis.cancel();

  document.getElementById('uoeBox').innerHTML = `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <button onclick="renderUoeMenu()" class="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-500">← Menu</button>
        <span class="text-xs text-slate-500 dark:text-slate-400">💬 Dialogues</span>
      </div>
      ${list.length ? `
        <div class="space-y-2.5">
          ${list.map((d, i) => `
            <button onclick="openDialogue(${i})"
              class="w-full text-left px-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-brand-500 transition-colors">
              <span class="block font-bold text-sm">${d.title}</span>
              <span class="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">${d.setting}</span>
              <span class="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-widest text-brand-500">Level ${d.level} · ${d.lines.length} lines</span>
            </button>`).join('')}
        </div>`
        : '<p class="text-sm text-slate-500 dark:text-slate-400">No dialogues for this topic yet.</p>'}
    </div>`;
}

function openDialogue(i) {
  dlg = { item: dialoguesForDeck()[i], role: null, playing: false, index: 0 };
  renderDialogue();
}

function renderDialogue() {
  const d = dlg.item;
  const nameOf = s => (d.speakers && d.speakers[s]) || s;

  document.getElementById('uoeBox').innerHTML = `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-3">
        <button onclick="renderDialogueList()" class="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-500">← Dialogues</button>
        <span class="text-xs text-slate-500 dark:text-slate-400">Level ${d.level}</span>
      </div>
      <p class="font-extrabold text-lg">${d.title}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">${d.setting}</p>

      <div class="flex flex-wrap gap-2 mb-4">
        <button id="dlgPlay" onclick="playDialogue()" class="px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">▶ Play all</button>
        <button onclick="setRole('A')" class="px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${dlg.role === 'A' ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-800'}">🎭 Read as ${nameOf('A')}</button>
        <button onclick="setRole('B')" class="px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${dlg.role === 'B' ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-800'}">🎭 Read as ${nameOf('B')}</button>
      </div>

      ${dlg.role ? `<p class="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 rounded-xl p-3 mb-3">
        Your lines are highlighted. The app reads ${nameOf(dlg.role === 'A' ? 'B' : 'A')} and waits for you.</p>` : ''}

      <div id="dlgLines" class="space-y-2">
        ${d.lines.map((l, i) => `
          <div id="dlgLine${i}" class="flex gap-2 ${l.s === 'A' ? '' : 'flex-row-reverse'}">
            <div class="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm ${
              dlg.role === l.s
                ? 'bg-amber-100 dark:bg-amber-900/40 border border-amber-400'
                : l.s === 'A'
                  ? 'bg-slate-100 dark:bg-slate-800'
                  : 'bg-brand-50 dark:bg-slate-700'}">
              <span class="block text-[10px] font-bold uppercase tracking-widest opacity-60">${nameOf(l.s)}</span>
              ${l.t}
            </div>
            <button onclick="speakAs(${JSON.stringify(l.t).replace(/"/g, '&quot;')}, '${l.s}')"
              class="self-center text-xs opacity-50 hover:opacity-100">🔊</button>
          </div>`).join('')}
      </div>
    </div>`;
}

function setRole(r) {
  dlg.role = dlg.role === r ? null : r;
  speechSynthesis.cancel();
  renderDialogue();
}

function playDialogue() {
  const btn = document.getElementById('dlgPlay');
  if (dlg.playing) {
    speechSynthesis.cancel();
    dlg.playing = false;
    btn.textContent = '▶ Play all';
    clearHighlight();
    return;
  }
  dlg.playing = true;
  dlg.index = 0;
  btn.textContent = '⏸ Stop';
  stepDialogue();
}

function clearHighlight() {
  dlg.item.lines.forEach((_, i) =>
    document.getElementById('dlgLine' + i)?.classList.remove('ring-2', 'ring-brand-500', 'rounded-2xl'));
}

function stepDialogue() {
  if (!dlg || !dlg.playing) return;
  const lines = dlg.item.lines;

  if (dlg.index >= lines.length) {
    dlg.playing = false;
    const btn = document.getElementById('dlgPlay');
    if (btn) btn.textContent = '▶ Play all';
    clearHighlight();
    return;
  }

  const line = lines[dlg.index];
  clearHighlight();
  document.getElementById('dlgLine' + dlg.index)
    ?.classList.add('ring-2', 'ring-brand-500', 'rounded-2xl');

  // In role-play the app stays quiet on your lines and leaves you a gap to speak
  const isYours = dlg.role === line.s;
  const nextStep = () => { dlg.index++; setTimeout(stepDialogue, 250); };
  if (isYours) setTimeout(nextStep, 400 + line.t.length * 55);
  else speakAs(line.t, line.s, nextStep);
}

// The full list, for reading rather than testing
function browseMistakes() {
  const byCat = {};
  for (const m of mistakes) (byCat[m.category] ||= []).push(m);

  document.getElementById('uoeBox').innerHTML = `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-4">
        <button onclick="renderUoeMenu()" class="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand-500">← Menu</button>
        <span class="text-xs text-slate-500 dark:text-slate-400">🚫 ${mistakes.length} common mistakes</span>
      </div>
      ${Object.entries(byCat).map(([cat, list]) => `
        <p class="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-4 mb-2 first:mt-0">${cat}</p>
        <div class="space-y-2">
          ${list.map(m => `
            <div class="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm">
              <p class="text-rose-600 dark:text-rose-400 line-through">${m.wrong}</p>
              <p class="text-emerald-600 dark:text-emerald-400 font-semibold">${m.right}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${m.why}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">${m.why_bg}</p>
            </div>`).join('')}
        </div>`).join('')}
    </div>`;
}

let recogniser = null;

function startListening() {
  if (uoe.checked || !speechSupported()) return;
  const btn = document.getElementById('micBtn');
  const fb = document.getElementById('uoeFeedback');

  if (recogniser) { try { recogniser.abort(); } catch {} }
  recogniser = new SpeechRec();
  recogniser.lang = 'en-US';
  recogniser.interimResults = false;
  recogniser.maxAlternatives = 3;

  btn.textContent = '🔴 Listening…';
  btn.disabled = true;
  fb.innerHTML = '';

  recogniser.onresult = e => {
    const target = uoe.items[uoe.index].target;
    // The engine offers several guesses; take the friendliest one
    let best = { text: '', score: 0 };
    for (const alt of e.results[0]) {
      const s = similarity(alt.transcript, target);
      if (s > best.score) best = { text: alt.transcript, score: s };
    }
    gradeSpeaking(best.text, best.score);
  };

  recogniser.onerror = e => {
    btn.textContent = '🎤 Tap and speak';
    btn.disabled = false;
    const msg = e.error === 'not-allowed'
      ? 'Microphone blocked. Allow it in the address bar, then try again.'
      : e.error === 'no-speech'
        ? "I didn't hear anything. Try again, a little louder."
        : 'Something went wrong with the microphone. Try again.';
    fb.innerHTML = `<div class="p-3 rounded-xl text-sm bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">${msg}</div>`;
  };

  recogniser.onend = () => {
    if (!uoe.checked) { btn.textContent = '🎤 Tap and speak'; btn.disabled = false; }
  };

  try { recogniser.start(); }
  catch { btn.textContent = '🎤 Tap and speak'; btn.disabled = false; }
}

function gradeSpeaking(heard, score) {
  if (uoe.checked) return;
  uoe.checked = true;
  const it = uoe.items[uoe.index];
  const good = score >= 0.8;
  // A second attempt still gives feedback, but the point is already gone
  if (good && !it.retried) uoe.score++;

  const btn = document.getElementById('micBtn');
  btn.disabled = true;
  btn.textContent = good ? '✅ Nice' : '↻ Try again';

  document.getElementById('uoeFeedback').innerHTML = `
    <div class="fade-in p-3 rounded-xl text-sm ${good
      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'}">
      <p class="font-bold mb-1">${good ? 'That sounded right! 👏' : 'Close, but not quite.'}</p>
      <p>I heard: <b>“${heard || '—'}”</b></p>
      ${good ? '' : `<p class="mt-1">Target: <b>${it.target}</b></p>`}
    </div>
    <div class="flex gap-2 mt-3">
      ${good ? '' : `<button onclick="retrySpeaking()" class="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 font-semibold text-sm">🎤 Again</button>`}
      <button onclick="uoeNext()" class="flex-1 py-2.5 rounded-xl bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-bold text-sm">Continue →</button>
    </div>`;
}

// A retry doesn't award the point that was already missed
function retrySpeaking() {
  uoe.checked = false;
  const btn = document.getElementById('micBtn');
  btn.disabled = false;
  btn.textContent = '🎤 Tap and speak';
  document.getElementById('uoeFeedback').innerHTML = '';
  uoe.items[uoe.index].retried = true;
  startListening();
}

function uoeSpeakingSkip() {
  if (uoe.checked) return;
  uoe.checked = true;
  if (recogniser) { try { recogniser.abort(); } catch {} }
  uoeNext();
}

function uoePlay() {
  speak(uoe.items[uoe.index].audio);
}

function uoeNext() {
  uoe.index++;
  if (uoe.mode === 'own') {
    if (uoe.index >= uoe.items.length) uoe.items = shuffle(words), uoe.index = 0;
    renderUoeItem();
    return;
  }
  if (uoe.index < uoe.items.length) renderUoeItem();
  else renderUoeEnd();
}

function renderUoeEnd() {
  const { mode, score, items } = uoe;
  const prevBest = getUoeBest()[mode];
  const isRecord = prevBest === undefined || score > prevBest;
  saveUoeBest(mode, score);
  markDayDone();
  checkAchievements();

  const msg =
    score === items.length ? 'Perfect round! 🏆' :
    score >= items.length * 0.7 ? 'Strong result. Keep going!' :
    'Good practice. The cards are your friend, then try again.';

  document.getElementById('uoeBox').innerHTML = `
    <div class="text-center py-6 fade-in">
      <p class="text-4xl mb-3">${score >= items.length * 0.7 ? '🎉' : '💪'}</p>
      <h2 class="text-xl font-extrabold mb-2">${UOE_MODES[mode].title}: ${score} / ${items.length}</h2>
      ${isRecord ? '<p class="text-sm font-semibold text-emerald-500 mb-2">New personal best!</p>' : ''}
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">${msg}</p>
      <div class="flex gap-2 justify-center">
        <button onclick="startUoe('${mode}')" class="px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition-colors">Try again</button>
        <button onclick="renderUoeMenu()" class="px-6 py-3 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-sm hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors">All exercises</button>
      </div>
    </div>`;
}
