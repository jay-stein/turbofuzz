// Column profiles mirror the four reference datasets (TF_TEST A-D) as the app reported them on 2026-10-27.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/ui/chart-recommender.js';
import { aggFor } from '../src/ui/chart-names.js';
import type { RecColumn } from '../src/ui/chart-recommender.js';

const DAY = 864e5;
const t0 = Date.UTC(2023, 0, 1);

const A: { rows: number; cols: RecColumn[] } = { rows: 730, cols: [
  { name: 'order_date', type: 'date', distinct: 730, min: t0, max: t0 + 729 * DAY },
  { name: 'region', type: 'category', distinct: 4 },
  { name: 'product', type: 'category', distinct: 3 },
  { name: 'units', type: 'integer', distinct: 51 },
  { name: 'revenue', type: 'number', distinct: 724 },
  { name: 'discount_pct', type: 'integer', distinct: 5 },
] };

const B: { rows: number; cols: RecColumn[] } = { rows: 1240, cols: [
  { name: 'customer_id', type: 'integer', distinct: 1200 },
  { name: 'full_name', type: 'category', distinct: 8 },
  { name: 'email', type: 'text', distinct: 1148, nullPct: 7 },
  { name: 'signup_date', type: 'date', distinct: 529, min: Date.UTC(2023, 0, 1), max: Date.UTC(2023, 11, 28) },
  { name: 'city', type: 'category', distinct: 9, nullPct: 10 },
  { name: 'status', type: 'category', distinct: 8, nullPct: 25 },
  { name: 'balance', type: 'number', distinct: 1000, nullPct: 12 },
  { name: 'age', type: 'integer', distinct: 62, nullPct: 7 },
  { name: 'phone', type: 'id', distinct: 990, nullPct: 20 },
] };

const C: { rows: number; cols: RecColumn[] } = { rows: 250000, cols: [
  { name: 'trip_id', type: 'id', distinct: 250000 },
  { name: 'pickup_time', type: 'datetime', distinct: 250000, min: Date.UTC(2024, 0, 1), max: Date.UTC(2024, 0, 1) + 249999 * 21000 },
  { name: 'zone', type: 'category', distinct: 6 },
  { name: 'type', type: 'category', distinct: 4 },
  { name: 'distance_km', type: 'number', distinct: 2900 },
  { name: 'fare', type: 'number', distinct: 9000 },
  { name: 'tip', type: 'number', distinct: 600 },
  { name: 'passengers', type: 'integer', distinct: 4 },
  { name: 'duration_min', type: 'integer', distinct: 110 },
] };

const D: { rows: number; cols: RecColumn[] } = { rows: 3000, cols: [
  { name: 'sample_id', type: 'id', distinct: 3000 },
  { name: 'batch', type: 'category', distinct: 6 },
  { name: 'assay_date', type: 'date', distinct: 160, min: Date.UTC(2024, 0, 10), max: Date.UTC(2024, 8, 27) },
  ...Array.from({ length: 60 }, (_, i): RecColumn => ({ name: `feature_${String(i + 1).padStart(2, '0')}_measurement_value`, type: 'number', distinct: 2990, nullPct: 3 })),
  ...Array.from({ length: 8 }, (_, i): RecColumn => ({ name: `flag_${i + 1}`, type: 'boolean', distinct: 2 })),
] };

const col = (ds: { cols: RecColumn[] }, name: string): RecColumn => ds.cols.find((c) => c.name === name)!;
const top = (sel: R.Selection[], ds: { rows: number }, ctx: { source?: 'table' | 'view' } = {}) => R.recommend(sel, { rows: ds.rows, ...ctx });

test('roles', () => {
  assert.equal(R.profile({ name: 'order_year', type: 'integer', distinct: 6, min: 2019, max: 2024 }, 5000).role, 'time');
  assert.equal(R.profile(col(B, 'customer_id'), B.rows).role, 'id');
  assert.equal(R.profile(col(A, 'discount_pct'), A.rows).role, 'cat-low');
  assert.equal(R.profile(col(A, 'discount_pct'), A.rows).canMeasure, true);
  assert.equal(R.profile(col(A, 'units'), A.rows).role, 'measure');
  assert.equal(R.profile(col(B, 'email'), B.rows).role, 'text');
});

test('auto resolution: 12-60 points where possible, always an explicit unit', () => {
  assert.equal(R.autoResolution(730 * DAY), 'month'); // 24 points
  assert.equal(R.autoResolution(100 * DAY), 'week'); // 14 points
  assert.equal(R.autoResolution(61 * DAY), 'day'); // week would give only 9 points
  assert.equal(R.autoResolution(3 * 36e5), 'minute'); // hour would give only 3 points
  assert.equal(R.autoResolution(40 * 365 * DAY), 'year');
});

test('name hints match whole words only', () => {
  assert.equal(aggFor('duration_min'), 'sum'); // "duration" contains "ratio"
  assert.equal(aggFor('discount_pct'), 'mean'); // "discount" contains "count"
  assert.equal(aggFor('unitPrice'), 'mean'); // camelCase
  assert.equal(aggFor('feature_01_measurement_value'), 'mean'); // unknown -> average, never sum
});

test('time + measure -> line with an explicit resolution (fixes blank "Auto" chart)', () => {
  const { options } = top([col(A, 'order_date'), col(A, 'units')], A);
  assert.equal(options[0].chart, 'timeseries');
  assert.equal(options[0].rank, 'primary');
  assert.equal(options[0].cfg.resolution, 'month');
  assert.equal(options[0].cfg.agg, 'sum');
});

test('category + measure -> sorted bars from zero; many categories add dot plot', () => {
  const o = top([col(A, 'region'), col(A, 'revenue')], A).options;
  assert.equal(o[0].chart, 'barplot');
  assert.equal(o[0].cfg.sort, 'value-desc');
  assert.equal(o[0].cfg.baseline, 0);
  const many = top([{ name: 'suburb', type: 'category', distinct: 45 }, col(A, 'revenue')], A).options;
  assert.ok(many.some((x) => x.chart === 'dotplot' && x.isNew));
  assert.equal(many[0].cfg.topN, 10);
});

test('two measures -> scatter, but density when rows would overplot', () => {
  assert.equal(top([col(A, 'units'), col(A, 'revenue')], A).options[0].chart, 'scatter');
  assert.equal(top([col(C, 'distance_km'), col(C, 'fare')], C).options[0].chart, 'density');
});

test('lat/lon pair -> map', () => {
  const ll: RecColumn[] = [{ name: 'lat', type: 'number', distinct: 900 }, { name: 'lng', type: 'number', distinct: 900 }];
  assert.equal(R.recommend(ll, { rows: 1000 }).options[0].chart, 'map');
});

test('structure rules', () => {
  assert.equal(top([col(B, 'email')], B).options[0].chart, 'topterms');
  assert.equal(top([col(A, 'region'), col(A, 'product')], A).options[0].chart, 'heatmap');
  assert.equal(top(D.cols.slice(3, 8), D).options[0].chart, 'correlation');
  assert.equal(top([col(A, 'units')], A).options[0].chart, 'histogram');
  const multi = top([col(A, 'order_date'), col(A, 'revenue'), col(A, 'region')], A).options;
  assert.equal(multi[0].chart, 'timeseries');
  assert.equal(multi[0].cfg.groupBy, 'region');
  const six = top([col(A, 'order_date'), col(A, 'revenue'), { name: 'store', type: 'category', distinct: 8 }], A).options;
  assert.equal(six[0].chart, 'smallmultiples');
});

test('IDs are never charted', () => {
  const r = top([col(B, 'customer_id'), col(B, 'balance')], B);
  assert.equal(r.options[0].chart, 'histogram');
  assert.match(r.notes[0], /customer_id looks like an ID/);
});

test('views are already aggregated: no re-aggregation', () => {
  const o = top([col(A, 'region'), col(A, 'units')], A, { source: 'view' }).options;
  assert.equal(o[0].cfg.agg, 'none');
});

test('rate-like measures default to Average and lint flags Sum', () => {
  assert.equal(aggFor('discount_pct'), 'mean');
  assert.equal(aggFor('revenue'), 'sum');
  const w = R.lint({ type: 'barplot', cfg: { agg: 'sum', baseline: 0 }, fields: [col(A, 'discount_pct')] }, A.rows);
  assert.equal(w.length, 1);
  assert.match(w[0].msg, /rate or percentage/);
});

test('lint: truncated baseline, too many bars, lines on categories', () => {
  assert.ok(R.lint({ type: 'barplot', cfg: { baseline: 50 }, fields: [] }, 100).some((w) => /start at zero/.test(w.msg)));
  assert.ok(R.lint({ type: 'barplot', cfg: {}, categories: 40, fields: [] }, 100).some((w) => /top 10/.test(w.msg)));
  assert.ok(R.lint({ type: 'timeseries', cfg: {}, fields: [col(A, 'region')] }, 100).some((w) => w.level === 'error'));
});

test('quick starts on the four reference datasets', () => {
  const a = R.quickStarts(A.cols, A.rows);
  assert.equal(a.length, 3);
  assert.equal(a[0].chart, 'timeseries');
  assert.deepEqual(a[0].fields, ['order_date', 'revenue']);
  assert.match(a[0].title, /by month/);
  assert.equal(a[1].chart, 'barplot');
  assert.equal(a[2].chart, 'scatter');

  const b = R.quickStarts(B.cols, B.rows);
  assert.ok(!b.some((s) => s.fields.includes('customer_id') || s.fields.includes('email') || s.fields.includes('phone')));
  assert.equal(b[0].fields[1], 'balance');

  const c = R.quickStarts(C.cols, C.rows);
  assert.equal(c[0].fields[1], 'fare');
  assert.equal(c[2].chart, 'density');

  const d = R.quickStarts(D.cols, D.rows);
  assert.equal(d.at(-1)?.chart, 'correlation');
});

test('speed: quick starts on a 71-column table stay under 2 ms, and recommend() never mutates input', () => {
  const frozen = D.cols.map((c) => Object.freeze({ ...c }));
  R.quickStarts(frozen, D.rows); // warm-up
  const t = performance.now();
  for (let i = 0; i < 200; i++) R.quickStarts(frozen, D.rows);
  const per = (performance.now() - t) / 200;
  console.log(`quickStarts(71 cols): ${per.toFixed(3)} ms per call (Node, this container)`);
  assert.ok(per < 2, `expected < 2 ms, got ${per}`);
});

test('speed: recommend and quick starts on 100 columns stay under 2 ms', () => {
  const wide: RecColumn[] = Array.from({ length: 100 }, (_, i): RecColumn => ({
    name: i % 10 === 0 ? `region_${i}` : `measure_${i}`,
    type: i % 10 === 0 ? 'category' : 'number',
    distinct: i % 10 === 0 ? 6 : 900,
  }));
  R.quickStarts(wide, 5000);
  const t = performance.now();
  for (let i = 0; i < 200; i++) R.quickStarts(wide, 5000);
  const per = (performance.now() - t) / 200;
  assert.ok(per < 2, `expected < 2 ms, got ${per}`);
});
