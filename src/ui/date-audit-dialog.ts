/**
 * "How was this read?": a date column's text as it is in the file, beside the date it became and
 * that date spelled out (Mon 7 Jul 2014), so a day read as a month stands out. Above the rows: the
 * forms of text found over the whole column, and how many did not read or could be either way.
 */
import type { DateAuditMessage } from "../worker/protocol.js";
import type { DateAuditRow } from "../data/date-audit.js";
import { formatDurationMs, toTimeValue } from "../parse/dates.js";
import { TYPE_LABELS } from "../types.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

const ORDER_WORDS: Record<string, string> = {
  dmy: "day first (DD/MM/YYYY)",
  mdy: "month first (MM/DD/YYYY)",
  ymd: "year first (YYYY-MM-DD)",
};

const pad = (value: number): string => String(value).padStart(2, "0");

/** The value as the column holds it: the form an export would write. */
export function readAs(type: DateAuditMessage["columnType"], ms: number): string {
  if (!Number.isFinite(ms)) return "";
  if (type === "time") return toTimeValue(ms);
  if (type === "duration") return formatDurationMs(ms);
  const d = new Date(ms);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return type === "date" ? day : `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const SPELLED = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });

/** The same date in words: no doubt which number was the day and which the month. */
function spelled(type: DateAuditMessage["columnType"], ms: number): string {
  if (!Number.isFinite(ms) || type === "time" || type === "duration") return "";
  const date = new Date(ms);
  const words = SPELLED.format(date);
  return type === "datetime" && ms % 86_400_000 !== 0 ? `${words}, ${CLOCK.format(date)}` : words;
}

const FLAG_WORDS: Record<DateAuditRow["flag"], string> = {
  ok: "",
  unreadable: "Did not read as a date",
  ambiguous: "Day and month could be swapped",
};

export function openDateAudit(name: string, request: () => Promise<DateAuditMessage>): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal date-audit-modal" });
  const close = el("button", { class: "icon-btn", type: "button", title: "Close", "aria-label": "Close" }, ["×"]) as HTMLButtonElement;
  const body = el("div", { class: "date-audit-body" }, [el("p", { class: "date-audit-wait" }, ["Reading the column…"])]);
  const done = el("button", { class: "primary", type: "button" }, ["Close"]) as HTMLButtonElement;
  modal.append(
    el("div", { class: "modal-head" }, [el("h2", {}, [`How “${name}” was read`]), close]),
    body,
    el("div", { class: "clean-footer" }, [el("span", { class: "grow" }), done]),
  );
  overlay.append(modal);
  document.body.append(overlay);
  const finish = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") finish();
  };
  document.addEventListener("keydown", onKey);
  close.addEventListener("click", finish);
  done.addEventListener("click", finish);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) finish();
  });
  setupDialog(overlay, `How ${name} was read`);

  void request().then(
    (audit) => body.replaceChildren(...content(audit)),
    () => body.replaceChildren(el("p", { class: "date-audit-wait" }, ["Could not read the column."])),
  );
}

function content(audit: DateAuditMessage): HTMLElement[] {
  const read = audit.nonEmpty - audit.unreadable;
  const count = (n: number): string => n.toLocaleString();
  const facts = el("ul", { class: "date-audit-facts" }, [
    el("li", {}, [
      el("strong", {}, [`${count(read)} of ${count(audit.nonEmpty)}`]),
      ` values with text read as ${TYPE_LABELS[audit.columnType].toLowerCase()}`,
      audit.blanks > 0 ? ` · ${count(audit.blanks)} empty or missing in the file` : "",
    ]),
    el("li", { class: audit.unreadable > 0 ? "warn" : "" }, [
      audit.unreadable === 0 ? "Every value with text read." : `${count(audit.unreadable)} did not read and show as empty.`,
    ]),
    el("li", { class: audit.ambiguous > 0 ? "warn" : "" }, [
      audit.ambiguous === 0
        ? "None could be read two ways (day and month are never both 12 or less in a day/month form)."
        : `${count(audit.ambiguous)} could be read two ways (both numbers 12 or less): they were read ${ORDER_WORDS[audit.dateOrder] ?? audit.dateOrder}. Check them below; to read them the other way, change the column type again and pick the other order.`,
    ]),
  ]);
  if (audit.columnType === "datetime" && read > 0) {
    facts.append(
      el("li", {}, [
        audit.timed === 0
          ? "Every time of day is 00:00:00: these are plain dates. Change the type to Date to drop the time; nothing else changes."
          : `${count(audit.timed)} values have a time of day other than 00:00:00.`,
      ]),
    );
  }
  if (audit.cleaned) facts.append(el("li", {}, ["The column has been changed since loading: “In the file” is the original text, “Read as” is the column now."]));

  const shapes = el("table", { class: "date-audit-shapes" }, [
    el("thead", {}, [el("tr", {}, [el("th", {}, ["Form of the text"]), el("th", { class: "num" }, ["Values"]), el("th", {}, ["For example"])])]),
    el(
      "tbody",
      {},
      audit.shapes.map((shape) => el("tr", {}, [el("td", { class: "mono" }, [shape.shape]), el("td", { class: "num" }, [count(shape.count)]), el("td", { class: "mono" }, [shape.example])])),
    ),
  ]);

  const rowsHost = el("div", { class: "date-audit-rows" });
  const tabs = el("div", { class: "date-audit-tabs", role: "group", "aria-label": "Which rows" });
  const show = (which: "first" | "problems"): void => {
    for (const button of tabs.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.which === which));
    const list = which === "first" ? audit.rows : audit.problems;
    rowsHost.replaceChildren(list.length === 0 ? el("p", { class: "date-audit-wait" }, ["No rows to show."]) : rowTable(audit, list));
  };
  const firstButton = el("button", { class: "small", type: "button", "data-which": "first" }, [`First ${count(audit.rows.length)} rows`]);
  const problemCount = audit.unreadable + audit.ambiguous;
  const problemButton = el("button", { class: "small", type: "button", "data-which": "problems" }, [`To check (${count(problemCount)})`]);
  if (problemCount === 0) problemButton.setAttribute("disabled", "disabled");
  firstButton.addEventListener("click", () => show("first"));
  problemButton.addEventListener("click", () => show("problems"));
  tabs.append(firstButton, problemButton);
  show("first");
  return [facts, el("h3", { class: "date-audit-title" }, ["Forms found in the whole column"]), shapes, el("h3", { class: "date-audit-title" }, ["Row by row"]), tabs, rowsHost];
}

function rowTable(audit: DateAuditMessage, rows: readonly DateAuditRow[]): HTMLElement {
  const body = el("tbody");
  for (const row of rows) {
    body.append(
      el("tr", { class: row.flag === "ok" ? "" : `flag-${row.flag}` }, [
        el("td", { class: "num" }, [(row.row + 1).toLocaleString()]),
        el("td", { class: "mono" }, [row.text]),
        el("td", { class: "mono" }, [readAs(audit.columnType, row.value) || "empty"]),
        el("td", {}, [spelled(audit.columnType, row.value)]),
        el("td", { class: "date-audit-flag" }, [FLAG_WORDS[row.flag]]),
      ]),
    );
  }
  return el("table", { class: "date-audit-table" }, [
    el("thead", {}, [el("tr", {}, [el("th", { class: "num" }, ["File row"]), el("th", {}, ["In the file"]), el("th", {}, ["Read as"]), el("th", {}, ["That is"]), el("th", {}, [""])])]),
    body,
  ]);
}
