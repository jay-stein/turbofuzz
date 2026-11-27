/** The heading every page opens with, in the front page's type: a tight title and one plain line under it. */

import { el } from "./dom.js";

export function pageHead(title: string, sub: string): HTMLElement {
  return el("header", { class: "page-head" }, [
    el("h1", { class: "page-title" }, [title]),
    el("p", { class: "page-sub" }, [sub]),
  ]);
}
