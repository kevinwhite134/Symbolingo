import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  dayKey, dueCards, loadState, parseRoute, recordQuiz, recordRecall, routeFor,
  saveState, searchCards, visibleIn
} from '../dist/model.js';

async function content(file) {
  return JSON.parse(await readFile(new URL('../dist/content/' + file, import.meta.url), 'utf8'));
}

const manifest = await content('catalogue.json');
const cards = (await Promise.all(manifest.packs.map(content))).flat();
const byId = new Map(cards.map(card => [card.id, card]));
const eligible = (track, level) => cards.filter(card => visibleIn(card, track, level));
const storage = initial => {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const date = day => new Date(2026, 10, day, 12);

test('the catalogue has stable cards and level coverage for each syllabus section', () => {
  assert.equal(cards.length, byId.size);
  const legacy = cards.filter(card => Number.isInteger(card.legacyId));
  assert.deepEqual(legacy.map(card => card.legacyId).sort((a, b) => a - b), Array.from({ length: 51 }, (_, i) => i));
  const branchIds = new Set(manifest.topics.uni.map(topic => topic.id));
  const strandIds = new Set(manifest.topics.lc.map(topic => topic.id));
  for (const card of cards) {
    assert.match(card.id, /^[a-z0-9-]+$/);
    assert.ok(card.title && card.notation && card.example && card.note, card.id);
    assert.ok(card.parts.length && card.parts.every(part => part.length === 2 && part.every(Boolean)), card.id);
    assert.ok(card.wrong.length && card.wrong.every(Boolean), card.id);
    assert.equal(new Set([...card.wrong, card.parts.map(part => part[1]).join(' ')]).size, card.wrong.length + 1, card.id);
    assert.ok(card.aliases.length, card.id);
    assert.ok(card.uni || card.lc, card.id);
    if (card.uni) assert.ok(branchIds.has(card.uni), card.id);
    if (card.lc) {
      assert.ok(strandIds.has(card.lc.topic), card.id);
      assert.ok(card.lc.levels.includes('higher'), card.id);
      assert.ok(card.lc.levels.every(level => manifest.lcCurriculum.levels.includes(level)), card.id);
    }
  }
  for (const topic of manifest.topics.uni) {
    assert.ok(cards.filter(card => card.uni === topic.id).length >= 8, topic.title);
  }
  const sections = ['1.1','1.2','1.3','1.4','1.5','1.6','1.7','2.1','2.2','2.3','2.4','3.1','3.2','3.3','3.4','4.1','4.2','4.3','4.4','5.1','5.2'];
  for (const section of sections) {
    assert.ok(eligible('lc', 'higher').some(card => card.lc.section === section), section);
    if (section !== '4.4') assert.ok(eligible('lc', 'ordinary').some(card => card.lc.section === section), section);
  }
});

test('search ranks symbols and aliases without crossing track or level', () => {
  const uni = eligible('uni');
  const ordinary = eligible('lc', 'ordinary');
  const higher = eligible('lc', 'higher');
  const bars = searchCards(uni, '|x|').map(card => card.id);
  assert.equal(bars[0], 'absolute-value');
  for (const id of ['absolute-value', 'cardinality', 'matrix-determinant']) assert.ok(bars.includes(id));
  assert.equal(searchCards(uni, 'A∩B')[0].id, 'intersection');
  assert.equal(searchCards(uni, '  LoG10  ')[0].id, 'common-logarithm');
  assert.equal(searchCards(higher, '∫')[0].id, 'definite-integral');
  assert.equal(searchCards(ordinary, '∫').length, 0);
  assert.equal(searchCards(ordinary, 'matrix determinant').length, 0);
  assert.equal(searchCards(uni, 'De Moivre').length, 0);
});

test('deep links preserve track, level and card with a strict route format', () => {
  assert.deepEqual(parseRoute(routeFor('lc', 'higher', 'definite-integral')), { track: 'lc', level: 'higher', id: 'definite-integral' });
  assert.deepEqual(parseRoute(routeFor('uni', undefined, 'matrix-rank')), { track: 'uni', id: 'matrix-rank' });
  assert.equal(parseRoute('#lc/foundation/derivative'), null);
  assert.equal(parseRoute('#uni/../matrix-rank'), null);
});

test('migration preserves numeric bookmarks, viewed cards and quiz totals in University', () => {
  const local = storage({ 'notation-lab': JSON.stringify({ saved: [0, 47, 99, 0], seen: [5], attempts: 8, correct: 6 }) });
  const state = loadState(local, cards);
  assert.deepEqual(state.progress.uni.saved, ['universal-quantifier', 'derivative']);
  assert.deepEqual(state.progress.uni.opened, ['logical-and']);
  assert.equal(state.progress.uni.attempts, 8);
  assert.equal(state.progress.uni.correct, 6);
  assert.deepEqual(state.progress.lc.saved, []);
  state.progress.lc.saved.push('derivative');
  saveState(local, state);
  assert.deepEqual(loadState(local, cards), state);
  assert.deepEqual(loadState(storage({ 'notation-lab': '{broken' }), cards).progress.uni.saved, []);
});

test('reviews survive reload, are available on their due date, and advance at 1, 3, 7, 14 days', () => {
  const local = storage({});
  const state = loadState(local, cards);
  const progress = state.progress.lc;
  const card = byId.get('derivative');
  recordQuiz(progress, card.id, false, date(11));
  assert.deepEqual(progress.review[card.id], { step: -1, due: dayKey(date(12)) });
  assert.equal(progress.attempts, 1);
  assert.equal(progress.correct, 0);
  assert.deepEqual(dueCards([card], progress, date(11)), []);
  saveState(local, state);
  const restored = loadState(local, cards);
  const review = restored.progress.lc;
  assert.deepEqual(dueCards([card], review, date(12)), [card]);
  for (const [step, from, due] of [[0,12,13],[1,13,16],[2,16,23],[3,23,37],[3,37,51]]) {
    recordRecall(review, card.id, true, date(from));
    assert.deepEqual(review.review[card.id], { step, due: dayKey(date(due)) });
  }
  assert.deepEqual(dueCards([card], restored.progress.uni, date(60)), []);
  assert.equal(review.attempts, 1);
});
