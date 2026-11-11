const STATE_KEY = 'symbolingo-pilot-v1';
const LEGACY_KEY = 'notation-lab';
const REVIEW_INTERVALS = [1, 3, 7, 14];

function emptyProgress() {
  return { saved: [], opened: [], attempts: 0, correct: 0, answers: {}, review: {} };
}

function read(storage, key) {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function cardIds(values, lookup) {
  return Array.isArray(values) ? [...new Set(values.map(id => lookup.get(id)).filter(Boolean))] : [];
}

function count(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function loadState(storage, cards) {
  const stored = read(storage, STATE_KEY);
  if (stored?.version === 1 && stored.progress?.lc && stored.progress?.uni) return stored;
  const state = {
    version: 1,
    lastTrack: null,
    level: 'ordinary',
    progress: { lc: emptyProgress(), uni: emptyProgress() }
  };
  const legacy = read(storage, LEGACY_KEY);
  if (legacy) {
    const byOldId = new Map(cards.filter(card => Number.isInteger(card.legacyId)).map(card => [card.legacyId, card.id]));
    const uni = state.progress.uni;
    uni.saved = cardIds(legacy.saved, byOldId);
    uni.opened = cardIds(legacy.seen, byOldId);
    uni.attempts = count(legacy.attempts);
    uni.correct = Math.min(uni.attempts, count(legacy.correct));
  }
  return state;
}

export function saveState(storage, state) {
  try {
    storage?.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Practice can continue when the browser blocks or exhausts storage.
  }
}

export function visibleIn(card, track, level) {
  return track === 'uni' ? Boolean(card.uni) : Boolean(card.lc?.levels.includes(level));
}

export function parseRoute(hash) {
  const route = hash.match(/^#(uni)(?:\/([a-z0-9-]+))?$|^#(lc)\/(ordinary|higher)(?:\/([a-z0-9-]+))?$/);
  if (!route) return null;
  return route[1]
    ? { track: 'uni', id: route[2] }
    : { track: 'lc', level: route[4], id: route[5] };
}

export function routeFor(track, level, id) {
  const root = track === 'lc' ? '#lc/' + level : '#uni';
  return id ? root + '/' + id : root;
}

function symbolForm(value) {
  return value.normalize('NFC').replace(/\s+/g, '').replace(/[−–]/g, '-');
}

function wordForm(value) {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function searchCards(cards, query) {
  if (!query.trim()) return cards;
  const symbol = symbolForm(query.trim());
  const words = wordForm(query);
  const bars = /^\|[^|]*\|$/u.test(symbol) || ['|', 'bars', 'vertical bars', 'vertical bar'].includes(words);
  const ranked = [];
  for (const card of cards) {
    const names = [card.title, ...card.aliases];
    const notation = [card.notation, ...card.parts.map(([token]) => token), ...card.aliases].map(symbolForm);
    const reading = card.parts.map(([, phrase]) => phrase).join(' ');
    let score = 0;
    if (notation.includes(symbol) || names.some(name => wordForm(name) === words)) score = 4;
    else if (bars && card.meaning === 'vertical-bars') score = 3;
    else if (notation.some(token => token.includes(symbol))) score = 2;
    else if ([...names, reading].some(value => wordForm(value).includes(words))) score = 1;
    if (score) ranked.push({ card, score });
  }
  return ranked.sort((a, b) => b.score - a.score).map(item => item.card);
}

export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function recordRecall(progress, id, correct, now = new Date()) {
  const prior = progress.review[id];
  const step = correct ? Math.min((prior?.step ?? -1) + 1, REVIEW_INTERVALS.length - 1) : -1;
  const next = new Date(now);
  next.setDate(now.getDate() + (step < 0 ? 1 : REVIEW_INTERVALS[step]));
  progress.review[id] = { step, due: dayKey(next) };
}

export function recordQuiz(progress, id, correct, now = new Date()) {
  const result = progress.answers[id] ?? { attempts: 0, correct: 0 };
  result.attempts++;
  progress.attempts++;
  if (correct) {
    result.correct++;
    progress.correct++;
  }
  progress.answers[id] = result;
  recordRecall(progress, id, correct, now);
}

export function dueCards(cards, progress, now = new Date()) {
  const today = dayKey(now);
  return cards.filter(card => progress.review[card.id]?.due <= today)
    .sort((a, b) => progress.review[a.id].due.localeCompare(progress.review[b.id].due));
}

export function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
