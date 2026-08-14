// WorkTalk — ESL flashcards + quiz for adult learners
// Vanilla JS, no dependencies. Data lives in words.json.

const THEME_KEY = 'worktalk_theme';
const DECK_KEY = 'worktalk_deck';

const BRAND = {
  school: 'Language Workshop',
  ctaUrl: 'mailto:emiliya.handzhiyska@gmail.com?subject=Lesson%20inquiry%20(via%20WorkTalk)'
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
let currentCard = 0;
let mastered = new Set();
let quiz = null; // { questions, index, score, locked }
let uoe = null;  // { mode, items, index, score, checked }

// ---------- Boot ----------

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  migrateOldKeys();
  document.getElementById('ctaLink').href = BRAND.ctaUrl;

  try {
    const dRes = await fetch('decks.json');
    if (!dRes.ok) throw new Error(dRes.statusText);
    decks = await dRes.json();

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
});

// ---------- Decks ----------

async function loadDeck(id) {
  deckId = id;
  localStorage.setItem(DECK_KEY, id);
  const d = decks.find(x => x.id === id);

  const [wRes, eRes] = await Promise.all([fetch(d.words), fetch(d.exercises)]);
  if (!wRes.ok || !eRes.ok) throw new Error('deck load failed');
  words = await wRes.json();
  exercises = await eRes.json();

  currentCard = 0;
  quiz = null;
  uoe = null;
  loadProgress();

  document.getElementById('tagline').textContent =
    `${d.name} · ${words.length} phrases you'll actually use.`;

  renderDeckPicker();
  renderCard();
  renderProgress();
  renderQuizStart();
  renderUoeMenu();
}

function renderDeckPicker() {
  document.getElementById('deckPicker').innerHTML = decks.map(d => `
    <button onclick="switchDeckTo('${d.id}')"
      class="text-left px-4 py-3 rounded-2xl border transition-colors ${d.id === deckId
        ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-brand-500 dark:hover:border-brand-500'}">
      <span class="block text-sm font-bold">${d.icon} ${d.name}</span>
      <span class="block text-xs mt-0.5 ${d.id === deckId
        ? 'text-white/80'
        : 'text-slate-500 dark:text-slate-400'}">${d.tagline}</span>
    </button>`).join('');
}

async function switchDeckTo(id) {
  if (id !== deckId) await loadDeck(id);
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
}

// ---------- Tabs ----------

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  styleTabs('flashcards');

  const card = document.getElementById('flashcard');
  card.addEventListener('click', e => {
    if (e.target.closest('#ttsBtn')) return; // listen button shouldn't flip
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
    speak(words[currentCard].audio_text);
  });
}

function switchTab(tab) {
  document.getElementById('viewFlashcards').classList.toggle('hidden', tab !== 'flashcards');
  document.getElementById('viewQuiz').classList.toggle('hidden', tab !== 'quiz');
  document.getElementById('viewUoe').classList.toggle('hidden', tab !== 'uoe');
  styleTabs(tab);
  if (tab === 'quiz' && !quiz) renderQuizStart();
  if (tab === 'uoe' && !uoe) renderUoeMenu();
}

function styleTabs(active) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === active;
    btn.setAttribute('aria-selected', isActive);
    btn.className = 'tab-btn py-2.5 rounded-xl font-semibold text-sm transition-colors ' +
      (isActive
        ? 'bg-white dark:bg-slate-700 text-brand-600 dark:text-white shadow-sm'
        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200');
  });
}

// ---------- Flashcards ----------

function moveCard(step) {
  currentCard = (currentCard + step + words.length) % words.length;
  renderCard();
}

function renderCard() {
  const w = words[currentCard];
  const card = document.getElementById('flashcard');

  // Reset flip without animating backwards through the old content
  const inner = card.querySelector('.flip-inner');
  inner.style.transition = 'none';
  card.classList.remove('flipped');
  requestAnimationFrame(() => { inner.style.transition = ''; });

  document.getElementById('cardPhrase').textContent = w.phrase;
  document.getElementById('cardDefinition').textContent = w.definition;
  document.getElementById('cardExample').textContent = '“' + w.business_context_example + '”';
  document.getElementById('cardCounter').textContent = `${currentCard + 1} / ${words.length}`;

  renderMasterBtn();
}

function renderMasterBtn() {
  const btn = document.getElementById('masterBtn');
  const isMastered = mastered.has(words[currentCard].phrase);
  btn.textContent = isMastered ? '★ Mastered — tap to unmark' : '✓ Mark as mastered';
  btn.className = 'w-full mt-4 py-3 rounded-xl font-bold text-sm transition-colors ' +
    (isMastered
      ? 'bg-amber-400 hover:bg-amber-500 text-amber-950'
      : 'bg-emerald-500 hover:bg-emerald-600 text-white');
}

function toggleMastered() {
  const phrase = words[currentCard].phrase;
  if (mastered.has(phrase)) mastered.delete(phrase);
  else mastered.add(phrase);
  saveMastered();
  renderMasterBtn();
  renderProgress();
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

function speak(text) {
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
  u.rate = 0.9; // slightly slower for learners
  speechSynthesis.speak(u);
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
  const scored = ['cloze', 'open', 'transform', 'wordform'];
  document.getElementById('uoeBox').innerHTML = `
    <div class="fade-in">
      <h2 class="text-xl font-extrabold mb-1">Use of English</h2>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-5">Exam-style practice with the phrases from your cards.</p>
      <div class="space-y-2.5">
        ${Object.entries(UOE_MODES).map(([mode, m]) => `
          <button onclick="startUoe('${mode}')"
            class="w-full text-left px-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-brand-500 dark:hover:border-brand-500 transition-colors flex items-center gap-3">
            <span class="text-2xl">${m.icon}</span>
            <span class="flex-1">
              <span class="block font-bold text-sm">${m.title}</span>
              <span class="block text-xs text-slate-500 dark:text-slate-400">${m.desc}</span>
            </span>
            ${scored.includes(mode) && best[mode] !== undefined
              ? `<span class="text-xs font-semibold text-brand-500">Best: ${best[mode]}/${UOE_ROUND}</span>` : ''}
          </button>`).join('')}
      </div>
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
  if (uoe.mode === 'open') {
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
