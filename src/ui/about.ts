/**
 * The front page's About and Version cards: what the app is for, that it runs only
 * in this browser, who made it, and the work it stands on. Plain DOM, no requests.
 */

import { el } from "./dom.js";

const AUTHOR = {
  name: "Jay Stein",
  linkedin: "https://www.linkedin.com/in/mr-jay-stein",
  github: "https://github.com/jay-stein",
};

const KIT: [string, string][] = [
  ["Data quality", "Missing values, duplicates, mixed types and suspicious values, scored and explained column by column."],
  ["Cleaning", "Type fixes, standardising and Excel-style new columns, each step kept in a Recipe you can replay or export to pandas or Polars."],
  ["Analysis", "Fuzzy search, filters, pivots, charts and maps of the rows in front of you."],
  ["Research", "Outliers by several methods, relationships between columns, and forecasts always judged out of sample against simple benchmarks."],
];

function link(href: string, label: string): HTMLElement {
  return el("a", { class: "about-link", href, target: "_blank", rel: "noopener noreferrer" }, [label, el("span", { class: "about-link-arrow", "aria-hidden": "true" }, ["↗"])]);
}

/** "About this app": purpose, the four kinds of tool, privacy, author and acknowledgements. */
export function buildAbout(): HTMLElement {
  const kit = el("ul", { class: "about-kit" }, KIT.map(([name, text]) =>
    el("li", {}, [el("span", { class: "about-kit-name" }, [name]), el("span", { class: "about-kit-text" }, [text])]),
  ));
  return el("section", { class: "about-card", "aria-labelledby": "about-title" }, [
    el("div", { class: "about-eyebrow" }, ["About this app"]),
    el("h2", { id: "about-title" }, ["An analyst's Swiss Army knife for tables"]),
    el("p", { class: "about-lead" }, [
      "One place to check, clean and understand a dataset before you trust it: load a file, see what is wrong with it, fix it, then chart, pivot, map and forecast. ",
      "Time Series, Map, Outliers and Relationships go deeper, and are particularly useful if you do time-series forecasting.",
    ]),
    kit,
    el("p", { class: "about-private" }, [
      el("strong", {}, ["Runs only in your browser."]),
      " Files are read on this device. Nothing is uploaded, there is no account and no tracking, and it keeps working offline.",
    ]),
    el("p", { class: "about-thanks" }, [
      "Standing on good shoulders: the forecasting follows Hyndman & Athanasopoulos' ",
      el("a", { href: "https://otexts.com/fpp3/", target: "_blank", rel: "noopener noreferrer" }, ["Forecasting: Principles and Practice"]),
      " and is measured on the Monash archive and the M4 competition. The charts take their lead from Cole Nussbaumer Knaflic's ",
      el("cite", {}, ["Storytelling with Data"]),
      "; decomposition comes from Cleveland's STL, box plots from Tukey, and the quality checks borrow from Great Expectations. ",
      "Files are opened with Papa Parse, SheetJS and hyparquet.",
    ]),
    el("div", { class: "about-author" }, [
      el("span", {}, ["Made by ", el("strong", {}, [AUTHOR.name])]),
      el("span", { class: "about-author-links" }, [link(AUTHOR.linkedin, "LinkedIn"), link(AUTHOR.github, "GitHub")]),
    ]),
  ]);
}

/** Version details: a placeholder until releases are numbered. */
export function buildVersion(): HTMLElement {
  return el("section", { class: "about-card about-version", "aria-labelledby": "version-title" }, [
    el("div", { class: "about-eyebrow", id: "version-title" }, ["Version"]),
    el("p", { class: "about-dim" }, ["Version details and release notes are to come."]),
  ]);
}
