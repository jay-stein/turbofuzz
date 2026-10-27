import type { ColumnMeta } from "../worker/protocol.js";
import { kindForRecommended, type BuilderPick } from "./chart-builder.js";
import { CHARTS, type SlotKind } from "./chart-registry.js";
import { fitChartKind, QUESTION_GROUPS } from "./chart-gallery.js";
import { profile, recommend, type RecRole } from "./chart-recommender.js";
import { CHART_KIND_LABELS, toRecColumn, type ChartCardKind } from "./chart-utils.js";
import { el } from "./dom.js";
import guide from "./guide.json";

interface GuideEntry {
  use: string;
  watch: string;
  tips: string[];
}
const ENTRIES = guide.charts as Record<string, GuideEntry>;

const KIND_WORD: Record<SlotKind, string> = {
  measure: "measure",
  cat: "category",
  time: "time",
  text: "text",
};

const matchesRole = (kind: SlotKind, role: RecRole, canMeasure?: boolean, canCategory?: boolean): boolean =>
  kind === "measure"
    ? role === "measure" || canMeasure === true
    : kind === "cat"
      ? role.startsWith("cat") || canCategory === true
      : kind === "time"
        ? role === "time"
        : role === "text";

export interface NeedLine {
  slot: string;
  need: string;
  have: string | null;
  optional: boolean;
}

/** What a chart needs, and which picked field (if any) fills each slot. */
export function needsVsHave(
  kind: ChartCardKind,
  picks: readonly BuilderPick[],
  columns: readonly ColumnMeta[],
  rowCount: number,
): NeedLine[] {
  const def = kind in CHARTS ? CHARTS[kind as keyof typeof CHARTS] : undefined;
  if (def === undefined) return [];
  const free = picks
    .map((pick) => ({ pick, p: profile(toRecColumn(columns[pick.index], pick.index, rowCount), rowCount) }))
    .filter((entry) => entry.p.role !== "id");
  const used = new Set<number>();
  return def.slots.map((slot) => {
    const found = free.find(
      (entry) =>
        !used.has(entry.pick.index) &&
        slot.kinds.some((k) => matchesRole(k, entry.p.role, entry.p.canMeasure, entry.p.canCategory)),
    );
    if (found !== undefined) used.add(found.pick.index);
    return {
      slot: slot.name,
      need: `1 ${slot.kinds.map((k) => KIND_WORD[k]).join(" or ")}`,
      have: found === undefined ? null : columns[found.pick.index].name,
      optional: slot.optional,
    };
  });
}

export interface GuideContext {
  columns: readonly ColumnMeta[];
  rowCount: number;
  picks(): BuilderPick[];
}

const entryBlock = (kind: ChartCardKind, extra: HTMLElement[] = []): HTMLElement => {
  const entry = ENTRIES[kind];
  const body = el("div", { class: "chart-guide-entry" }, [el("h4", {}, [CHART_KIND_LABELS[kind]])]);
  if (entry !== undefined) {
    body.append(
      el("p", {}, [el("strong", {}, ["Use when: "]), entry.use]),
      el("p", {}, [el("strong", {}, ["Watch out: "]), entry.watch]),
    );
    if (entry.tips.length > 0) body.append(el("ul", {}, entry.tips.map((tip) => el("li", {}, [tip]))));
  }
  body.append(...extra);
  return body;
};

/** The Guide drawer: loaded on first open, so the guide text costs nothing until then. */
export class ChartGuide {
  readonly root: HTMLElement;
  private tab: "selection" | "question" = "selection";
  private opener: HTMLElement | null = null;

  constructor(private readonly context: () => GuideContext) {
    this.root = el("aside", { class: "chart-guide hidden", "aria-label": "Chart guide" });
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  open(opener?: HTMLElement): void {
    this.opener = opener ?? null;
    this.root.classList.remove("hidden");
    this.render();
    (this.root.querySelector(".chart-guide-close") as HTMLElement | null)?.focus();
  }

  close(): void {
    this.root.classList.add("hidden");
    this.opener?.focus();
  }

  toggle(opener?: HTMLElement): void {
    if (this.isOpen) this.close();
    else this.open(opener);
  }

  /** Re-render if the fields on the shelf changed while the drawer is open. */
  refresh(): void {
    if (this.isOpen) this.render();
  }

  private render(): void {
    const tabs = el("div", { class: "chart-guide-tabs", role: "tablist" });
    for (const [id, label] of [
      ["selection", "For your selection"],
      ["question", "By question"],
    ] as const) {
      const button = el(
        "button",
        { type: "button", role: "tab", class: "chart-guide-tab", "aria-selected": this.tab === id ? "true" : "false" },
        [label],
      );
      button.addEventListener("click", () => {
        this.tab = id;
        this.render();
      });
      tabs.append(button);
    }
    const close = el(
      "button",
      { class: "icon-btn chart-guide-close", type: "button", title: "Close", "aria-label": "Close guide" },
      ["×"],
    );
    close.addEventListener("click", () => this.close());
    this.root.replaceChildren(
      el("div", { class: "chart-guide-head" }, [el("h3", {}, ["Chart guide"]), close]),
      tabs,
      this.tab === "selection" ? this.selectionBody() : this.questionBody(),
      this.footer(),
    );
  }

  private selectionBody(): HTMLElement {
    const { columns, rowCount } = this.context();
    const picks = this.context().picks();
    const body = el("div", { class: "chart-guide-body" });
    if (picks.length === 0) {
      body.append(
        el("p", { class: "chart-guide-hint" }, [
          "Pick fields in the Add chart panel and this tab lists the charts that fit them, what each needs and what to watch for.",
        ]),
      );
      return body;
    }
    const { options, notes } = recommend(
      picks.map((pick) => toRecColumn(columns[pick.index], pick.index, rowCount)),
      { rows: rowCount, source: "table" },
    );
    let any = false;
    for (const option of options) {
      const kind = kindForRecommended(option.chart);
      if (kind === null || option.isNew) continue;
      any = true;
      const lines = needsVsHave(kind, picks, columns, rowCount).map((line) =>
        el("li", { class: line.have === null && !line.optional ? "missing" : "" }, [
          `${line.slot}: ${line.have ?? (line.optional ? "optional" : `needs ${line.need}`)}${line.have === null ? "" : " ✓"}`,
        ]),
      );
      body.append(
        entryBlock(kind, [
          el("div", { class: "chart-guide-needs" }, [el("strong", {}, ["Needs vs you have"]), el("ul", {}, lines)]),
          ...(option.rank === "primary" ? [el("span", { class: "chart-add-best" }, ["Best fit"])] : []),
        ]),
      );
    }
    for (const note of notes) body.append(el("p", { class: "chart-guide-hint" }, [note]));
    if (!any && notes.length === 0) {
      body.append(el("p", { class: "chart-guide-hint" }, ["No chart fits this combination. Remove a field."]));
    }
    body.append(el("p", { class: "chart-guide-hint" }, [guide.notOffered]));
    return body;
  }

  private questionBody(): HTMLElement {
    const { columns, rowCount } = this.context();
    const body = el("div", { class: "chart-guide-body" });
    const extra = guide.extraQuestions as { question: string; kinds: ChartCardKind[] }[];
    for (const group of [...QUESTION_GROUPS, ...extra]) {
      body.append(el("h4", { class: "chart-guide-question" }, [group.question]));
      for (const kind of group.kinds) {
        const fit = fitChartKind(kind, columns, rowCount);
        body.append(
          entryBlock(kind, [
            el("span", { class: `chart-guide-badge ${fit.ok ? "ok" : "no"}` }, [fit.ok ? "available" : fit.reason]),
          ]),
        );
      }
    }
    return body;
  }

  private footer(): HTMLElement {
    // Links only load when clicked, so the page still makes no requests on its own.
    return el(
      "div",
      { class: "chart-guide-foot" },
      guide.links.map((link) => el("a", { href: link.href, target: "_blank", rel: "noopener noreferrer" }, [link.label])),
    );
  }
}
