import {
  dueCards, loadState, parseRoute, recordQuiz, recordRecall, routeFor,
  saveState, searchCards, shuffled, visibleIn
} from './model.js';

const $ = id => document.getElementById(id);
const trackButtons = document.querySelectorAll('[data-track]');
const modeButtons = document.querySelectorAll('[data-mode]');
const stage = $('stage');
const results = $('results');

let storage;
try { storage = window.localStorage; } catch { /* Storage can be disabled. */ }

let cards = [];
let topics = {};
let state;
let track = null;
let level = 'ordinary';
let topic = 'all';
let mode = 'learn';
let pool = [];
let index = 0;
let selected = -1;
let revealed = false;
let round;
let retrying = false;
let auto = false;
let seconds = 6;
let timer;
let catalogue;
let requestedTrack;

const html = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const reading = card => card.parts.map(([, phrase]) => phrase).join(' ');
const progress = () => state.progress[track];
const cardTopic = card => track === 'lc' ? card.lc.topic : card.uni;
const trackCards = () => topics[track].flatMap(({ id }) => {
  const visible = cards.filter(card => visibleIn(card, track, level) && cardTopic(card) === id);
  const pinned = catalogue.order?.[id] ?? [];
  return [...pinned.map(pin => visible.find(card => card.id === pin)).filter(Boolean),
    ...visible.filter(card => !pinned.includes(card.id))];
});
const topicLabel = card => topics[track].find(item => item.id === cardTopic(card))?.title;
const activeCard = () => mode === 'quiz' ? round?.cards[round.index] : pool[index];

async function json(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Catalogue request failed: ' + response.status);
  return response.json();
}

async function start() {
  catalogue = await json('./content/catalogue.json');
  topics = catalogue.topics;
  const packs = await Promise.all(catalogue.packs.map(path => json('./content/' + path)));
  cards = packs.flat();
  state = loadState(storage, cards);
  saveState(storage, state);
  level = state.level === 'higher' ? 'higher' : 'ordinary';
  if (requestedTrack) setTrack(requestedTrack, undefined, undefined, { focus: true });
  else restoreRoute();
}

function announce(message = '') {
  const notice = $('notice');
  notice.hidden = !message;
  notice.textContent = message;
}

function button(action, label, options = {}) {
  const { primary, disabled, attrs = '' } = options;
  return '<button type="button" class="btn' + (primary ? ' primary' : '') + '" data-action="' +
    action + '"' + (disabled ? ' disabled' : '') + ' ' + attrs + '>' + label + '</button>';
}

function showHome(writeRoute = true) {
  clearTimeout(timer);
  track = null;
  auto = false;
  $('workspace').hidden = true;
  $('welcome').hidden = false;
  for (const btn of $('tracks').querySelectorAll('button')) btn.setAttribute('aria-pressed', 'false');
  if (writeRoute && location.hash) history.pushState(null, '', location.pathname + location.search);
}

function setTrack(next, nextLevel, id, { writeRoute = true, focus = false } = {}) {
  track = next;
  level = nextLevel ?? level;
  state.lastTrack = next;
  state.level = level;
  saveState(storage, state);
  mode = 'learn';
  topic = 'all';
  auto = false;
  $('level').value = level;
  $('search').value = '';
  $('saved-only').checked = false;
  $('level-label').hidden = track !== 'lc';
  $('syllabus').hidden = track !== 'lc';
  $('topic-label').textContent = track === 'lc' ? 'Strand' : 'Branch of maths';
  $('track-heading').textContent = track === 'lc' ? 'Leaving Cert Maths' : 'University Maths';
  $('track-description').textContent = track === 'lc'
    ? 'Find the notation for your exam level.'
    : 'Explore notation from your maths modules.';
  $('topic').replaceChildren(new Option('All topics', 'all'), ...topics[track].map(item => new Option(item.title, item.id)));
  for (const btn of $('tracks').querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.track === track));
  $('welcome').hidden = true;
  $('workspace').hidden = false;
  resetPool(id);
  const found = !id || pool.some(card => card.id === id);
  announce(found ? '' : 'That card is unavailable in this track or level. Choose a card from the library.');
  if (writeRoute) pushRoute(found ? id : undefined);
  if (focus) $('track-heading').focus();
}

function pushRoute(id) {
  const hash = routeFor(track, level, id);
  if (location.hash !== hash) history.pushState(null, '', hash);
}

function restoreRoute() {
  if (!state) return;
  const route = parseRoute(location.hash);
  if (route) setTrack(route.track, route.level, route.id, { writeRoute: false });
  else if (location.hash === '#main') return;
  else if (state.lastTrack === 'uni' || state.lastTrack === 'lc') {
    setTrack(state.lastTrack, level, undefined, { writeRoute: false });
  } else showHome(false);
}

function available() {
  return trackCards().filter(card => topic === 'all' || cardTopic(card) === topic);
}

function filtered() {
  const matching = available().filter(card => !$('saved-only').checked || progress().saved.includes(card.id));
  return searchCards(matching, $('search').value);
}

function resetPool(id) {
  retrying = false;
  pool = mode === 'review' ? dueCards(available(), progress()).slice(0, 10) : filtered();
  index = Math.max(0, pool.findIndex(card => card.id === id));
  selected = -1;
  revealed = false;
  round = mode === 'quiz' ? newRound(shuffled(pool).slice(0, 10)) : undefined;
  render();
}

function missedCards() {
  return available().filter(card => progress().review[card.id]?.step === -1);
}

function newRound(items) {
  return { cards: items, index: 0, answered: null, options: [], correct: 0, missed: [], done: false };
}

function renderStats() {
  const eligible = trackCards();
  const data = progress();
  const open = new Set(data.opened);
  $('opened').textContent = eligible.filter(card => open.has(card.id)).length;
  let attempts = data.attempts;
  let correct = data.correct;
  if (track === 'lc') {
    attempts = eligible.reduce((total, card) => total + (data.answers[card.id]?.attempts ?? 0), 0);
    correct = eligible.reduce((total, card) => total + (data.answers[card.id]?.correct ?? 0), 0);
  }
  $('accuracy').textContent = attempts ? Math.round(correct / attempts * 100) + '%' : '—';
  const due = dueCards(eligible, data).length;
  $('due-count').hidden = !due;
  $('due-count').textContent = due;
  $('due-count').setAttribute('aria-label', due + ' due');
}

function renderMatches() {
  const searching = Boolean($('search').value.trim());
  const show = mode === 'learn' && pool.length && (searching || topic !== 'all' || $('saved-only').checked);
  results.hidden = !show;
  if (!show) {
    results.replaceChildren();
    return;
  }
  const matchLabel = pool.length === 1 ? '1 card' : pool.length + ' cards';
  const matches = pool.slice(0, 24).map((card, i) =>
    '<button type="button" class="btn match" data-action="open" data-index="' + i +
    '" aria-pressed="' + (i === index) + '"><span>' + html(card.notation) + '</span><small>' +
    html(card.title) + '</small></button>').join('');
  results.innerHTML = '<p class="results-head" role="status">' + matchLabel +
    (pool.length > 24 ? ' · First 24 shown. Refine your search or use Next card.' : '') +
    '</p><div class="matches">' + matches + '</div>';
}

function explanation(card) {
  const phrases = card.parts.map(([, text], i) =>
    '<button type="button" class="phrase" data-part="' + i + '" aria-pressed="' +
    (selected === i) + '">' + html(text) + '</button>').join(' ');
  return '<section class="plain"><h2>In plain English</h2><div>' + phrases +
    '</div></section><div class="details"><section><h2>Worked example</h2><p>' +
    html(card.example) + '</p></section><section><h2>Common misreading</h2><p>' +
    html(card.note) + '</p></section></div>';
}

function expression(card, interactive) {
  if (!interactive) return '<div class="expression" role="math">' + html(card.notation) + '</div>';
  const tokens = card.parts.map(([token], i) =>
    '<button type="button" class="token" data-part="' + i + '" aria-pressed="' +
    (selected === i) + '" aria-label="Explain ' + html(token) + '">' + html(token) + '</button>').join(' ');
  return '<div class="expression" aria-label="Notation parts">' + tokens + '</div>';
}

function cardShell(card, content, interactive) {
  const isSaved = progress().saved.includes(card.id);
  return '<article class="card" aria-label="' + html(interactive ? card.title : 'Notation card') + '"><div class="card-head">' +
    '<span class="category">' + html(topicLabel(card)) + '</span><div class="card-actions">' +
    button('save', isSaved ? 'Saved' : 'Save', { attrs: 'aria-label="Save card" aria-pressed="' + isSaved + '"' }) +
    button('share', 'Copy link') + '</div></div>' + expression(card, interactive) + content + '</article>';
}

function learnView(card) {
  if (!progress().opened.includes(card.id)) {
    progress().opened.push(card.id);
    saveState(storage, state);
  }
  return cardShell(card, explanation(card), true) + '<div class="controls">' +
    button('prev', '← Previous', { disabled: pool.length < 2 }) +
    '<span class="position">' + (index + 1) + ' of ' + pool.length + '</span><span class="spacer"></span>' +
    button('next', 'Next card →', { primary: true, disabled: pool.length < 2 }) + '</div>';
}

function quizView(card) {
  if (!round.options.length) {
    round.options = shuffled([{ text: reading(card), correct: true },
      ...card.wrong.map(text => ({ text, correct: false }))]);
  }
  const options = round.options.map((option, i) => {
    const answered = round.answered !== null;
    const style = answered && (option.correct ? ' correct' : round.answered === i ? ' wrong' : '') || '';
    return '<button type="button" class="btn option' + style + '" data-action="answer" data-index="' +
      i + '"' + (answered ? ' disabled' : '') + '>' + html(option.text) + '</button>';
  }).join('');
  const correct = round.options[round.answered]?.correct;
  const feedback = round.answered === null ? '' :
    '<div class="feedback" tabindex="-1" id="quiz-feedback" role="status"><strong>' +
    (correct ? 'Correct.' : 'The correct reading is ' + html(reading(card))) +
    '</strong><p>' + html(card.example) + '</p><p>' + html(card.note) + '</p></div>';
  return cardShell(card, '<p class="question">Which reading matches this notation?</p>' + options + feedback, false) +
    '<div class="controls"><span class="position">Question ' + (round.index + 1) + ' of ' +
    round.cards.length + '</span><span class="spacer"></span>' +
    button('quiz-next', round.index + 1 === round.cards.length ? 'See results' : 'Next question →',
      { primary: true, disabled: round.answered === null }) + '</div>';
}

function quizSummary() {
  return '<section class="empty"><h2 id="round-heading" tabindex="-1">Quiz complete</h2><p class="round-result">' +
    round.correct + ' / ' + round.cards.length + '</p><div class="controls">' +
    (round.missed.length ? button('retry', 'Retry missed cards', { primary: true }) : '') +
    button('restart', 'New round') + '</div></section>';
}

function recallView(card) {
  const review = mode === 'review';
  const content = revealed ? explanation(card) :
    '<p class="flash-note">Say what the notation means, then check your answer.</p>' +
    button('reveal', 'Reveal translation', { primary: true });
  const autoControl = review ? '' :
    '<label class="check"><input type="checkbox" id="auto" ' + (auto ? 'checked' : '') + '> Auto</label>' +
    '<select id="seconds" aria-label="Seconds before reveal">' + [4, 6, 10].map(value =>
      '<option value="' + value + '"' + (seconds === value ? ' selected' : '') + '>' +
      value + ' seconds</option>').join('') + '</select><span class="spacer"></span>' + button('next', 'Skip →');
  const ratings = revealed
    ? button('again', 'Practise again') + button('known', 'Got it', { primary: true })
    : '';
  return cardShell(card, content, revealed) + '<div class="controls"><span class="position">' +
    (review ? (retrying ? 'Retry · ' : 'Due · ') + pool.length + ' left' : (index + 1) + ' of ' + pool.length) +
    '</span><span class="spacer"></span>' + ratings + autoControl + '</div>';
}

function render() {
  clearTimeout(timer);
  $('filters').hidden = mode === 'review';
  for (const btn of modeButtons) btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  renderMatches();
  const card = activeCard();
  if (mode === 'quiz' && round.done) {
    stage.innerHTML = quizSummary();
  } else if (!card) {
    const [heading, detail] = mode === 'review'
      ? [retrying ? 'Retry complete' : 'No cards due here', 'Practise in Quiz or Rapid Fire to build your review queue.']
      : ['No matching cards', 'Try another search, topic, or turn off Saved only.'];
    stage.innerHTML = '<section class="empty"><h2 tabindex="-1" id="empty-heading">' +
      heading + '</h2><p>' + detail + '</p></section>';
  } else if (mode === 'learn') {
    stage.innerHTML = learnView(card);
  } else if (mode === 'quiz') {
    stage.innerHTML = quizView(card);
  } else {
    stage.innerHTML = recallView(card);
    if (mode === 'flash' && auto && !document.hidden) {
      timer = setTimeout(() => {
        if (revealed) move(1);
        else {
          revealed = true;
          render();
        }
      }, (revealed ? Math.max(seconds, 5) : seconds) * 1000);
    }
  }
  if (mode === 'review' && !retrying && missedCards().length) {
    stage.insertAdjacentHTML('afterbegin', '<div class="filters">' +
      button('review-missed', 'Retry missed cards (' + missedCards().length + ')') + '</div>');
  }
  if (mode === 'review' && retrying) {
    stage.insertAdjacentHTML('beforeend', '<div class="controls">' + button('review-due', 'Back to due cards') + '</div>');
  }
  renderStats();
}

function selectPart(btn) {
  selected = Number(btn.dataset.part);
  stage.querySelectorAll('[data-part]').forEach(part => part.setAttribute('aria-pressed', String(Number(part.dataset.part) === selected)));
  const [, phrase] = activeCard().parts[selected];
  $('part-status').textContent = btn.classList.contains('token') ? phrase : activeCard().parts[selected][0];
}

function move(delta) {
  if (!pool.length) return;
  index = (index + delta + pool.length) % pool.length;
  selected = -1;
  revealed = false;
  announce();
  render();
}

function focusCard() {
  const target = stage.querySelector('[data-part], [data-action="answer"], [data-action="reveal"], h2');
  if (target) target.focus();
}

function toggleSaved(card) {
  const saved = progress().saved;
  const wasSaved = saved.includes(card.id);
  progress().saved = wasSaved ? saved.filter(id => id !== card.id) : [...saved, card.id];
  saveState(storage, state);
  announce(wasSaved ? 'Card removed from saved.' : 'Card saved.');
  if (wasSaved && $('saved-only').checked && mode !== 'review' && mode !== 'quiz') {
    resetPool();
    (stage.querySelector('[data-action="save"]') ?? $('saved-only')).focus();
  } else {
    const btn = stage.querySelector('[data-action="save"]');
    btn.setAttribute('aria-pressed', String(!wasSaved));
    btn.textContent = wasSaved ? 'Save' : 'Saved';
  }
}

async function copyLink(card) {
  const url = new URL(routeFor(track, level, card.id), location.href).href;
  try {
    await navigator.clipboard.writeText(url);
    announce('Card link copied.');
  } catch {
    announce();
    const notice = $('notice');
    notice.hidden = false;
    const label = document.createElement('label');
    label.textContent = 'Copy this card link ';
    const input = document.createElement('input');
    input.value = url;
    input.readOnly = true;
    label.append(input);
    notice.replaceChildren(label);
    input.focus();
    input.select();
  }
}

function answer(i) {
  if (round.answered !== null) return;
  const card = activeCard();
  const option = round.options[i];
  if (!option) return;
  round.answered = i;
  if (option.correct) round.correct++;
  else round.missed.push(card);
  recordQuiz(progress(), card.id, option.correct);
  saveState(storage, state);
  render();
  $('quiz-feedback').focus();
}

function rate(correct) {
  const card = activeCard();
  recordRecall(progress(), card.id, correct);
  saveState(storage, state);
  if (mode === 'review') {
    pool.splice(index, 1);
    index = Math.min(index, Math.max(0, pool.length - 1));
    revealed = false;
    selected = -1;
    render();
  } else move(1);
  announce(correct ? 'Next review scheduled for ' + progress().review[card.id].due + '.' : 'Added to review for tomorrow.');
  focusCard();
}

function activateMode(nextMode) {
  if (!track) return;
  mode = nextMode;
  auto = false;
  announce();
  resetPool();
}

function stageAction(btn) {
  const action = btn.dataset.action;
  const card = activeCard();
  switch (action) {
    case 'save': toggleSaved(card); break;
    case 'share': void copyLink(card); break;
    case 'prev':
    case 'next':
      move(action === 'prev' ? -1 : 1);
      stage.querySelector('[data-action="' + action + '"]')?.focus();
      break;
    case 'answer': answer(Number(btn.dataset.index)); break;
    case 'quiz-next':
      if (round.index + 1 === round.cards.length) round.done = true;
      else {
        round.index++;
        round.answered = null;
        round.options = [];
      }
      render();
      if (round.done) $('round-heading').focus();
      else focusCard();
      break;
    case 'retry':
      round = newRound(shuffled(round.missed));
      render();
      focusCard();
      break;
    case 'restart':
      resetPool();
      focusCard();
      break;
    case 'review-missed':
      pool = missedCards().slice(0, 10);
      index = 0;
      selected = -1;
      revealed = false;
      retrying = true;
      render();
      focusCard();
      break;
    case 'review-due':
      resetPool();
      focusCard();
      break;
    case 'reveal':
      revealed = true;
      render();
      stage.querySelector('[data-action="again"]').focus();
      break;
    case 'again': rate(false); break;
    case 'known': rate(true); break;
  }
}

for (const btn of trackButtons) {
  btn.addEventListener('click', () => {
    if (!state) {
      requestedTrack = btn.dataset.track;
    } else if (track !== btn.dataset.track || $('workspace').hidden) {
      setTrack(btn.dataset.track, undefined, undefined, { focus: true });
    }
  });
}
for (const btn of modeButtons) btn.addEventListener('click', () => activateMode(btn.dataset.mode));

$('home').addEventListener('click', () => {
  if (!state) return;
  state.lastTrack = null;
  saveState(storage, state);
  showHome();
  $('main').focus();
});
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  $('main').focus();
  $('main').scrollIntoView();
});
$('level').addEventListener('change', () => {
  if (track !== 'lc') return;
  level = $('level').value;
  state.level = level;
  saveState(storage, state);
  pushRoute();
  announce();
  resetPool();
});
$('topic').addEventListener('change', () => {
  topic = $('topic').value;
  announce();
  resetPool();
});
for (const [id, event] of [['search', 'input'], ['saved-only', 'change']]) {
  $(id).addEventListener(event, () => {
    announce();
    resetPool();
  });
}
results.addEventListener('click', event => {
  const btn = event.target.closest('[data-action="open"]');
  if (!btn) return;
  index = Number(btn.dataset.index);
  selected = -1;
  announce();
  pushRoute(pool[index].id);
  render();
  focusCard();
});
stage.addEventListener('click', event => {
  const btn = event.target.closest('button');
  if (!btn) return;
  if (btn.hasAttribute('data-part')) selectPart(btn);
  else stageAction(btn);
});
stage.addEventListener('change', event => {
  const id = event.target.id;
  if (id === 'auto') auto = event.target.checked;
  else if (id === 'seconds') seconds = Number(event.target.value);
  else return;
  render();
  $(id).focus();
});
document.addEventListener('keydown', event => {
  if (!track || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest?.('button, input, select, a, textarea, [contenteditable]')) return;
  if (event.code === 'Space' && (mode === 'flash' || mode === 'review') && !revealed && activeCard()) {
    event.preventDefault();
    revealed = true;
    render();
    stage.querySelector('[data-action="again"]').focus();
  } else if ((mode === 'learn' || mode === 'flash') && ['ArrowLeft', 'ArrowRight'].includes(event.key) && pool.length) {
    event.preventDefault();
    move(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden && track && mode === 'flash' && auto) render();
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  if (!location.hash) showHome(false);
  else restoreRoute();
});

start().catch(error => {
  console.error(error);
  $('load-error').textContent = 'The notation library could not be loaded. Refresh the page to try again.';
  $('load-error').hidden = false;
});
