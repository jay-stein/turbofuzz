/*
 * TurboFuzz test datasets — paste this whole file into the browser console on
 * https://turbofuzz.mrjaystein.workers.dev/ (or your local dev server).
 *
 * Usage:
 *   TF_TEST.load('A')   // 730 x 6   daily sales time series, 2 injected outliers
 *   TF_TEST.load('B')   // 1,240 x 9 messy customers: dupes, placeholders, mixed dates/cases
 *   TF_TEST.load('C')   // 250,000 x 9 taxi-style trips (~12 MB) — latency / virtualization
 *   TF_TEST.load('D')   // 3,000 x 71 wide ML-style table, long column names, nulls
 *   TF_TEST.clear()     // clears the current dataset via the UI (confirms the dialog)
 *
 * Datasets are generated with a seeded PRNG, so results are reproducible.
 * Loading goes through the real "Paste rows instead" textarea and
 * "Load pasted data" button, so it exercises the normal import path.
 *
 * Reference results observed on 2026-10-27 (use as a regression baseline):
 *   A  730x6      25.6 KB    24 ms   "Orders & transactions" 70%   DQ 100.0  outlier rows 2
 *   B  1,240x9    102.8 KB   42 ms   DQ 95.4  duplicates 40  placeholders 382  outliers 15
 *                                    6 of 9 columns with empty cells, 11 issues
 *   C  250,000x9  12.1 MB    4007 ms "Event / activity log" 95%    DQ 100.0
 *   D  3,000x71   1.5 MB     954 ms  "ML dataset" 95%  DQ 99.0  60 of 71 columns with empty cells
 */
(() => {
  const rng = (s) => () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pad = (n, w = 2) => String(n).padStart(w, '0');

  const makeA = () => {
    const r = rng(42);
    const regions = ['North', 'South', 'East', 'West'];
    const prods = ['Widget', 'Gadget', 'Gizmo'];
    const rows = ['order_date,region,product,units,revenue,discount_pct'];
    let d = Date.UTC(2023, 0, 1);
    for (let i = 0; i < 730; i++) {
      const region = regions[Math.floor(r() * 4)]; // draw order matters for reproducibility
      const prod = prods[Math.floor(r() * 3)];
      const season = 1 + 0.3 * Math.sin(i / 58);
      const units = Math.round((20 + r() * 30) * season);
      let rev = +(units * (15 + r() * 10)).toFixed(2);
      if (i === 300 || i === 512) rev = +(rev * 25).toFixed(2); // injected outliers
      rows.push([
        new Date(d).toISOString().slice(0, 10),
        region, prod, units, rev, Math.floor(r() * 5) * 5,
      ].join(','));
      d += 86400000;
    }
    return rows.join('\n');
  };

  const makeB = () => {
    const r = rng(7);
    const names = ['Alice Chen', 'bob smith', 'CAROL JONES', 'Dave  Patel', "eve o'brien", ' Frank Li', 'Grace Kim', 'Hank Zhou'];
    const cities = ['Sydney', 'sydney', 'SYDNEY', 'Melbourne', 'Melb.', 'Perth', 'Brisbane', 'Adelaide', ''];
    const status = ['active', 'Active', 'ACTIVE', 'inactive', 'Inactive', 'pending', 'N/A', '-'];
    const rows = ['customer_id,full_name,email,signup_date,city,status,balance,age,phone'];
    for (let i = 1; i <= 1200; i++) {
      const nm = names[Math.floor(r() * names.length)];
      const email = r() < 0.08 ? '' : nm.toLowerCase().replace(/[^a-z]/g, '.') + i + (r() < 0.05 ? '@@gmail.com' : '@example.com');
      const dt = r() < 0.3
        ? `${1 + Math.floor(r() * 28)}/${1 + Math.floor(r() * 12)}/2023`
        : `2023-${pad(1 + Math.floor(r() * 12))}-${pad(1 + Math.floor(r() * 28))}`;
      let bal = r() < 0.1 ? '' : (r() < 0.05 ? '$' + Math.round(r() * 5000).toLocaleString('en-US') : (r() * 5000).toFixed(2));
      if (bal.includes(',')) bal = '"' + bal + '"'; // quoted CSV field with a thousands separator
      const age = r() < 0.07 ? 'unknown' : (r() < 0.02 ? 240 : 18 + Math.floor(r() * 60));
      const ph = r() < 0.2 ? '' : '04' + String(Math.floor(r() * 1e8)).padStart(8, '0');
      rows.push([i, '"' + nm + '"', email, dt, cities[Math.floor(r() * cities.length)], status[Math.floor(r() * status.length)], bal, age, ph].join(','));
    }
    for (let k = 0; k < 40; k++) rows.push(rows[5 + k]); // 40 exact duplicate rows
    return rows.join('\n');
  };

  const makeC = () => {
    const r = rng(99);
    const zones = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'];
    const types = ['A', 'B', 'C', 'D'];
    const lines = ['trip_id,pickup_time,zone,type,distance_km,fare,tip,passengers,duration_min'];
    const t0 = Date.UTC(2024, 0, 1);
    for (let i = 0; i < 250000; i++) {
      const d = +(r() * r() * 30 + 0.3).toFixed(2);
      lines.push([
        i + 1, new Date(t0 + i * 21000).toISOString().replace('T', ' ').slice(0, 19),
        zones[Math.floor(r() * 6)], types[Math.floor(r() * 4)], d,
        +(3 + d * 2.1 + r() * 3).toFixed(2), +(r() < 0.4 ? 0 : r() * 8).toFixed(2),
        1 + Math.floor(r() * 4), Math.round(d * 3 + r() * 10),
      ].join(','));
    }
    return lines.join('\n');
  };

  const makeD = () => {
    const r = rng(5);
    const cols = ['sample_id', 'batch', 'assay_date'];
    for (let i = 1; i <= 60; i++) cols.push('feature_' + pad(i) + '_measurement_value');
    for (let i = 1; i <= 8; i++) cols.push('flag_' + i);
    const lines = [cols.join(',')];
    for (let n = 0; n < 3000; n++) {
      const row = ['S' + pad(n, 5), 'batch_' + (1 + Math.floor(r() * 6)), '2024-0' + (1 + Math.floor(r() * 9)) + '-' + (10 + Math.floor(r() * 18))];
      for (let i = 1; i <= 60; i++) row.push(r() < 0.03 ? '' : (r() * 100 * (1 + i / 10)).toFixed(3));
      for (let i = 1; i <= 8; i++) row.push(r() < 0.5 ? 'TRUE' : 'FALSE');
      lines.push(row.join(','));
    }
    return lines.join('\n');
  };

  const makers = { A: makeA, B: makeB, C: makeC, D: makeD };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const visibleBtn = (text) =>
    [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === text && b.getBoundingClientRect().height > 0);

  const clear = async () => {
    const first = visibleBtn('Clear data')[0];
    if (!first) return; // already on the empty state
    first.click();
    await sleep(300);
    visibleBtn('Clear data').pop().click(); // confirm dialog button
    await sleep(500);
  };

  const load = async (name) => {
    if (!makers[name]) throw new Error('Unknown dataset ' + name + ' (use A, B, C or D)');
    await clear();
    const details = document.querySelector('details');
    if (details) details.open = true;
    const csv = makers[name]();
    const ta = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, csv);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    visibleBtn('Load pasted data')[0].click();
    return { dataset: name, chars: csv.length };
  };

  window.TF_TEST = { load, clear, makers };
  console.log('TF_TEST ready: TF_TEST.load("A"|"B"|"C"|"D"), TF_TEST.clear()');
})();
