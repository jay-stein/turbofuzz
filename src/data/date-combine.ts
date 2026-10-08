import { ColumnData } from "./column.js";
import {
  detectOrder,
  emptyComponents,
  parseDatePart,
  suggestRole,
  type DateComponents,
  type DatePartRole,
} from "../parse/date-parts.js";
import type { DateOrder } from "../parse/dates.js";
import { resolveZoneSpec, wallTimeToInstant, type ZoneSpec } from "./timezone.js";

export type CombineOutput = "date" | "datetime";

export interface CombineDatePart {
  column: number;
  role: DatePartRole;
}

export interface CombineDateOp {
  kind: "combineDate";
  parts: CombineDatePart[];
  output: CombineOutput;
  outputName: string;
  /** "auto" detects day-first vs month-first per date-like column. */
  order: "auto" | DateOrder;
  /** "UTC" | "local" | "naive" | IANA name | "±HH:MM". Offsets in the data win. */
  timeZone: string;
  dropParts: boolean;
}

const DATE_ROLES = new Set<DatePartRole>(["date", "datetime", "epoch"]);

function sampleValues(column: ColumnData, limit = 200): string[] {
  const out: string[] = [];
  for (let i = 0; i < column.raw.length && out.length < limit; i++) {
    if (!column.isNull(column.raw[i])) out.push(column.raw[i]);
  }
  return out;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "Z";
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
}

function formatDate(c: DateComponents): string {
  return `${String(c.year).padStart(4, "0")}-${pad2(c.month as number)}-${pad2(c.day as number)}`;
}

function formatDateTime(c: DateComponents, spec: ZoneSpec): string {
  const base = `${formatDate(c)}T${pad2(c.hour as number)}:${pad2(c.minute as number)}:${pad2(
    c.second as number,
  )}`;
  const withMs = (c.millisecond ?? 0) > 0 ? `${base}.${pad3(c.millisecond as number)}` : base;
  if (c.offsetMinutes !== null) return `${withMs}${formatOffset(c.offsetMinutes)}`;
  const resolved = wallTimeToInstant(
    c.year as number,
    c.month as number,
    c.day as number,
    c.hour as number,
    c.minute as number,
    c.second as number,
    c.millisecond as number,
    spec,
  );
  if (resolved.offsetMinutes === null) return withMs;
  return `${withMs}${formatOffset(resolved.offsetMinutes)}`;
}

function combineRow(
  columns: readonly ColumnData[],
  parts: readonly CombineDatePart[],
  roles: readonly DatePartRole[],
  orders: readonly DateOrder[],
  row: number,
  output: CombineOutput,
  spec: ZoneSpec,
): string | null {
  const components = emptyComponents();
  for (let i = 0; i < parts.length; i++) {
    const column = columns[parts[i].column];
    const value = column.raw[row];
    if (column.isNull(value)) continue;
    if (!parseDatePart(value, roles[i], orders[i], components)) return null;
  }

  if (components.year === null || components.month === null) return null;
  if (components.month < 1 || components.month > 12) return null;
  if (components.day === null) components.day = 1;
  if (components.day < 1 || components.day > daysInMonth(components.year, components.month)) {
    return null;
  }
  if (output === "date") return formatDate(components);

  components.hour ??= 0;
  components.minute ??= 0;
  components.second ??= 0;
  components.millisecond ??= 0;
  if (
    components.hour > 23 ||
    components.minute > 59 ||
    components.second > 59 ||
    components.millisecond > 999
  ) {
    return null;
  }
  if (components.meridiem !== null) {
    if (components.hour < 1 || components.hour > 12) return null;
    components.hour = (components.hour % 12) + (components.meridiem === "pm" ? 12 : 0);
  }
  return formatDateTime(components, spec);
}

function uniqueName(columns: readonly { name: string }[], name: string): string {
  const taken = new Set(columns.map((column) => column.name));
  let candidate = name;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${name} (${suffix++})`;
  }
  return candidate;
}

/**
 * Combines any mix of date/time part columns into a single ISO date or
 * datetime column. Roles set to "auto" are inferred from each column's name
 * and values; offsets found in the data take priority over the selected
 * timezone. Unparseable or incomplete rows become blank cells.
 */
export function applyCombineDate(
  columns: readonly ColumnData[],
  op: CombineDateOp,
): ColumnData[] {
  if (columns.length === 0) return columns.slice();
  const parts: CombineDatePart[] = [];
  const chosen = new Set<number>();
  for (const part of op.parts) {
    if (part.column < 0 || part.column >= columns.length || chosen.has(part.column)) continue;
    chosen.add(part.column);
    parts.push(part);
  }
  if (parts.length === 0) return columns.slice();

  const roles = parts.map((part) =>
    part.role === "auto"
      ? suggestRole(columns[part.column].name, sampleValues(columns[part.column]))
      : part.role,
  );
  const orders = parts.map((part, index) => {
    if (!DATE_ROLES.has(roles[index])) return "dmy" as DateOrder;
    if (op.order !== "auto") return op.order;
    return detectOrder(sampleValues(columns[part.column]));
  });
  const spec = resolveZoneSpec(op.timeZone);
  const outputName = uniqueName(
    columns,
    op.outputName.trim() || (op.output === "date" ? "date" : "datetime"),
  );

  const rowCount = columns[0].raw.length;
  const raw = new Array<string>(rowCount);
  for (let row = 0; row < rowCount; row++) {
    raw[row] = combineRow(columns, parts, roles, orders, row, op.output, spec) ?? "";
  }
  const created = ColumnData.create(outputName, raw);
  const kept = op.dropParts
    ? columns.filter((_, index) => !chosen.has(index))
    : columns.slice();
  return [...kept, created];
}
