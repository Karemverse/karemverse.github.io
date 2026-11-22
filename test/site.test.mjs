// Static checks for index.html. Run: node --test test/
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
  const grids = html.split('<div class="sec">').slice(1);
  for (const g of grids) {
    const m = g.match(/^<h2>[^<]+<\/h2><span>(\d+)<\/span>/);
    if (!m) continue;
    const n = Number(m[1]);
    const block = g.split('<div class="sec">')[0].split('<footer>')[0];
    const items = (block.match(/<a class="card"/g) || []).length + (block.match(/<a href="https:\/\/github\.com\/[^"]+"><div class="lname">/g) || []).length;
    assert.equal(items, n);
  }
});

test('open-source count in the sidebar matches the page', () => {
  const claimed = Number(html.match(/<b>(\d+)<\/b> open-source projects/)[1]);
  const oss = (html.match(/href="https:\/\/github\.com\/(KaremBenChikha|Karemverse)\/[a-z0-9-]+"/g) || []).length;
  assert.equal(oss, claimed);
});

test('no links to private or removed repos', () => {
  for (const bad of ['removed-project', 'ems-marketplace', 'polybrain-chat', 'CryptoTaxProject', 'KaremBenChikha/Homelab', 'KaremBenChikha/stoxx']) {
    assert.equal(html.includes(bad), false, bad);
  }
});
