import { S, ktTrim, re } from "./jvmRegex";
import type { GatekeeperResult } from "./types";

/**
 * Reads the gatekeeper's JSON reply. The model may wrap it in a code fence or add a
 * sentence around it, so the first {...} block is taken. A reply that is not valid
 * (no kind and no claim flag, an unknown kind, or a claim without a query) gives
 * null, and nothing is sent. Prompt v2 replies name the kind of sentence instead of
 * a claim flag; when both are present, the kind decides.
 */
export const QUERY_MAX = 240;
export const REFS_MAX = 5;
export const REF_MAX = 80;

/** A JSON number kept as written ("7.50" stays "7.50"), as the Android JSON reader keeps it. */
class JsonNumber {
  constructor(readonly text: string) {}
}

type JsonObject = Record<string, unknown>;

export function parse(text: string | null | undefined): GatekeeperResult | null {
  if (text == null) return null;
  const block = firstObject(text);
  if (block === null) return null;
  const obj = readJson(block);
  if (obj === null) return null;
  const kind = kindOf(string(obj, "kind"));
  if (kind === UNKNOWN_KIND) return null;
  const claim = kind !== null ? kind === "world" : flag(obj, "claim", "hasVerifiableClaim");
  if (claim === null) return null;
  const query = oneLine(string(obj, "query", "sanitizedResolvedQuery"));
  if (claim && query.length === 0) return null;
  const rawRefs = has(obj, "refs") ? obj.refs : obj.resolvedReferences;
  const refs = (Array.isArray(rawRefs) ? rawRefs : [])
    .map((it) => (isPrimitive(it) ? content(it) : null))
    .filter((it): it is string => it !== null)
    .map((it) => oneLine(it).slice(0, REF_MAX))
    .filter((it) => it.length > 0)
    .slice(0, REFS_MAX);
  const reason = [string(obj, "reason"), string(obj, "filterReason"), kind ?? ""].map(oneLine).find((it) => it.length > 0);
  return {
    hasVerifiableClaim: claim,
    sanitizedResolvedQuery: claim ? query.slice(0, QUERY_MAX) : "",
    resolvedReferences: claim ? refs : [],
    filterReason: claim ? null : (reason ?? null),
  };
}

/** The first balanced {...} block, skipping braces inside strings. */
export function firstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) escaped = false;
    else if (inString && c === "\\") escaped = true;
    else if (c === '"') inString = !inString;
    else if (inString) continue;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.substring(start, i + 1);
  }
  return null;
}

function readJson(block: string): JsonObject | null {
  let value: unknown;
  try {
    // The third reviver argument (the source text) is newer than the TypeScript DOM types.
    const reviver = (_key: string, v: unknown, context?: { source?: string }) =>
      typeof v === "number" ? new JsonNumber(context?.source ?? String(v)) : v;
    value = JSON.parse(escapeControls(block), reviver as (key: string, v: unknown) => unknown);
  } catch {
    return null;
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof JsonNumber)
    ? (value as JsonObject)
    : null;
}

/**
 * The Android JSON reader takes raw line breaks and other control characters inside
 * strings (a model often breaks a long question over two lines); JSON.parse does not,
 * so they are escaped first.
 */
function escapeControls(block: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const c of block) {
    if (inString && !escaped && c < " ") {
      out += `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
      continue;
    }
    if (escaped) escaped = false;
    else if (inString && c === "\\") escaped = true;
    else if (c === '"') inString = !inString;
    out += c;
  }
  return out;
}

const KINDS = new Set(["world", "small talk", "request", "opinion", "personal"]);
const UNKNOWN_KIND = "?";

const KIND_TRIM = /^["'.! ]+|["'.! ]+$/g;
const spaces = re(`${S}+`, "g");

/**
 * The kind in a v2 reply, normalized: case, spaces, quotes and trailing punctuation are
 * ignored, and "world fact" counts as world. null when there is no kind (a v1 reply);
 * UNKNOWN_KIND for anything else, such as the template's own list echoed back.
 */
function kindOf(raw: string): string | null {
  const k = ktTrim(raw.toLowerCase()).replace(KIND_TRIM, "").replace(spaces, " ");
  if (k.length === 0) return null;
  if (KINDS.has(k)) return k;
  return k.startsWith("world ") && !k.includes(",") ? "world" : UNKNOWN_KIND;
}

function has(obj: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** The first key present (a null value counts as present). */
function field(obj: JsonObject, keys: string[]): { value: unknown } | null {
  const key = keys.find((k) => has(obj, k));
  return key === undefined ? null : { value: obj[key] };
}

const isPrimitive = (v: unknown) => v === null || typeof v !== "object" || v instanceof JsonNumber;

/** A primitive's text: strings as they are, numbers as written, booleans as words; null for JSON null. */
function content(v: unknown): string | null {
  if (v === null) return null;
  if (v instanceof JsonNumber) return v.text;
  return String(v);
}

function flag(obj: JsonObject, ...keys: string[]): boolean | null {
  const f = field(obj, keys);
  if (f === null || !isPrimitive(f.value)) return null;
  if (typeof f.value === "boolean") return f.value;
  const text = content(f.value);
  if (text === null) return null;
  switch (ktTrim(text).toLowerCase()) {
    case "true":
    case "yes":
      return true;
    case "false":
    case "no":
      return false;
    default:
      return null;
  }
}

function string(obj: JsonObject, ...keys: string[]): string {
  const f = field(obj, keys);
  if (f === null || !isPrimitive(f.value)) return "";
  return content(f.value) ?? "";
}

function oneLine(text: string): string {
  return ktTrim(text).replace(spaces, " ");
}

export const GatekeeperParser = { QUERY_MAX, REFS_MAX, REF_MAX, parse, firstObject };
