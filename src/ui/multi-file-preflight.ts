import type { Delimiter } from "../parse/delimiter.js";
import type { FileEncoding } from "../parse/encoding.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface FilePreflightSample {
  name: string;
  size: number;
  headers: string[];
  sampleRows: number;
  sampleBytes: number;
  encoding: FileEncoding | null;
  delimiter: Delimiter | null;
}

export interface FilePreflightEntry {
  name: string;
  size: number;
  estimatedRows: number;
  estimatedCells: number;
  columnCount: number;
  encoding: FileEncoding | null;
  delimiter: Delimiter | null;
  extraColumns: string[];
  missingColumns: string[];
}

export interface MultiFilePreflight {
  files: FilePreflightEntry[];
  commonColumns: string[];
  totalRows: number;
  totalCells: number;
  identicalColumns: boolean;
}

const headerKey = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

export function buildMultiFilePreflight(
  samples: readonly FilePreflightSample[],
): MultiFilePreflight {
  if (samples.length === 0) {
    return {
      files: [],
      commonColumns: [],
      totalRows: 0,
      totalCells: 0,
      identicalColumns: true,
    };
  }
  const columnSets = samples.map((sample) => new Set(sample.headers.map(headerKey)));
  const commonKeys = [...(columnSets[0] ?? new Set<string>())].filter((key) =>
    columnSets.every((set) => set.has(key)),
  );
  const commonSet = new Set(commonKeys);
  const baselineKeys = columnSets[0] ?? new Set<string>();
  const union = new Map<string, string>();
  for (const sample of samples) {
    for (const header of sample.headers) {
      const key = headerKey(header);
      if (!union.has(key)) union.set(key, header.trim());
    }
  }
  const files = samples.map((sample, index) => {
    const set = columnSets[index] ?? new Set<string>();
    const extraColumns = [...set]
      .filter((key) => !commonSet.has(key))
      .map((key) => union.get(key) ?? key);
    const missingColumns = [...baselineKeys]
      .filter((key) => !set.has(key))
      .map((key) => union.get(key) ?? key);
    const ratio = sample.sampleBytes > 0 ? sample.size / sample.sampleBytes : 1;
    const estimatedRows = Math.max(
      0,
      Math.round(sample.sampleRows * Math.max(1, ratio)),
    );
    return {
      name: sample.name,
      size: sample.size,
      estimatedRows,
      estimatedCells: estimatedRows * sample.headers.length,
      columnCount: sample.headers.length,
      encoding: sample.encoding,
      delimiter: sample.delimiter,
      extraColumns,
      missingColumns,
    };
  });
  return {
    files,
    commonColumns: commonKeys.map((key) => union.get(key) ?? key),
    totalRows: files.reduce((sum, file) => sum + file.estimatedRows, 0),
    totalCells: files.reduce((sum, file) => sum + file.estimatedCells, 0),
    identicalColumns: files.every(
      (file) => file.extraColumns.length === 0 && file.missingColumns.length === 0,
    ),
  };
}

const fileSize = (bytes: number): string => {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

export type MultiFileAppendMode = "align" | "identical";

/** Preflight summary and append-mode choice; null cancels the import. */
export function openMultiFilePreflight(
  preflight: MultiFilePreflight,
): Promise<MultiFileAppendMode | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal multi-file-modal" });
    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, [`Append ${preflight.files.length} files?`]));
    const close = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(close);
    modal.append(head);

    const body = el("div", { class: "multi-file-body" });
    body.append(
      el("p", { class: "multi-file-lead" }, [
        `${preflight.totalRows.toLocaleString()} estimated rows · ${preflight.totalCells.toLocaleString()} cells · ${preflight.commonColumns.length} shared columns`,
      ]),
    );
    const list = el("div", { class: "multi-file-list" });
    for (const file of preflight.files) {
      const row = el("div", { class: "multi-file-row" });
      row.append(
        el("span", { class: "multi-file-name", title: file.name }, [file.name]),
        el("span", { class: "multi-file-stat" }, [
          `${fileSize(file.size)} · ~${file.estimatedRows.toLocaleString()} rows · ${file.columnCount} cols`,
        ]),
        el("span", { class: "multi-file-stat" }, [
          file.encoding === null ? "encoding per file" : file.encoding,
        ]),
      );
      if (file.extraColumns.length > 0) {
        row.append(
          el("span", { class: "multi-file-extra" }, [
            `+${file.extraColumns.slice(0, 3).join(", ")}${file.extraColumns.length > 3 ? ", …" : ""}`,
          ]),
        );
      }
      if (file.missingColumns.length > 0) {
        row.append(
          el("span", { class: "multi-file-missing" }, [
            `missing ${file.missingColumns.slice(0, 3).join(", ")}${file.missingColumns.length > 3 ? ", …" : ""}`,
          ]),
        );
      }
      list.append(row);
    }
    body.append(list);

    const mode = el("div", { class: "multi-file-modes" });
    const align = el("input", {
      type: "radio",
      name: "multi-file-mode",
      value: "align",
      checked: "checked",
    }) as HTMLInputElement;
    const identical = el("input", {
      type: "radio",
      name: "multi-file-mode",
      value: "identical",
      ...(preflight.identicalColumns ? {} : { disabled: "disabled" }),
    }) as HTMLInputElement;
    const alignLabel = el("label", { class: "multi-file-mode" }, [
      align,
      el("span", {}, ["Align columns by header name"]),
      el("small", {}, ["Extra columns are added; missing cells stay blank."]),
    ]);
    const identicalLabel = el("label", { class: "multi-file-mode" }, [
      identical,
      el("span", {}, ["Require identical columns"]),
      el("small", {}, [
        preflight.identicalColumns
          ? "Every file has the same headers."
          : "Unavailable because the files have different headers.",
      ]),
    ]);
    mode.append(alignLabel, identicalLabel);
    body.append(mode);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const confirm = el("button", { class: "primary", type: "button" }, ["Append rows"]);
    footer.append(cancel, el("span", { class: "grow" }), confirm);
    modal.append(body, footer);

    let settled = false;
    const finish = (value: MultiFileAppendMode | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    close.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => finish(align.checked ? "align" : "identical"));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, `Append ${preflight.files.length} files`);
  });
}