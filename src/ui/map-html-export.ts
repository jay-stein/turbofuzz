/**
 * The map as one self-contained web page: everything is inside the file, so it opens offline, from an email or a shared
 * drive, with zoom, pan, hover and the time slider, and nothing is fetched from anywhere.
 */

export interface MapHtmlLegend {
  title: string;
  /** One row per class. */
  classes?: { colour: string; label: string }[];
  /** Or a smooth ramp from low to high. */
  ramp?: { stops: string[]; low: string; high: string };
  /** What two sizes of dot stand for. */
  sizes?: { title: string; low: string; high: string };
}

export interface MapHtmlPayload {
  title: string;
  subtitle: string;
  view: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  /** Coast and land, as x, y, x, y. */
  land: number[][];
  /** The periods to step through; a single empty label when there is no time. */
  frames: string[];
  regions?: {
    /** Per region, its rings. */
    shapes: number[][][];
    /** Per frame, per region: an index into `colours`, or -1 for no value. */
    fill: number[][];
    colours: string[];
    /** Per frame, per region: the hover text. One frame's worth when the text does not change. */
    tips: string[][][];
    missing: boolean;
    /** Names on the map: where each goes, largest region first, and how it looks. One set of texts unless they change by period. */
    labels?: { spots: number[][]; order: number[]; texts: string[][]; size: number; colour: string; buffer: number; bufferColour: string };
  };
  dots?: {
    /** Per frame: x, y, radius in pixels, colour index, and the hover text. */
    frames: { x: number[]; y: number[]; r: number[]; c: number[]; tips: string[][] }[];
    colours: string[];
    opacity: number;
  };
  /** The person's own markers. */
  markers?: { lon: number; lat: number; label: string; size: number }[];
  legend: MapHtmlLegend | null;
  credit: string;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Nothing in the data can end the script block or be read as markup. */
const safeJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c");

/** Coordinates to about a metre: most of a boundary file's size is digits nobody can see. */
export function roundRing(ring: ArrayLike<number>, digits = 5): number[] {
  const scale = 10 ** digits;
  const out = new Array<number>(ring.length);
  for (let i = 0; i < ring.length; i++) out[i] = Math.round(ring[i]! * scale) / scale;
  return out;
}

const STYLE = `
:root { color-scheme: light dark; --bg:#f4f6f9; --panel:#fff; --text:#1c2430; --dim:#5b6675; --border:#d8dee6; --accent:#2563eb; --water:#cfe5f4; --land:#f0e2b6; --coast:#b3a36e; }
@media (prefers-color-scheme: dark) { :root { --bg:#10151c; --panel:#1a212b; --text:#e6ebf2; --dim:#9aa6b5; --border:#2d3744; --accent:#6ea0ff; --water:#16222e; --land:#3a3626; --coast:#6f6747; } }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { display: flex; flex-direction: column; background: var(--bg); color: var(--text); font: 14px/1.4 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
header { padding: 12px 16px 8px; }
h1 { margin: 0; font-size: 18px; font-weight: 650; }
header p { margin: 2px 0 0; color: var(--dim); font-size: 13px; }
main { position: relative; flex: 1; min-height: 240px; margin: 0 16px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; touch-action: none; }
canvas.dragging { cursor: grabbing; }
.tools { position: absolute; left: 10px; top: 10px; display: flex; flex-direction: column; gap: 4px; }
.tools button { width: 30px; height: 30px; font-size: 16px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.tools button.wide { width: auto; padding: 0 8px; font-size: 12px; }
.legend { position: absolute; right: 10px; bottom: 10px; max-height: calc(100% - 20px); overflow: auto; padding: 8px 10px; font-size: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.legend b { display: block; margin-bottom: 4px; font-weight: 600; }
.legend .row { display: flex; align-items: center; gap: 6px; }
.legend i { flex: none; width: 14px; height: 11px; border-radius: 2px; }
.legend .ramp { width: 170px; height: 9px; border-radius: 2px; }
.legend .ends { display: flex; justify-content: space-between; color: var(--dim); }
.legend .sizes { margin-top: 6px; color: var(--dim); }
.tip { position: absolute; z-index: 3; display: none; max-width: 320px; padding: 6px 9px; font-size: 12px; pointer-events: none; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,.2); }
.tip b { display: block; font-weight: 600; }
.period { position: absolute; left: 50px; top: 10px; padding: 3px 9px; font-weight: 600; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.player { display: flex; align-items: center; gap: 10px; padding: 8px 16px 0; }
.player button { padding: 4px 12px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.player input { flex: 1; min-width: 0; accent-color: var(--accent); }
footer { padding: 8px 16px 10px; color: var(--dim); font-size: 11px; }
[hidden] { display: none !important; }
`;

/** No template literals inside: it is a plain script in the page. */
const SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById("map-data").textContent);
  var canvas = document.querySelector("canvas");
  var main = document.querySelector("main");
  var ctx = canvas.getContext("2d");
  var tip = document.querySelector(".tip");
  var period = document.querySelector(".period");
  var slider = document.querySelector(".player input");
  var play = document.querySelector(".player button");
  var frame = 0, timer = 0, w = 0, h = 0, view = null, home = null;
  var css = getComputedStyle(document.documentElement);
  function colour(name) { return css.getPropertyValue(name).trim(); }

  function fit(v) {
    var lon = v.lonMax - v.lonMin, lat = v.latMax - v.latMin;
    var midLat = (v.latMin + v.latMax) / 2, midLon = (v.lonMin + v.lonMax) / 2;
    var squeeze = Math.max(0.05, Math.cos(Math.max(-85, Math.min(85, midLat)) * Math.PI / 180));
    if (lon * squeeze / lat < w / h) lon = (w / h) * lat / squeeze; else lat = lon * squeeze / (w / h);
    return { lonMin: midLon - lon / 2, lonMax: midLon + lon / 2, latMin: midLat - lat / 2, latMax: midLat + lat / 2 };
  }
  function px(lon) { return (lon - view.lonMin) / (view.lonMax - view.lonMin) * w; }
  function py(lat) { return (view.latMax - lat) / (view.latMax - view.latMin) * h; }

  function trace(ring) {
    var wrap = 0;
    for (var i = 0; i < ring.length; i += 2) {
      if (i > 0) {
        var step = ring[i] - ring[i - 2];
        if (step > 180) wrap -= 360; else if (step < -180) wrap += 360;
      }
      var x = px(ring[i] + wrap), y = py(ring[i + 1]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function draw() {
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = colour("--water");
    ctx.fillRect(0, 0, w, h);
    var i, j;
    ctx.beginPath();
    for (i = 0; i < data.land.length; i++) trace(data.land[i]);
    ctx.fillStyle = colour("--land");
    ctx.fill();
    ctx.strokeStyle = colour("--coast");
    ctx.lineWidth = 0.75;
    ctx.stroke();
    var r = data.regions;
    if (r) {
      var fills = r.fill[frame];
      for (i = 0; i < r.shapes.length; i++) {
        ctx.beginPath();
        for (j = 0; j < r.shapes[i].length; j++) trace(r.shapes[i][j]);
        var c = fills[i];
        ctx.globalAlpha = c < 0 ? 0.16 : 0.88;
        ctx.fillStyle = c < 0 ? colour("--dim") : r.colours[c];
        ctx.fill("evenodd");
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = "#3a3f47";
        ctx.lineWidth = r.shapes.length > 500 ? 0.35 : 0.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (r.labels) {
        var l = r.labels, texts = l.texts[l.texts.length > 1 ? frame : 0], placed = [];
        ctx.font = "600 " + l.size + "px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = l.buffer * 2;
        ctx.strokeStyle = l.bufferColour;
        ctx.fillStyle = l.colour;
        for (i = 0; i < l.order.length; i++) {
          var at = l.order[i], text = texts[at], spot = l.spots[at];
          if (!text) continue;
          var lx = px(spot[0]), ly = py(spot[1]);
          if (lx < 0 || lx > w || ly < 0 || ly > h) continue;
          var half = ctx.measureText(text).width / 2 + l.buffer, tall = l.size / 2 + l.buffer, clash = false;
          for (j = 0; j < placed.length && !clash; j++) {
            var p = placed[j];
            clash = lx - half < p[2] && lx + half > p[0] && ly - tall < p[3] && ly + tall > p[1];
          }
          if (clash) continue;
          placed.push([lx - half, ly - tall, lx + half, ly + tall]);
          if (l.buffer > 0) ctx.strokeText(text, lx, ly);
          ctx.fillText(text, lx, ly);
        }
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
      }
    }
    var d = data.dots && data.dots.frames[frame];
    if (d) {
      for (i = 0; i < d.x.length; i++) {
        ctx.beginPath();
        ctx.arc(px(d.x[i]), py(d.y[i]), d.r[i], 0, Math.PI * 2);
        ctx.fillStyle = data.dots.colours[d.c[i]];
        ctx.globalAlpha = data.dots.opacity;
        ctx.fill();
        ctx.globalAlpha = Math.min(1, data.dots.opacity + 0.3);
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (data.markers) {
      for (i = 0; i < data.markers.length; i++) {
        var m = data.markers[i], x = px(m.lon), y = py(m.lat);
        ctx.beginPath();
        ctx.arc(x, y, m.size, 0, Math.PI * 2);
        ctx.fillStyle = "#d62728";
        ctx.fill();
        ctx.strokeStyle = colour("--panel");
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (m.label) {
          ctx.font = "600 11px system-ui, sans-serif";
          ctx.lineWidth = 3;
          ctx.strokeText(m.label, x + m.size + 3, y + 4);
          ctx.fillStyle = colour("--text");
          ctx.fillText(m.label, x + m.size + 3, y + 4);
        }
      }
    }
    period.textContent = data.frames[frame];
    period.hidden = data.frames.length < 2;
  }
  function size() {
    var box = main.getBoundingClientRect();
    w = box.width; h = box.height;
    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    home = fit(data.view);
    view = view === null ? home : fit(view);
    draw();
  }

  function inRings(rings, lon, lat) {
    var inside = false;
    for (var k = 0; k < rings.length; k++) {
      var ring = rings[k], n = ring.length / 2;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var yi = ring[i * 2 + 1], yj = ring[j * 2 + 1];
        if ((yi > lat) !== (yj > lat)) {
          var xi = ring[i * 2], xj = ring[j * 2];
          if (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
        }
      }
    }
    return inside;
  }
  function hover(x, y) {
    var lines = null, i;
    var d = data.dots && data.dots.frames[frame];
    if (d) {
      var best = Infinity;
      for (i = 0; i < d.x.length; i++) {
        var dx = px(d.x[i]) - x, dy = py(d.y[i]) - y, far = Math.sqrt(dx * dx + dy * dy);
        if (far <= Math.max(d.r[i], 5) && far < best) { best = far; lines = d.tips[i]; }
      }
    }
    var r = data.regions;
    if (!lines && r) {
      var lon = view.lonMin + x / w * (view.lonMax - view.lonMin);
      var lat = view.latMax - y / h * (view.latMax - view.latMin);
      var tips = r.tips[r.tips.length > 1 ? frame : 0];
      for (i = 0; i < r.shapes.length; i++) {
        if (inRings(r.shapes[i], lon, lat)) { lines = tips[i]; break; }
      }
    }
    if (!lines) { tip.style.display = "none"; return; }
    tip.textContent = "";
    lines.forEach(function (line, index) {
      var row = document.createElement(index === 0 ? "b" : "div");
      row.textContent = line;
      tip.appendChild(row);
    });
    tip.style.display = "block";
    tip.style.left = Math.min(x + 14, w - tip.offsetWidth - 6) + "px";
    tip.style.top = Math.min(y + 14, h - tip.offsetHeight - 6) + "px";
  }

  function zoom(factor, x, y) {
    var fx = x / w, fy = y / h;
    var lon = view.lonMin + fx * (view.lonMax - view.lonMin), lat = view.latMax - fy * (view.latMax - view.latMin);
    var lonSpan = (view.lonMax - view.lonMin) * factor, latSpan = (view.latMax - view.latMin) * factor;
    if (Math.min(lonSpan, latSpan) < 0.002 || lonSpan > 720) return;
    view = { lonMin: lon - fx * lonSpan, lonMax: lon + (1 - fx) * lonSpan, latMax: lat + fy * latSpan, latMin: lat - (1 - fy) * latSpan };
    draw();
  }
  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    var box = canvas.getBoundingClientRect();
    zoom(event.deltaY > 0 ? 1.25 : 0.8, event.clientX - box.left, event.clientY - box.top);
  }, { passive: false });
  var drag = null;
  canvas.addEventListener("pointerdown", function (event) {
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
    tip.style.display = "none";
  });
  canvas.addEventListener("pointermove", function (event) {
    var box = canvas.getBoundingClientRect();
    if (drag === null) { hover(event.clientX - box.left, event.clientY - box.top); return; }
    var lon = (event.clientX - drag.x) / w * (view.lonMax - view.lonMin);
    var lat = (event.clientY - drag.y) / h * (view.latMax - view.latMin);
    view = { lonMin: view.lonMin - lon, lonMax: view.lonMax - lon, latMin: view.latMin + lat, latMax: view.latMax + lat };
    drag = { x: event.clientX, y: event.clientY };
    draw();
  });
  canvas.addEventListener("pointerup", function () { drag = null; canvas.classList.remove("dragging"); });
  canvas.addEventListener("pointerleave", function () { tip.style.display = "none"; });
  canvas.addEventListener("dblclick", function () { view = home; draw(); });
  document.querySelector("[data-zoom=in]").addEventListener("click", function () { zoom(0.7, w / 2, h / 2); });
  document.querySelector("[data-zoom=out]").addEventListener("click", function () { zoom(1.4, w / 2, h / 2); });
  document.querySelector("[data-zoom=fit]").addEventListener("click", function () { view = home; draw(); });

  function setFrame(next) { frame = next; slider.value = String(next); draw(); }
  function stop() { clearInterval(timer); timer = 0; play.textContent = "Play"; }
  slider.max = String(data.frames.length - 1);
  slider.addEventListener("input", function () { stop(); setFrame(Number(slider.value)); });
  play.addEventListener("click", function () {
    if (timer) { stop(); return; }
    play.textContent = "Pause";
    timer = setInterval(function () { setFrame((frame + 1) % data.frames.length); }, 700);
  });
  document.querySelector(".player").hidden = data.frames.length < 2;

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { css = getComputedStyle(document.documentElement); draw(); });
  addEventListener("resize", size);
  size();
})();
`;

function legendHtml(legend: MapHtmlLegend | null, missing: boolean): string {
  if (legend === null) return "";
  const parts = [`<b>${escapeHtml(legend.title)}</b>`];
  for (const item of legend.classes ?? []) {
    parts.push(`<div class="row"><i style="background:${escapeHtml(item.colour)}"></i>${escapeHtml(item.label)}</div>`);
  }
  if (legend.ramp !== undefined) {
    parts.push(`<div class="ramp" style="background:linear-gradient(90deg,${legend.ramp.stops.map(escapeHtml).join(",")})"></div><div class="ends"><span>${escapeHtml(legend.ramp.low)}</span><span>${escapeHtml(legend.ramp.high)}</span></div>`);
  }
  if (missing) parts.push(`<div class="row"><i style="background:var(--dim);opacity:.3"></i>No value</div>`);
  if (legend.sizes !== undefined) {
    parts.push(`<div class="sizes">Dot size: ${escapeHtml(legend.sizes.title)}, ${escapeHtml(legend.sizes.low)} to ${escapeHtml(legend.sizes.high)}</div>`);
  }
  return `<div class="legend">${parts.join("")}</div>`;
}

export function buildMapHtml(payload: MapHtmlPayload): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>${escapeHtml(payload.title)}</h1><p>${escapeHtml(payload.subtitle)}</p></header>
<main>
<canvas role="img" aria-label="${escapeHtml(payload.title)}"></canvas>
<div class="tools"><button type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button><button type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button><button type="button" class="wide" data-zoom="fit" title="Back to the whole map">Fit</button></div>
<div class="period" hidden></div>
${legendHtml(payload.legend, payload.regions?.missing === true)}
<div class="tip" role="status"></div>
</main>
<div class="player" hidden><button type="button">Play</button><input type="range" min="0" value="0" step="1" aria-label="Period"></div>
<footer>${escapeHtml(payload.credit)} · Scroll to zoom, drag to pan, double-click to go back, hover for details.</footer>
<script type="application/json" id="map-data">${safeJson(payload)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

export function downloadHtml(fileName: string, html: string): boolean {
  if (typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
