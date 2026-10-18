import { compileExpression } from "./aggregate.js";

export type PivotLambdaCompile =
  | { ok: true; expression: string }
  | { ok: false; error: string };

type Token =
  | { kind: "number"; value: string }
  | { kind: "name"; value: string }
  | { kind: "symbol"; value: "(" | ")" | "+" | "-" | "*" | "/" | "," };

const FUNCTIONS = new Set([
  "mean",
  "median",
  "sum",
  "min",
  "max",
  "count",
  "size",
  "nunique",
  "std",
  "var",
  "first",
  "last",
  "quantile",
]);

/**
 * Validates `lambda x: ...` and rewrites supported calls to the existing safe
 * aggregate-expression language. No JavaScript is executed.
 */
export function compilePivotLambda(source: string, columnName: string): PivotLambdaCompile {
  const match = /^\s*lambda\s+x\s*:\s*([\s\S]+)$/.exec(source);
  if (match === null) {
    return { ok: false, error: "Start the expression with `lambda x:`." };
  }
  const body = match[1] ?? "";
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < body.length) {
    const char = body[pos] ?? "";
    if (/\s/.test(char)) {
      pos++;
      continue;
    }
    if ("()+-*/,".includes(char)) {
      tokens.push({
        kind: "symbol",
        value: char as "(" | ")" | "+" | "-" | "*" | "/" | ",",
      });
      pos++;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const number = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(body.slice(pos));
      if (number === null) return { ok: false, error: `Invalid number near "${body.slice(pos, pos + 8)}".` };
      tokens.push({ kind: "number", value: number[0] });
      pos += number[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(body.slice(pos));
      if (name === null) return { ok: false, error: "Invalid identifier." };
      tokens.push({ kind: "name", value: name[0] });
      pos += name[0].length;
      continue;
    }
    return { ok: false, error: `Unexpected "${char}".` };
  }
  if (tokens.length === 0) return { ok: false, error: "The lambda body is empty." };

  let cursor = 0;
  const peek = (): Token | undefined => tokens[cursor];
  const consume = (kind: Token["kind"], value?: string): Token | null => {
    const token = peek();
    if (token === undefined || token.kind !== kind) return null;
    if (value !== undefined && token.value !== value) return null;
    cursor++;
    return token;
  };
  const fail = (message: string): never => {
    throw new Error(message);
  };

  const parseExpression = (): string => {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.kind !== "symbol" || (token.value !== "+" && token.value !== "-")) break;
      cursor++;
      left = `(${left} ${token.value} ${parseTerm()})`;
    }
    return left;
  };
  const parseTerm = (): string => {
    let left = parseFactor();
    for (;;) {
      const token = peek();
      if (token?.kind !== "symbol" || (token.value !== "*" && token.value !== "/")) break;
      cursor++;
      left = `(${left} ${token.value} ${parseFactor()})`;
    }
    return left;
  };
  const parseFactor = (): string => {
    const sign = consume("symbol", "-") ?? consume("symbol", "+");
    const value = parsePrimary();
    return sign?.value === "-" ? `(-${value})` : value;
  };
  const parsePrimary = (): string => {
    const token = peek();
    if (token === undefined) return fail("The lambda body ends early.");
    if (consume("symbol", "(") !== null) {
      const inner = parseExpression();
      if (consume("symbol", ")") === null) fail('Missing ")".');
      return inner;
    }
    if (token.kind === "number") {
      cursor++;
      return token.value;
    }
    if (token.kind === "name") {
      cursor++;
      const name = token.value.toLowerCase();
      if (!FUNCTIONS.has(name)) {
        return fail(`Unknown lambda function "${token.value}".`);
      }
      if (consume("symbol", "(") === null) {
        return fail(`Use ${name}(x) inside the lambda.`);
      }
      if (name === "quantile") {
        const percentile = consume("number");
        if (percentile === null) {
          return fail("quantile(.) needs a percentile number from 0 to 100.");
        }
        const pct = Number(percentile.value);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return fail("quantile(.) must be between 0 and 100.");
        }
        if (consume("symbol", ")") === null) fail('Missing ")" after quantile(.).');
        return `p${pct}(${columnName})`;
      }
      const arg = consume("name");
      if (arg === null || arg.value.toLowerCase() !== "x") {
        return fail(`${name}(.) expects the lambda value x.`);
      }
      if (consume("symbol", ")") === null) fail(`Missing ")" after ${name}(x.`);
      switch (name) {
        case "mean":
        case "median":
        case "sum":
        case "min":
        case "max":
        case "first":
        case "last":
          return `${name}(${columnName})`;
        case "count":
        case "size":
          return `count(${columnName})`;
        case "nunique":
          return `distinct(${columnName})`;
        case "std":
          return `stddev(${columnName})`;
        case "var":
          return `(stddev(${columnName}) * stddev(${columnName}))`;
        default:
          return fail(`Unknown lambda function "${name}".`);
      }
    }
    return fail("Unexpected lambda token.");
  };

  let expression: string;
  try {
    expression = parseExpression();
    if (cursor !== tokens.length) {
      return { ok: false, error: "Unexpected text after the lambda expression." };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not parse the lambda.",
    };
  }
  const validated = compileExpression(expression, [columnName]);
  if (!validated.ok) return { ok: false, error: validated.error };
  return { ok: true, expression };
}
