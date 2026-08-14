// WorkTalk — ESL flashcards + quiz for adult learners
// Vanilla JS, no dependencies. Data lives in words.json.

const STORAGE_KEYS = {
  theme: 'worktalk_theme',
  mastered: 'worktalk_mastered',
  highScore: 'worktalk_high_score'
};

const QUIZ_LENGTH = 5;

let words = [];
let currentCard = 0;
let mastered = new Set();
let quiz = null; // { questions, index, score, locked }

// ---------- Boot ----------

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  loadProgress();

  try {
    const res = await fetch('words.json');
    if (!res.ok) throw new Error(res.statusText);
    words = await res.json();
  } catch (err) {
    // fetch() fails when index.html is opened straight from the file system
    // (file:// blocks it). Show a friendly hint instead of a blank screen.
    document.getElementById('viewFlashcards').innerHTML =
      '<div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 text-sm leading-relaxed">' +
      '<p class="font-bold mb-2">Couldn\'t load words.json</p>' +
      '<p>Open the app through a local server, for example:</p>' +
      '<code class="block mt-2 p-2 rounded bg-slate-100 dark:bg-slate-800">npx serve</code></div>';
    return;
  }

  document.getElementById('tagline').textContent =
    `Everyday English for work. ${words.length} phrases you'll actually use.`;

  bindEvents();
  renderCard();
  renderProgress();
  renderQuizStart();

  // Warm up the voice list; Chrome loads voices async.
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
});

// ---------- Theme ----------

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved ? saved === 'dark' : prefersDark;
  applyTheme(dark);

  document.getElementById('themeToggle').addEventListener('click', () => {
    const nowDark = !document.documentElement.classList.contains('dark');
    applyTheme(nowDark);
    localStorage.setItem(STORAGE_KEYS.theme, nowDark ? 'dark' : 'light');
  });
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  document.getElementById('themeIcon').textContent = dark ? '☀️' : '🌙';
}

// ---------- Progress (LocalStorage) ----------

function loadProgress() {
  try {
    mastered = new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.mastered) || '[]'));
  } catch {
    mastered = new Set();
  }
}

function saveMastered() {
  localStorage.setItem(STORAGE_KEYS.mastered, JSON.stringify([...mastered]));
}

function getHighScore() {
  const v = parseInt(localStorage.getItem(STORAGE_KEYS.highScore), 10);
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
  styleTabs(tab);
  if (tab === 'quiz' && !quiz) renderQuizStart();
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
  if (isRecord) localStorage.setItem(STORAGE_KEYS.highScore, String(score));
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
