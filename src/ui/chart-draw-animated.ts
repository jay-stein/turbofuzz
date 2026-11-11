/**
 * Animated charts: stepping through time frames, playing, and exporting the animation as GIF or video.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { drawChart } from "./chart-draw-aggregate.js";
import { cssVar } from "./chart-card-parts.js";
import type { SeriesGrid } from "../data/chart-series.js";
import { encodeGif, type GifFrameInput } from "../data/gif.js";
import { squarifyLayout } from "../data/treemap.js";
import type { TimeGrain } from "../data/aggregate.js";
import { MAX_FRAMES } from "../data/chart-frames.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { axisKindFor, type AxisFormat, CHART_KIND_LABELS, formatCount, formatTick, isGroupable, isNumericType, niceTicks } from "./chart-utils.js";
import { el } from "./dom.js";
import { openPrompt } from "./dialog.js";
import type { ChartCard } from "./chart-card.js";
import type { Frame } from "./chart-card.js";
import { POINT_LIMIT, ANIMATED_KINDS } from "./chart-card.js";

/** Columns to animate over: dates, then numbers (shaded regions step through dates only). */
export function syncAnimationOptions(card: ChartCard): void {
  const dates = card.allowedIndexes((meta) => card.isDateLike(meta));
  const numbers = card.regionsOn() ? [] : card.allowedIndexes((meta) => card.isFrameNumber(meta));
  const current = card.config.animationTimeColumn ?? -1;
  if (current >= 0 && !dates.includes(current) && !numbers.includes(current)) card.config.animationTimeColumn = -1;
  card.animationTimeSelect.replaceChildren(card.option("-1", "Off"));
  const group = (label: string, indexes: number[]): void => {
    if (indexes.length === 0) return;
    const optgroup = el("optgroup", { label }) as HTMLOptGroupElement;
    for (const index of indexes) optgroup.append(card.option(String(index), card.columns[index]!.name));
    card.animationTimeSelect.append(optgroup);
  };
  group("Dates", dates);
  group("Numbers", numbers);
  card.animationTimeSelect.value = String(card.config.animationTimeColumn ?? -1);
  card.syncFrameOptions();
}

/**
 * Step widths for a number column that give roughly 10, 20 and 50 frames
 * over its range, rounded to 1, 2 or 5 times a power of ten.
 */
export function frameWidths(card: ChartCard, meta: ColumnMeta): number[] {
  const span = (meta.stats.max ?? 0) - (meta.stats.min ?? 0);
  if (!(span > 0)) return [1];
  const nice = (raw: number): number => {
    const power = 10 ** Math.floor(Math.log10(raw));
    const unit = raw / power;
    return Number(((unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power).toPrecision(12));
  };
  const widths = [...new Set([10, 20, 50].map((frames) => nice(span / frames)))];
  // Whole numbers step by at least 1.
  return (meta.type === "integer" ? widths.map((width) => Math.max(1, Math.round(width))) : widths).filter((width, i, all) => all.indexOf(width) === i).sort((a, b) => b - a);
}

/** The frame dropdown for the chosen column: time grains for dates, each value or steps for numbers. */
export function syncFrameOptions(card: ChartCard): void {
  const meta = card.meta(card.config.animationTimeColumn ?? -1);
  const select = card.animationGrainSelect;
  select.replaceChildren();
  if (meta !== undefined && card.isFrameNumber(meta)) {
    card.animationStepLabel.textContent = "by";
    select.title = "Frames in the column's numeric order: one per value, or one per step";
    if (meta.stats.distinct <= MAX_FRAMES) select.append(el("option", { value: "value" }, ["each value"]) as HTMLOptionElement);
    for (const width of card.frameWidths(meta)) {
      select.append(el("option", { value: `step:${width}` }, [`steps of ${width.toLocaleString("en", { maximumFractionDigits: 6 })}`]) as HTMLOptionElement);
    }
    const step = card.config.animationStep ?? card.defaultFrameStep(meta);
    const wanted = step === "value" ? "value" : `step:${step}`;
    if (![...select.options].some((option) => option.value === wanted)) {
      select.append(el("option", { value: wanted }, [step === "value" ? "each value" : `steps of ${step}`]) as HTMLOptionElement);
    }
    select.value = wanted;
    return;
  }
  card.animationStepLabel.textContent = "every";
  select.title = "How much time each frame covers";
  for (const grain of ["hour", "day", "week", "month", "quarter", "year"] as TimeGrain[]) {
    select.append(el("option", { value: grain }, [grain.charAt(0).toUpperCase() + grain.slice(1)]) as HTMLOptionElement);
  }
  select.value = card.config.animationGrain ?? "day";
}

/**
 * Frames for animated bar and bubble charts: one aggregate per time bucket,
 * computed worker-side in a single pass over the filtered rows.
 */
export function refreshAnimation(card: ChartCard): void {
  card.stopAnimation();
  const timeColumn = card.config.animationTimeColumn ?? -1;
  if (card.regionsOn()) {
    // The regions work out their own values per period; onFrames brings the periods back.
    if (timeColumn < 0) card.animationResult = null;
    card.regions?.setTime(timeColumn < 0 || !card.isDateLike(card.meta(timeColumn)) ? null : { column: timeColumn, grain: card.config.animationGrain ?? "day" });
    return;
  }
  card.regions?.setTime(null);
  const kind = card.config.kind;
  const animatable =
    kind === "bar" ||
    kind === "bubble" ||
    kind === "histogram" ||
    kind === "treemap" ||
    kind === "density" ||
    card.animatesPlaces();
  const request = card.options.requestAnimation;
  if (
    !animatable ||
    timeColumn < 0 ||
    request === undefined ||
    card.config.source !== ""
  ) {
    card.animationResult = null;
    return;
  }
  const timeMeta = card.meta(timeColumn);
  if (!card.isDateLike(timeMeta) && !card.isFrameNumber(timeMeta)) {
    card.animationResult = null;
    return;
  }
  const isPair = kind === "bubble" || kind === "density" || kind === "map";
  const isCategory = kind === "bar" || kind === "treemap";
  if (isPair) {
    const x = card.meta(card.config.x);
    const y = card.meta(card.config.y);
    if (
      x === undefined ||
      y === undefined ||
      !isNumericType(x.type) ||
      !isNumericType(y.type)
    ) {
      card.animationResult = null;
      return;
    }
  } else if (isCategory) {
    const column = card.meta(card.config.column);
    if (column === undefined || !isGroupable(column)) {
      card.animationResult = null;
      return;
    }
  } else {
    const column = card.meta(card.config.column);
    if (column === undefined || !isNumericType(column.type)) {
      card.animationResult = null;
      return;
    }
  }
  const generation = ++card.generation;
  card.animationFrame = 0;
  const colorMeta = card.meta(card.config.colorColumn);
  const chart: "bar" | "bubble" | "histogram" | "places" = kind === "map"
    ? "places"
    : isPair
    ? "bubble"
    : isCategory
      ? "bar"
      : "histogram";
  const histogramBins =
    card.binResult?.bins.length ??
    card.meta(card.config.column)?.histogram?.bins.length ??
    32;
  void request({
    timeColumn,
    grain: card.frameStep(),
    chart,
    column: isPair ? card.config.x : card.config.column,
    yColumn: isPair ? card.config.y : -1,
    bins: chart === "histogram" ? histogramBins : chart === "places" ? POINT_LIMIT : (card.config.bubbleBins ?? 40),
    topN: card.config.topN,
    measure: isPair ? card.bubbleMeasure() : undefined,
    // Density is a single aggregate heat map, so grouping is ignored there;
    // bubble charts carry the group dimension.
    groupColumn: kind === "bubble" ? card.bubbleGroupColumn() : undefined,
    colorMeasure:
      chart === "places" && colorMeta !== undefined && isNumericType(colorMeta.type)
        ? { column: card.config.colorColumn, agg: card.config.mapColorAgg ?? "mean" }
        : undefined,
    ...(chart === "places" && card.mapLabelColumn() >= 0 ? { labelColumn: card.mapLabelColumn() } : {}),
    ...card.chartScope(),
  })
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.animationResult = message.result;
      card.statsMs = message.ms;
      card.animationFrame = 0;
      card.render();
    })
    .catch((error: unknown) => {
      if (generation !== card.generation || card.disposed) return;
      card.animationResult = null;
      card.noteEl.textContent =
        error instanceof Error ? error.message : "Could not build the animation frames.";
      card.render();
    });
}

/** Why this chart cannot step through time right now; null when it can. */
export function animationBlock(card: ChartCard): string | null {
  const kind = card.config.kind;
  if (card.regionsOn()) return card.regions?.ready === true ? (card.columns.some((meta) => card.isDateLike(meta)) ? null : "Animating needs a date or datetime column. If yours was read as text, use Convert types") : "Load a boundary file first";
  if (kind === "map" && !card.animatesPlaces()) return "To animate a map, set Show to One dot per place or Regions";
  if (!ANIMATED_KINDS.has(kind)) {
    return `${CHART_KIND_LABELS[kind]} charts can't animate. Bar, Bubble, Histogram, Treemap, Density and Map can`;
  }
  if (card.config.source !== "") return "Charts from a Pivot View can't animate: set Source to Table";
  if (!card.columns.some((meta) => card.isDateLike(meta) || card.isFrameNumber(meta))) {
    return "Animating needs a date or number column to step through. If yours was read as text, use Convert types";
  }
  if (kind === "bubble" || kind === "density" || kind === "map") {
    const x = card.meta(card.config.x);
    const y = card.meta(card.config.y);
    if (x === undefined || y === undefined || !isNumericType(x.type) || !isNumericType(y.type)) {
      return kind === "map" ? "Choose numeric longitude and latitude columns first" : "Choose numeric X and Y columns first";
    }
    return null;
  }
  const column = card.meta(card.config.column);
  if (kind === "histogram") return column !== undefined && isNumericType(column.type) ? null : "Choose a numeric column first";
  return column !== undefined && isGroupable(column) ? null : "Choose a category column first";
}

export function setAnimationTime(card: ChartCard, column: number): void {
  card.config.animationTimeColumn = column;
  const meta = card.meta(column);
  if (meta !== undefined && card.isFrameNumber(meta)) card.config.animationStep = card.defaultFrameStep(meta);
  else if (column >= 0) card.config.animationGrain = card.defaultGrainFor(column);
  card.syncFrameOptions();
  card.animationTimeSelect.value = String(column);
  card.stopAnimation();
  card.generation++;
  card.refreshAnimation();
  card.render();
}

export function toggleAnimationSetup(card: ChartCard): void {
  const blocked = card.animationBlock();
  if (blocked !== null) {
    card.noteEl.textContent = `${blocked}.`;
    return;
  }
  card.animationSetupOpen = !card.animationSetupOpen;
  card.renderControls();
  // One click starts it: the first date column (else the first number column) is ready to play; the row beside it can change that or turn it off.
  if (card.animationSetupOpen && (card.config.animationTimeColumn ?? -1) < 0) {
    let first = card.columns.findIndex((meta) => card.isDateLike(meta));
    if (first < 0 && !card.regionsOn()) first = card.columns.findIndex((meta) => card.isFrameNumber(meta));
    if (first >= 0) card.setAnimationTime(first);
  }
}

export function toggleAnimation(card: ChartCard): void {
  if (card.animationPlaying) card.stopAnimation();
  else card.playAnimation();
}

export function setAnimationSpeed(card: ChartCard, speed: number): void {
  card.config.animationSpeed = speed;
  if (card.animationPlaying) {
    card.stopAnimation();
    card.playAnimation();
  }
  card.syncAnimationBar();
}

/** Custom speed prompt; the presets cover the common cases. */
export async function promptAnimationSpeed(card: ChartCard): Promise<void> {
  const entered = await openPrompt({
    title: "Custom play speed",
    label: "Multiplier, e.g. 0.25 (slower) to 8 (faster). 1× is one frame every 0.5 s.",
    value: String(card.config.animationSpeed ?? 1),
    placeholder: "1.25",
    confirmLabel: "Use speed",
  });
  const parsed = Number(entered?.trim() ?? "");
  if (entered === null || !Number.isFinite(parsed) || parsed <= 0) {
    card.syncAnimationBar();
    return;
  }
  card.setAnimationSpeed(Math.min(20, Math.max(0.05, parsed)));
}

export function playAnimation(card: ChartCard): void {
  const result = card.animationResult;
  if (result === null || result.frames.length === 0) return;
  if (card.animationTimer !== null) window.clearInterval(card.animationTimer);
  card.animationPlaying = true;
  card.animationTimer = window.setInterval(() => {
    const current = card.animationResult;
    if (card.disposed || current === null) {
      card.stopAnimation();
      return;
    }
    const last = current.frames.length - 1;
    if (card.animationFrame >= last) {
      if (card.animationLoopInput.checked) card.animationFrame = 0;
      else {
        card.stopAnimation();
        return;
      }
    } else {
      card.animationFrame++;
    }
    card.render();
  }, card.frameIntervalMs());
  card.syncAnimationBar();
}

export function stopAnimation(card: ChartCard): void {
  if (card.animationTimer !== null) {
    window.clearInterval(card.animationTimer);
    card.animationTimer = null;
  }
  card.animationPlaying = false;
  card.syncAnimationBar();
}

/** Playback bar state: visible only while frames exist. */
export function syncAnimationBar(card: ChartCard): void {
  const result = card.animationResult;
  const active = result !== null && result.frames.length > 1;
  card.animationBar.classList.toggle("hidden", !active);
  if (!active || result === null) return;
  card.animationPlayButton.textContent = card.animationPlaying ? "❚❚ Pause" : "▶ Play";
  card.animationSlider.max = String(result.frames.length - 1);
  card.animationSlider.value = String(card.animationFrame);
  const speed = card.config.animationSpeed ?? 1;
  const presets = ["0.5", "0.75", "1", "1.25", "1.5", "2"];
  card.animationSpeedSelect.value = presets.includes(String(speed)) ? String(speed) : "custom";
  const customOption = [...card.animationSpeedSelect.options].find(
    (option) => option.value === "custom",
  );
  if (customOption !== undefined) {
    customOption.textContent = presets.includes(String(speed)) ? "Custom…" : `Custom (${speed}×)`;
  }
  const frame = result.frames[card.animationFrame];
  card.animationFrameLabel.textContent = frame?.label ?? "";
}

/**
 * Draws every animation frame to an offscreen canvas (2× the card size)
 * with an opaque panel background. Shared by the GIF and MP4 encoders so
 * both formats show exactly the same pixels.
 */
export async function renderAnimationFrames(card: ChartCard): Promise<
    { frames: GifFrameInput[]; width: number; height: number } | null
  > {
  const result = card.animationResult;
  if (result === null || result.frames.length < 2) {
    card.noteEl.textContent =
      "Set up an animation first — pick a time column and frame length above.";
    return null;
  }
  card.stopAnimation();
  const cssWidth = Math.max(
    1,
    Math.round(Number.parseFloat(card.canvas.style.width) || card.canvas.clientWidth || 480),
  );
  const cssHeight = Math.max(
    1,
    Math.round(Number.parseFloat(card.canvas.style.height) || card.canvas.clientHeight || 270),
  );
  const scale = 2;
  const offscreen = document.createElement("canvas");
  offscreen.width = cssWidth * scale;
  offscreen.height = cssHeight * scale;
  const ctx = offscreen.getContext("2d");
  if (ctx === null) {
    card.noteEl.textContent = "Canvas rendering is not available in this browser.";
    return null;
  }
  const previous = card.animationFrame;
  const frames: GifFrameInput[] = [];
  try {
    for (let index = 0; index < result.frames.length; index++) {
      card.animationFrame = index;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      card.drawChart(ctx, cssWidth, cssHeight, true);
      // Opaque background: paint behind the chart (drawChart clears first),
      // because a transparent frame reads as black in many viewers.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = cssVar("--panel", "#ffffff");
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.globalCompositeOperation = "source-over";
      const image = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
      frames.push({ data: image.data, width: offscreen.width, height: offscreen.height });
      if (index % 4 === 3) {
        card.noteEl.textContent = `Rendering frame ${index + 1} of ${result.frames.length}…`;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
  } finally {
    card.animationFrame = previous;
    card.render();
  }
  return { frames, width: offscreen.width, height: offscreen.height };
}

/** Encodes the rendered frames as an animated GIF at the chosen speed. */
export async function exportAnimationGif(card: ChartCard): Promise<void> {
  const rendered = await card.renderAnimationFrames();
  if (rendered === null) return;
  try {
    const bytes = encodeGif(rendered.frames, card.frameIntervalMs());
    if (bytes.length === 0) {
      card.noteEl.textContent = "Could not encode the GIF in this browser.";
      return;
    }
    card.downloadBlob(new Blob([bytes as BlobPart], { type: "image/gif" }), "gif");
    const seconds = ((rendered.frames.length * card.frameIntervalMs()) / 1000).toFixed(1);
    card.noteEl.textContent = `Exported ${rendered.frames.length} frames as a GIF · ${seconds} s per loop · ${(
      bytes.length / 1024
    ).toFixed(0)} KB · some desktop viewers show only the first frame, use Video (.mp4) if so`;
  } catch {
    card.noteEl.textContent = "Could not encode the GIF in this browser.";
  }
}

/**
 * Encodes the rendered frames as an H.264 MP4 with WebCodecs. Videos play
 * in every desktop player, unlike animated GIFs in some viewers.
 */
export async function exportAnimationVideo(card: ChartCard): Promise<void> {
  const encoderCtor = (
    globalThis as {
      VideoEncoder?: {
        new (init: {
          output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
          error: (error: Error) => void;
        }): VideoEncoder;
        isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
      };
    }
  ).VideoEncoder;
  if (typeof encoderCtor !== "function") {
    card.noteEl.textContent =
      "Video export needs WebCodecs (Chrome, Edge or Safari 16.4+). Try the GIF format instead.";
    return;
  }
  const rendered = await card.renderAnimationFrames();
  if (rendered === null) return;
  const { frames, width, height } = rendered;
  // H.264 needs even dimensions.
  const codedWidth = width % 2 === 0 ? width : width + 1;
  const codedHeight = height % 2 === 0 ? height : height + 1;
  const fps = Math.max(1, Math.round(1000 / card.frameIntervalMs()));
  try {
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
    // Prefer H.264 (plays everywhere); fall back to VP9-in-MP4 where the
    // platform exposes no H.264 encoder.
    const candidates: {
      codec: string;
      muxerCodec: "avc" | "vp9";
    }[] = [
      { codec: "avc1.42001f", muxerCodec: "avc" },
      { codec: "avc1.4d002a", muxerCodec: "avc" },
      { codec: "vp09.00.10.08", muxerCodec: "vp9" },
    ];
    let chosen: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      try {
        const support = await encoderCtor.isConfigSupported({
          codec: candidate.codec,
          width: codedWidth,
          height: codedHeight,
          bitrate: 4_000_000,
          framerate: fps,
        });
        if (support.supported === true) {
          chosen = candidate;
          break;
        }
      } catch {
        // Try the next codec.
      }
    }
    if (chosen === null) {
      card.noteEl.textContent =
        "This browser cannot encode video (no H.264 or VP9 encoder). Use the GIF format instead.";
      return;
    }
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: chosen.muxerCodec, width: codedWidth, height: codedHeight },
      fastStart: "in-memory",
    });
    let encodeError: Error | null = null;
    const encoder = new encoderCtor({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        encodeError = error;
      },
    });
    encoder.configure({
      codec: chosen.codec,
      width: codedWidth,
      height: codedHeight,
      bitrate: 4_000_000,
      framerate: fps,
    });
    const durationUs = (card.frameIntervalMs() * 1000) / 1;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      if (frame === undefined) continue;
      const videoFrame = new VideoFrame(frame.data, {
        format: "RGBA",
        codedWidth,
        codedHeight,
        timestamp: Math.round(index * durationUs),
        duration: Math.round(durationUs),
      });
      encoder.encode(videoFrame, { keyFrame: index === 0 || index % 30 === 0 });
      videoFrame.close();
      if (encoder.encodeQueueSize > 8) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }
    await encoder.flush();
    encoder.close();
    if (encodeError !== null) throw encodeError;
    muxer.finalize();
    const buffer = muxer.target.buffer;
    card.downloadBlob(new Blob([buffer], { type: "video/mp4" }), "mp4");
    const seconds = (frames.length / fps).toFixed(1);
    card.noteEl.textContent = `Exported ${frames.length} frames as an MP4 · ${seconds} s per loop · ${(
      buffer.byteLength / 1024
    ).toFixed(0)} KB`;
  } catch (error) {
    card.noteEl.textContent =
      error instanceof Error && error.message !== ""
        ? `Could not encode the video: ${error.message}`
        : "Could not encode the video in this browser.";
  }
}

/** Animated bars: category counts for the current frame only. */
/** Animated histogram: bin counts for the current frame on a global scale. */
export function drawAnimatedHistogram(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.animationResult;
  const hist = result?.hist;
  if (result === null || hist === undefined) {
    const message = "No frames to draw yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const frameIndex = Math.min(Math.max(0, card.animationFrame), result.frames.length - 1);
  const bins = hist.bins;
  const offset = frameIndex * bins;
  const ui = frame.ui;
  const maxCount = Math.max(1, result.maxCount);
  const slotW = frame.plotW / bins;
  const barW = Math.max(1, slotW - 1);

  const yTicks = niceTicks(0, maxCount, 4).filter(
    (value, index, all) =>
      index === 0 || formatCount(value) !== formatCount(all[index - 1]),
  );
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = frame.top + frame.plotH - (value / maxCount) * frame.plotH;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatCount(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();

  for (let bin = 0; bin < bins; bin++) {
    const count = hist.counts[offset + bin] ?? 0;
    const height = (count / maxCount) * frame.plotH;
    if (height <= 0) continue;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = card.primaryColor();
    card.fillTopRounded(
      ctx,
      frame.left + bin * slotW,
      frame.top + frame.plotH - height,
      barW,
      height,
      3 * ui,
    );
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  const animTickKind: "histogram" | AxisFormat =
    axisKindFor(card.meta(card.config.column)?.type ?? "number") ?? "histogram";
  const animTickSpan = hist.max - hist.min;
  const mid = (hist.min + hist.max) / 2;
  ctx.fillText(formatTick(hist.min, animTickKind, animTickSpan), frame.left, frame.top + frame.plotH + 16 * ui);
  const midLabel = formatTick(mid, animTickKind, animTickSpan);
  ctx.fillText(
    midLabel,
    frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
    frame.top + frame.plotH + 16 * ui,
  );
  const maxLabel = formatTick(hist.max, animTickKind, animTickSpan);
  ctx.fillText(
    maxLabel,
    frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
    frame.top + frame.plotH + 16 * ui,
  );

  const time = result.frames[frameIndex]?.label ?? "";
  card.font(ctx, ui, 12, "600");
  ctx.fillStyle = frame.text;
  ctx.fillText(time, frame.left + frame.plotW - ctx.measureText(time).width, frame.top - 8 * ui);
  const name = card.meta(card.config.column)?.name ?? "values";
  card.noteEl.textContent = `${time} · ${name} · ${bins} bins · ${result.total.toLocaleString()} rows`;
}

/** Animated treemap: tile areas from the current frame's category counts. */
export function drawAnimatedTreemap(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.animationResult;
  const barData = result?.bar;
  if (result === null || barData === undefined) {
    const message = "No frames to draw yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const frameIndex = Math.min(Math.max(0, card.animationFrame), result.frames.length - 1);
  const width = Math.max(1, barData.labels.length);
  const offset = frameIndex * width;
  const entries = barData.labels
    .map((label, index) => ({ label, value: barData.counts[offset + index] ?? 0 }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  if (entries.length === 0) {
    const message = "No rows in this frame.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const rects = squarifyLayout(
    entries.map((entry) => entry.value),
    frame.left,
    frame.top,
    frame.plotW,
    frame.plotH,
  );
  const ui = frame.ui;
  card.hitRegions = [];
  rects.forEach((rect, index) => {
    const entry = entries[index];
    if (entry === undefined || rect.w <= 0 || rect.h <= 0) return;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle =
      card.config.multiColor === true ? card.paletteColor(index) : card.primaryColor();
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar("--panel", "#ffffff");
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    if (rect.w < 42 * ui || rect.h < 18 * ui) return;
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    card.font(ctx, ui, 11, "600");
    ctx.fillText(
      card.fit(ctx, entry.label === "" ? "(blank)" : entry.label, rect.w - 10 * ui),
      rect.x + 5 * ui,
      rect.y + 14 * ui,
    );
    card.font(ctx, ui, 10);
    ctx.fillText(
      `${formatCount(entry.value)} · ${((entry.value / total) * 100).toFixed(1)}%`,
      rect.x + 5 * ui,
      rect.y + 27 * ui,
    );
  });
  ctx.textAlign = "left";
  const time = result.frames[frameIndex]?.label ?? "";
  card.font(ctx, ui, 12, "600");
  ctx.fillStyle = frame.text;
  ctx.fillText(time, frame.left + frame.plotW - ctx.measureText(time).width, frame.top - 8 * ui);
  const name = card.meta(card.config.column)?.name ?? "category";
  card.noteEl.textContent = `${time} · ${formatCount(total)} rows in ${entries.length} tiles by ${name}`;
}

/** Animated density: the frame's grid through the normal density renderer. */
export function drawAnimatedDensity(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.animationResult;
  const animated = result?.bubble;
  const xMeta = card.meta(card.config.x);
  const yMeta = card.meta(card.config.y);
  if (
    result === null ||
    animated === undefined ||
    xMeta === undefined ||
    yMeta === undefined
  ) {
    const message = "Density animation needs two numeric columns — pick X and Y above.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const frameIndex = Math.min(Math.max(0, card.animationFrame), result.frames.length - 1);
  const cellCount = animated.bins * animated.bins;
  const groupCount = animated.groups === null ? 1 : animated.groups.length;
  const counts = new Float64Array(animated.bins * animated.bins);
  // Merge the frame's group grids back into one density surface; the layout
  // is frames * groups * cells when the worker was asked to group.
  for (let group = 0; group < groupCount; group++) {
    const base = (frameIndex * groupCount + group) * cellCount;
    for (let cell = 0; cell < cellCount; cell++) {
      counts[cell] += animated.grids[base + cell] ?? 0;
    }
  }
  const merged = Uint32Array.from(counts);
  let max = 0;
  let total = 0;
  for (const count of merged) {
    total += count;
    if (count > max) max = count;
  }
  const grid: SeriesGrid = {
    mode: "density",
    counts: merged,
    cols: animated.bins,
    rows: animated.bins,
    xMin: animated.xMin,
    xMax: animated.xMax,
    yMin: animated.yMin,
    yMax: animated.yMax,
    total,
    outside: 0,
    max,
  };
  const savedCorrelation = card.seriesCorrelation;
  card.seriesCorrelation = Number.NaN;
  try {
    card.drawDensity(ctx, frame, grid, xMeta, yMeta);
  } finally {
    card.seriesCorrelation = savedCorrelation;
  }
  const time = result.frames[frameIndex]?.label ?? "";
  card.font(ctx, frame.ui, 12, "600");
  ctx.textAlign = "left";
  ctx.fillStyle = frame.text;
  ctx.fillText(
    time,
    frame.left + frame.plotW - ctx.measureText(time).width,
    frame.top - 8 * frame.ui,
  );
  card.noteEl.textContent = `${time} · ${card.noteEl.textContent ?? ""}`;
}

export function drawAnimatedBars(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.animationResult;
  const barData = result?.bar;
  if (result === null || barData === undefined || result.frames.length === 0) {
    const message = "No frames to draw yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const frameIndex = Math.min(Math.max(0, card.animationFrame), result.frames.length - 1);
  const labels = barData.labels;
  const width = Math.max(1, labels.length);
  const offset = frameIndex * width;
  const ui = frame.ui;
  // Every frame scales to the global maximum, so growth and decline over
  // time are visible instead of each frame refilling the plot.
  const maxCount = Math.max(1, result.maxCount);
  const slotW = frame.plotW / width;
  const barW = Math.max(4, slotW - Math.min(18 * ui, slotW * 0.25));

  const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || formatCount(value) !== formatCount(all[index - 1]));
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = frame.top + frame.plotH - (value / maxCount) * frame.plotH;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatCount(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();

  card.font(ctx, ui, 10);
  labels.forEach((label, index) => {
    const count = barData.counts[offset + index] ?? 0;
    const height = (count / maxCount) * frame.plotH;
    const x = frame.left + index * slotW + (slotW - barW) / 2;
    if (height > 0) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle =
        card.config.multiColor === true ? card.paletteColor(index) : card.primaryColor();
      card.fillTopRounded(ctx, x, frame.top + frame.plotH - height, barW, height, 4 * ui);
      ctx.globalAlpha = 1;
      if (slotW > 42 * ui) {
        ctx.fillStyle = frame.dim;
        ctx.textAlign = "center";
        ctx.fillText(
          formatCount(count),
          x + barW / 2,
          Math.max(frame.top + 8 * ui, frame.top + frame.plotH - height - 4 * ui),
        );
      }
    }
    ctx.fillStyle = frame.dim;
    ctx.textAlign = "center";
    let text = label === "" ? "(blank)" : label;
    const maxLabelW = Math.max(10, slotW - 6 * ui);
    while (text.length > 2 && ctx.measureText(text).width > maxLabelW) text = text.slice(0, -2);
    if (text !== label) text = `${text}…`;
    ctx.fillText(text, frame.left + (index + 0.5) * slotW, frame.top + frame.plotH + 16 * ui);
  });
  ctx.textAlign = "left";

  const time = result.frames[frameIndex]?.label ?? "";
  card.font(ctx, ui, 12, "600");
  ctx.fillStyle = frame.text;
  ctx.fillText(time, frame.left + frame.plotW - ctx.measureText(time).width, frame.top - 8 * ui);
  card.noteEl.textContent = `${time} · ${result.total.toLocaleString()} rows · play or scrub below`;
}
