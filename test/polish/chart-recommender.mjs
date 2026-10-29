/*
 * TurboFuzz chart recommender — reference implementation.
 *
 * Pure, dependency-free, metadata-only: it reads the per-column profile the app
 * already computes at import (type, distinct count, null %, min/max). It never
 * touches row data, never renders anything and never uses the network.
 *
 * ASSUMED INPUT (adapt to the real profile object in the repo):
 *   column = { name, type, distinct, nullPct?, min?, max?, avgLen?, ordinal? }
 *   type   = 'number' | 'integer' | 'category' | 'text' | 'date' | 'datetime'
 *            | 'time' | 'boolean' | 'id'            (the types the UI already shows)
 *   min/max for date columns = epoch milliseconds.
 *
 * Rules are original and follow widely used chart-selection practice
 * (message first; bars for categories with a zero baseline; lines only for
 * ordered data; avoid pies; show the numbers when one figure is the message).
 * Write the user-facing wording yourself; do not copy third-party guide text.
 */

// Chart ids the app already has, plus proposed additions (see spec section 8).
export const NEW_TYPES = new Set(['dotplot', 'stacked100', 'slopegraph', 'smallmultiples']);

// Name hints match whole words only ("duration" must not match "ratio", "discount" must not match "count").
const words = (name) => name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const set = (s) => new Set(s.split(' '));
const RATE = set('pct percent percentage rate ratio share score age price temp temperature avg average mean index margin');
const ADDITIVE = set('revenue sales amount total cost spend units unit qty quantity count fare tip balance volume income profit distance duration');
const MONEY = set('revenue sales amount total cost spend fare income profit balance');
const GOOD_CAT = set('status type segment region category city state country channel product group class zone batch tier gender department');
const BAD_CAT = set('name email phone address');
const hasWord = (S, name) => words(name).some((w) => S.has(w));
const isRate = (name) => hasWord(RATE, name);
const RX = {
  lat: /^(lat|latitude)$|_lat$|latitude/i,
  lon: /^(lon|lng|long|longitude)$|_(lon|lng)$|longitude/i,
};

/* ------------------------------------------------------------------ roles */

/** Classify one column. role: id | time | cat-low | cat-mid | cat-high | measure | text */
export function profile(col, nRows) {
  const d = col.distinct ?? 0;
  const t = col.type;
  const base = { name: col.name, type: t, distinct: d, nullPct: col.nullPct ?? 0 };
  const nearlyUnique = (t === 'integer' || t === 'text') && nRows > 1 && (d >= nRows || (/(^|_)id$/i.test(col.name) && d >= 0.9 * nRows));
  if (t === 'id' || nearlyUnique) return { ...base, role: 'id' };
  if (t === 'date' || t === 'datetime') return { ...base, role: 'time' };
  if (t === 'integer' && /year|yr$/i.test(col.name) && col.min >= 1900 && col.max <= 2100) return { ...base, role: 'time', unit: 'year' };
  if (t === 'boolean') return { ...base, role: 'cat-low', levels: 2 };
  if (t === 'number' || t === 'integer') {
    // Few distinct numbers (e.g. 5 discount levels) read as categories but can still be measures.
    if (d <= 12) return { ...base, role: 'cat-low', canMeasure: true, levels: d };
    return { ...base, role: 'measure', canCategory: d <= 30 };
  }
  if (t === 'text' && d > 30) return { ...base, role: 'text' };
  return { ...base, role: d <= 12 ? 'cat-low' : d <= 30 ? 'cat-mid' : 'cat-high', levels: d };
}

export const aggFor = (name) => (isRate(name) ? 'mean' : hasWord(ADDITIVE, name) ? 'sum' : 'mean');
const aggWord = { sum: 'Total', mean: 'Average', none: '', count: 'Count of' };

/* ------------------------------------------------------------- resolution */

const UNITS = [['minute', 6e4], ['hour', 36e5], ['day', 864e5], ['week', 6048e5], ['month', 2629800000], ['quarter', 7889400000], ['year', 31557600000]];

/**
 * Smallest time unit giving <= `target` points, but never fewer than `floor` points
 * (falls back to the next smaller unit). Always returns an explicit unit, which avoids the
 * blank chart seen when the suggested time series was left on "Auto".
 */
export function autoResolution(spanMs, target = 60, floor = 12) {
  for (let i = 0; i < UNITS.length; i++) {
    const points = spanMs / UNITS[i][1];
    if (points <= target) return points < floor && i > 0 ? UNITS[i - 1][0] : UNITS[i][0];
  }
  return 'year';
}
const unitMs = (u) => UNITS.find(([n]) => n === u)?.[1] ?? 864e5;
const spanOf = (p, col) => (typeof col.min === 'number' && typeof col.max === 'number' ? col.max - col.min : null);

/* --------------------------------------------------------------- recommend */

function resolve(selection, nRows) {
  return selection.map((s) => {
    const col = s.col ?? s;
    const p = { ...profile(col, nRows), col };
    if (s.as === 'measure') p.role = 'measure';
    else if (s.as === 'time') p.role = 'time';
    else if (s.as === 'cat' && !p.role.startsWith('cat')) p.role = p.distinct <= 12 ? 'cat-low' : p.distinct <= 30 ? 'cat-mid' : 'cat-high';
    return p;
  });
}

/**
 * selection: columns (or {col, as}) the user put on the shelf.
 * ctx: { rows, source: 'table' | 'view' }  (a view is already aggregated, so agg = 'none')
 * returns { options: [{chart, rank:'primary'|'alt', why, cfg, warn, isNew}], notes: [] }
 */
export function recommend(selection, ctx = {}) {
  const nRows = ctx.rows ?? 0;
  const view = ctx.source === 'view';
  const P = resolve(selection, nRows);
  const notes = [];
  const out = [];
  const add = (chart, rank, why, cfg = {}, warn = []) => out.push({ chart, rank, why, cfg, warn, isNew: NEW_TYPES.has(chart) });

  const ids = P.filter((p) => p.role === 'id');
  if (ids.length) notes.push(`${ids.map((i) => i.name).join(', ')} looks like an ID, so it is not charted. Use it only for counts.`);
  const use = P.filter((p) => p.role !== 'id');
  if (use.length > 4) notes.push('More than 4 fields makes a chart hard to read. Keep the 2-3 that carry the message.');

  const T = use.filter((p) => p.role === 'time');
  const C = use.filter((p) => p.role.startsWith('cat'));
  const M = use.filter((p) => p.role === 'measure');
  const X = use.filter((p) => p.role === 'text');
  const [t] = T, [c1, c2] = C, [m1, m2] = M;
  const agg = (m) => (view ? 'none' : aggFor(m.name));
  const lead = (m) => `${aggWord[agg(m)]} ${m.name}`.trim();
  const sortFor = (c) => (c.col.ordinal ? 'natural' : 'value-desc');
  const many = (c) => c.role !== 'cat-low';

  if (!use.length) return { options: [], notes: notes.length ? notes : ['Pick one or more fields.'] };

  if (X.length && !T.length && !C.length && !M.length) {
    add('topterms', 'primary', `Most frequent words in ${X[0].name}.`);
  } else if (M.length === 1 && !T.length && !C.length) {
    add('histogram', 'primary', `Shows how ${m1.name} is spread: typical values, skew and outliers.`, { bins: 'auto' });
    add('boxplot', 'alt', `A compact summary of ${m1.name}: median, quartiles and outliers.`);
    add('kpi', 'alt', 'One headline number, for when the total or average is the message.', { agg: agg(m1) });
  } else if (C.length === 1 && !T.length && !M.length) {
    add('countplot', 'primary', `How many rows for each ${c1.name}, largest first.`,
      { sort: sortFor(c1), horizontal: many(c1), topN: many(c1) ? 10 : null, baseline: 0 },
      many(c1) ? [`${c1.distinct} categories: show the top 10 and group the rest as Other.`] : []);
    if (many(c1)) add('treemap', 'alt', 'Many categories: area shows relative size without a long axis.');
  } else if (C.length === 1 && M.length === 1 && !T.length) {
    add('barplot', 'primary', `${lead(m1)} for each ${c1.name}, sorted so the biggest stands out. Bars start at zero.`,
      { agg: agg(m1), sort: sortFor(c1), horizontal: many(c1) || (c1.col.avgLen ?? 0) > 10, topN: many(c1) ? 10 : null, baseline: 0 });
    if (many(c1)) add('dotplot', 'alt', 'With many categories, dots read lighter than a wall of bars and need no zero baseline.', { agg: agg(m1) });
    if (!view && nRows / Math.max(c1.distinct, 1) >= 20) add('boxplot', 'alt', `Shows the spread of ${m1.name} inside each ${c1.name}, not just one number.`);
    if (many(c1) && agg(m1) === 'sum') add('treemap', 'alt', 'Area shows each category\'s share of the total.', { agg: 'sum' });
  } else if (T.length && !C.length && M.length <= 1) {
    const span = spanOf(t, t.col);
    const res = t.unit ?? ctx.resolution ?? (span != null ? autoResolution(span) : 'day');
    const cfg = { resolution: res, agg: m1 ? agg(m1) : 'count', measure: m1?.name ?? null };
    add('timeseries', 'primary', m1 ? `${lead(m1)} by ${res}: the line shows the trend.` : `Rows per ${res}: shows when activity happens.`, cfg);
    if (m1) {
      add('kpi', 'alt', 'Headline value with a small trend line.', { agg: cfg.agg, over: t.name, resolution: res });
      if (span != null && span / unitMs(res) <= 12) add('barplot', 'alt', 'With 12 or fewer periods, bars make each period easy to read.', { ...cfg, baseline: 0 });
    }
  } else if (T.length && C.length === 1 && M.length <= 1) {
    const span = spanOf(t, t.col);
    const res = t.unit ?? (span != null ? autoResolution(span) : 'day');
    const cfg = { resolution: res, agg: m1 ? agg(m1) : 'count', measure: m1?.name ?? null, groupBy: c1.name };
    const k = c1.distinct;
    if (k <= 5) add('timeseries', 'primary', `One line per ${c1.name} so trends can be compared directly.`, cfg);
    else if (k <= 12) {
      add('smallmultiples', 'primary', `${k} lines on one chart tangle; give each ${c1.name} its own small panel.`, cfg);
      add('timeseries', 'alt', 'All lines together. Highlight one and grey the rest.', { ...cfg, highlight: true });
    } else add('timeseries', 'primary', `${k} series is too many to read, so this shows the top 5 by total.`, { ...cfg, topN: 5 },
      [`${k} categories: only the top 5 are drawn.`]);
  } else if (T.length && !C.length && M.length >= 2) {
    const ms = M.slice(0, 3);
    add('timeseries', 'primary', `${ms.map((m) => m.name).join(', ')} over time.`, { resolution: t.unit ?? 'auto', measures: ms.map((m) => m.name) },
      ['If these use different scales, index them to 100 or use small multiples instead of a second axis.']);
    add('smallmultiples', 'alt', 'One panel per measure, each on its own scale.', { measures: ms.map((m) => m.name) });
  } else if (M.length === 2 && !T.length && !C.length) {
    if (RX.lat.test(m1.name) && RX.lon.test(m2.name)) add('map', 'primary', 'Latitude and longitude: plot the points on a map.', { lat: m1.name, lon: m2.name });
    else if (RX.lat.test(m2.name) && RX.lon.test(m1.name)) add('map', 'primary', 'Latitude and longitude: plot the points on a map.', { lat: m2.name, lon: m1.name });
    else if (nRows > 5000) {
      add('density', 'primary', `${nRows.toLocaleString('en-US')} points would overplot a scatter, so density shows where they cluster.`, { x: m1.name, y: m2.name });
      add('scatter', 'alt', 'Individual points, sampled to keep it fast.', { x: m1.name, y: m2.name, sample: 5000 });
    } else {
      add('scatter', 'primary', `Each dot is a row: does ${m2.name} rise or fall with ${m1.name}?`, { x: m1.name, y: m2.name });
      add('density', 'alt', 'Shows where points cluster if they overlap.', { x: m1.name, y: m2.name });
    }
  } else if (M.length === 3 && !T.length && !C.length) {
    add('bubble', 'primary', `Three measures at once: ${M[0].name} (x), ${M[1].name} (y), ${M[2].name} (size).`, { x: M[0].name, y: M[1].name, size: M[2].name });
    add('scatter', 'alt', 'Drop the size and keep the two that matter most.', { x: M[0].name, y: M[1].name });
    add('correlation', 'alt', 'A grid of how strongly each pair moves together.', { columns: M.map((m) => m.name) });
  } else if (M.length >= 4 && !T.length && !C.length) {
    add('correlation', 'primary', 'With this many measures, start with how strongly each pair moves together.', { columns: M.slice(0, 12).map((m) => m.name) },
      M.length > 12 ? [`Showing the first 12 of ${M.length} measures.`] : []);
    add('scatter', 'alt', 'Then pick one strong pair and look at it directly.', { x: m1.name, y: m2.name });
  } else if (C.length === 2 && !T.length && M.length <= 1) {
    const cfg = { rows: c1.name, columns: c2.name, agg: m1 ? agg(m1) : 'count', measure: m1?.name ?? null };
    add('heatmap', 'primary', `Where ${c1.name} and ${c2.name} combine most strongly; darker means more.`, cfg);
    if (c2.distinct <= 4) add('barplot', 'alt', `Grouped bars: one colour per ${c2.name}.`, { ...cfg, baseline: 0 });
    if (c2.distinct <= 6 && cfg.agg !== 'mean') add('stacked100', 'alt', `The share of each ${c2.name} within every ${c1.name}.`, cfg);
  } else if (C.length >= 3 && !T.length) {
    add('heatmap', 'primary', `Using ${c1.name} and ${c2.name}; a third category is rarely readable.`, { rows: c1.name, columns: c2.name, agg: m1 ? agg(m1) : 'count', measure: m1?.name ?? null },
      ['Three category fields: filter on the third instead of plotting it.']);
  }

  if (!out.length) notes.push('No chart fits this combination. Remove a field or change one field\'s role.');
  return { options: out, notes };
}

/* -------------------------------------------------------------- quick starts */

// Headline-money measures first, then other additive ones, then rates; ties broken by variety, then fewer nulls.
const measureScore = (p) =>
  (hasWord(ADDITIVE, p.name) && !isRate(p.name) ? 2 : 0) + (hasWord(MONEY, p.name) ? 1 : 0) + (isRate(p.name) ? 1 : 0)
  + Math.min(p.distinct, 100) / 100 - p.nullPct / 100;
const catScore = (p) => (hasWord(GOOD_CAT, p.name) ? 2 : 0) - (words(p.name).at(-1) && BAD_CAT.has(words(p.name).at(-1)) ? 2 : 0)
  + (p.distinct >= 3 && p.distinct <= 12 ? 1 : 0) - p.nullPct / 50;

/** Up to 3 ready-made starting points (replaces "first measure, first category"). */
export function quickStarts(columns, nRows, { max = 3 } = {}) {
  const P = columns.map((c) => ({ ...profile(c, nRows), col: c }));
  const times = P.filter((p) => p.role === 'time').sort((a, b) => b.distinct - a.distinct);
  const measures = P.filter((p) => p.role === 'measure' && p.nullPct < 40).sort((a, b) => measureScore(b) - measureScore(a));
  const cats = P.filter((p) => p.role === 'cat-low' && !p.canMeasure).sort((a, b) => catScore(b) - catScore(a));
  const catsMid = P.filter((p) => p.role === 'cat-mid').sort((a, b) => catScore(b) - catScore(a));
  const cat = cats[0] ?? catsMid[0];
  const m = measures[0], m2 = measures[1];
  const starts = [];
  const push = (title, fields) => {
    const { options } = recommend(fields.map((f) => f.col), { rows: nRows, source: 'table' });
    if (options[0]) starts.push({ title, fields: fields.map((f) => f.name), chart: options[0].chart, cfg: options[0].cfg });
  };
  const lead = (p) => `${aggWord[aggFor(p.name)]} ${p.name}`.trim();

  if (times[0] && m) {
    const span = spanOf(times[0], times[0].col);
    const res = times[0].unit ?? (span != null ? autoResolution(span) : 'day');
    push(`${lead(m)} by ${res}`, [times[0], m]);
  } else if (m) push(`Distribution of ${m.name}`, [m]);
  if (cat && m) push(`${lead(m)} by ${cat.name}`, [cat, m]);
  else if (cat) push(`Rows by ${cat.name}`, [cat]);
  if (measures.length >= 8) push('Which measures move together', measures.slice(0, 10));
  else if (m && m2) push(`${m2.name} vs ${m.name}`, [m, m2]);
  else if (m && starts.length < max && times[0]) push(`Distribution of ${m.name}`, [m]);
  return starts.slice(0, max);
}

/* ------------------------------------------------------- registry + fields */

const KIND = {
  measure: (p) => p.role === 'measure' || !!p.canMeasure,
  cat: (p) => p.role.startsWith('cat') || !!p.canCategory,
  time: (p) => p.role === 'time',
  text: (p) => p.role === 'text',
};
const slot = (name, kinds, opt = false) => ({ name, kinds, optional: opt });

/** Single source of truth for what each chart needs: gallery enable/disable, field lists, guide text. */
export const CHARTS = {
  kpi: { label: 'KPI', slots: [slot('Measure', ['measure']), slot('Over time', ['time'], true)] },
  histogram: { label: 'Histogram', slots: [slot('Values', ['measure', 'time'])] },
  boxplot: { label: 'Box plot', slots: [slot('Values', ['measure']), slot('Group by', ['cat'], true)] },
  density: { label: 'Density', slots: [slot('X', ['measure']), slot('Y', ['measure'])] },
  timeseries: { label: 'Time series', slots: [slot('Date', ['time']), slot('Value', ['measure'], true), slot('Group by', ['cat'], true)] },
  countplot: { label: 'Count plot', slots: [slot('Category', ['cat'])] },
  barplot: { label: 'Barplot', slots: [slot('Category', ['cat']), slot('Measure', ['measure'])] },
  treemap: { label: 'Treemap', slots: [slot('Group by', ['cat']), slot('Size by', ['measure'], true)] },
  heatmap: { label: 'Heatmap', slots: [slot('Rows', ['cat']), slot('Columns', ['cat'])] },
  scatter: { label: 'Scatter', slots: [slot('X', ['measure', 'time']), slot('Y', ['measure'])] },
  bubble: { label: 'Bubble', slots: [slot('X', ['measure']), slot('Y', ['measure']), slot('Size', ['measure'], true)] },
  correlation: { label: 'Correlation', slots: [slot('Columns', ['measure'])] },
  map: { label: 'Map', slots: [slot('Latitude', ['measure']), slot('Longitude', ['measure'])] },
  topterms: { label: 'Top terms', slots: [slot('Text', ['text'])] },
};

/**
 * Fields for one slot, split into suggested vs other (never hidden, so power users keep control).
 * `other` entries carry a short reason, e.g. "51 distinct values: many bars".
 */
export function fieldsFor(chartId, slotIndex, columns, nRows) {
  const s = CHARTS[chartId].slots[slotIndex];
  const suggested = [], other = [];
  const catOnly = s.kinds.includes('cat') && !s.kinds.includes('measure');
  for (const col of columns) {
    const p = profile(col, nRows);
    if (p.role === 'id') other.push({ name: col.name, reason: 'looks like an ID' });
    else if (catOnly && p.role === 'measure') other.push({ name: col.name, reason: `${p.distinct} distinct values: too many groups` });
    else if (catOnly && p.role === 'cat-high') other.push({ name: col.name, reason: `${p.distinct} distinct values: many bars` });
    else if (s.kinds.some((k) => KIND[k](p))) suggested.push({ name: col.name, role: p.role });
    else other.push({ name: col.name, reason: `${p.role.replace('cat-', 'category ')} column` });
  }
  return { suggested, other };
}

/** Which chart types can be built from these columns (gallery enable/disable with a reason). */
export function availability(columns, nRows) {
  const P = columns.map((c) => profile(c, nRows)).filter((p) => p.role !== 'id');
  const res = {};
  for (const [id, def] of Object.entries(CHARTS)) {
    const missing = def.slots.filter((s) => !s.optional && !P.some((p) => s.kinds.some((k) => KIND[k](p))));
    const lat = id === 'map' && !(P.some((p) => RX.lat.test(p.name)) && P.some((p) => RX.lon.test(p.name)));
    res[id] = missing.length || lat ? { ok: false, reason: lat && !missing.length ? 'needs latitude and longitude columns' : `needs ${missing.map((s) => s.kinds[0]).join(' + ')} column` } : { ok: true };
  }
  return res;
}

/* -------------------------------------------------------------------- lint */

/**
 * Cheap checks on a configured chart; shown as small notes on the card.
 * chart = { type, cfg, fields: [column], categories?, series? }
 */
export function lint(chart, nRows) {
  const w = [];
  const cfg = chart.cfg ?? {};
  for (const col of chart.fields ?? []) {
    if (cfg.agg === 'sum' && isRate(col.name) && (col.type === 'number' || col.type === 'integer'))
      w.push({ level: 'warn', msg: `${col.name} looks like a rate or percentage. Summing it rarely makes sense; use Average.` });
  }
  if (['barplot', 'countplot', 'stacked100'].includes(chart.type) && cfg.baseline !== undefined && cfg.baseline !== 0)
    w.push({ level: 'warn', msg: 'Bars must start at zero or their lengths mislead. Consider a dot plot.' });
  if (['barplot', 'countplot'].includes(chart.type) && (chart.categories ?? 0) > 12 && !cfg.topN)
    w.push({ level: 'warn', msg: `${chart.categories} bars is hard to read. Show the top 10 and group the rest as Other.` });
  if (chart.type === 'timeseries' && (chart.series ?? 1) > 5)
    w.push({ level: 'warn', msg: `${chart.series} lines tangle. Use small multiples, or highlight one line and grey the rest.` });
  if (chart.type === 'timeseries' && !(chart.fields ?? []).some((c) => profile(c, nRows).role === 'time'))
    w.push({ level: 'error', msg: 'A line needs an ordered x-axis (a date). Use bars for categories.' });
  return w;
}
