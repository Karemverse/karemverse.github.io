// Static checks for index.html. Run: node --test test/*.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

test('no em dash anywhere', () => {
  assert.equal(html.includes('\u2014'), false);
});

test('data files are valid', () => {
  const gh = JSON.parse(readFileSync(join(root, 'data/github.json'), 'utf8'));
  assert.match(gh.asOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(gh.days.length >= 360);
  for (const [d, n] of gh.days) { assert.match(d, /^\d{4}-\d{2}-\d{2}$/); assert.ok(Number.isInteger(n) && n >= 0); }
  const travel = JSON.parse(readFileSync(join(root, 'data/travel.json'), 'utf8'));
  assert.ok(travel.countries.some((c) => c.code === travel.basedIn));
  for (const c of travel.countries) { assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180); assert.ok(c.name && c.flag); }
});

test('helpers', async () => {
  const app = await import(join(root, 'app.js'));
  assert.deepEqual(app.monthlyFromDays([['2026-10-31', 2], ['2026-11-01', 3], ['2026-11-02', 4]]), [['2026-10', 2], ['2026-11', 7]]);
  const rev = { products: {
    a: { currency: 'cad', months: [['2026-10', 100], ['2026-11', 200]], last30: 200 },
    b: { currency: 'cad', months: [['2026-10', 50], ['2026-11', 0]], last30: 0 },
    c: { currency: 'usd', months: [['2026-10', 999], ['2026-11', 999]], last30: 999 },
  } };
  const r = app.combineRevenue(rev);
  assert.equal(r.currency, 'cad');
  assert.equal(r.total, 350);
  assert.deepEqual(r.months, [['2026-10', 150], ['2026-11', 200]]);
  assert.equal(app.combineRevenue({ products: {} }), null);
  assert.equal(app.money(123456, 'cad'), 'CA$1,235');
  assert.equal(app.heatLevel(0, 10), 0);
  assert.equal(app.heatLevel(10, 10), 4);
});

test('revenue badges target existing product cards', () => {
  for (const id of ['inviteo', 'creatorpay', 'scopelock', 'stoxx']) assert.ok(html.includes(`data-product="${id}"`), id);
});

test('local assets referenced by the page exist', () => {
  const refs = [...html.matchAll(/(?:src|href)="((?!https?:|#|data:)[^"]+)"/g)].map((r) => r[1]);
  assert.ok(refs.length > 0);
  for (const r of refs) assert.ok(existsSync(join(root, r)), `missing ${r}`);
});

test('section counts match the cards shown', () => {
  const parts = html.split('<section class="proj"').slice(1);
  assert.equal(parts.length, 6);
  for (const part of parts) {
    const block = part.split('</section>')[0];
    const n = Number(block.match(/<h2>[^<]+<\/h2><span>(\d+)<\/span>/)[1]);
    assert.equal((block.match(/<article class="card/g) || []).length, n);
  }
});

test('every filter button targets a section', () => {
  const sections = [...html.matchAll(/data-section="([a-z]+)"/g)].map((m) => m[1]);
  const filters = [...html.matchAll(/data-filter="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(filters, ['all', ...sections]);
});

test('sidebar project count matches non-product cards', () => {
  const claimed = Number(html.match(/<b>(\d+)<\/b> projects across/)[1]);
  const total = (html.match(/<article class="card/g) || []).length;
  const products = (html.match(/data-product="/g) || []).length;
  assert.equal(total - products, claimed);
});

// Only these repos are public. Anything else linked from the page would 404 or leak a private name.
const PUBLIC_REPOS = new Set([
  'KaremBenChikha/sim2paper', 'KaremBenChikha/claude-code-router', 'KaremBenChikha/claude-code-blueprint',
  'KaremBenChikha/agv-hybride', 'KaremBenChikha/smart-aquarium', 'KaremBenChikha/ball-and-beam',
  'KaremBenChikha/face-mask-detection', 'KaremBenChikha/object-detection-yolo',
  'KaremBenChikha/image-classification-sagemaker', 'KaremBenChikha/simple-image-classification',
  'Karemverse/homelab', 'Karemverse/karemverse.github.io',
]);

test('repo links point only at public repos', () => {
  const repos = [...html.matchAll(/href="https:\/\/github\.com\/([^/"]+\/[^/"]+)"/g)].map((m) => m[1]);
  assert.ok(repos.length >= 11);
  for (const r of repos) assert.ok(PUBLIC_REPOS.has(r), r);
});

test('private cards have no link', () => {
  for (const m of html.matchAll(/<article class="card[^"]*"[^>]*>([\s\S]*?)<\/article>/g)) {
    if (m[1].includes('badge private')) assert.equal(m[1].includes('href='), false);
  }
});

test('filter helper', async () => {
  const app = await import(join(root, 'app.js'));
  assert.deepEqual(app.visibleSections('all', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(app.visibleSections('b', ['a', 'b']), ['b']);
});
