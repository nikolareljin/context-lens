import { ktIsBlank, ktTrim } from "./jvmRegex";
import type { Citation, Grounding } from "./types";

/** One web chunk from the grounding metadata, before checks. */
export interface WebSource {
  uri: string | null;
  title: string | null;
  domain: string | null;
}

/** Reads web sources and the Search Suggestions chip out of grounding metadata. */
export const CITATIONS_MAX = 5;

export function parse(sources: WebSource[], searchQueries: string[], searchEntryPointHtml: string | null): Grounding {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const web of sources) {
    const uri = web.uri === null ? null : ktTrim(web.uri);
    if (uri === null || !uri.startsWith("https://")) continue;
    const domain = nonEmpty(web.domain) ?? host(uri);
    if (seen.has(uri)) continue;
    seen.add(uri);
    citations.push({ title: nonEmpty(web.title) ?? domain, uri, domain });
  }
  return {
    citations: citations.slice(0, CITATIONS_MAX),
    searchQueries: searchQueries.map(ktTrim).filter((it) => it.length > 0),
    searchEntryPointHtml: searchEntryPointHtml !== null && !ktIsBlank(searchEntryPointHtml) ? searchEntryPointHtml : null,
  };
}

function nonEmpty(text: string | null): string | null {
  if (text === null) return null;
  const t = ktTrim(text);
  return t.length > 0 ? t : null;
}

const illegal = /[\x00-\x20\x7F"<>\\^`{|}]|%(?![0-9A-Fa-f]{2})/;
const label = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const hostname = new RegExp(`^(?:${label}\\.)*[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.?$`);
// java.net.URI takes leading zeros in an IPv4 octet ("001.2.3.4").
const octet = "(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)";
const ipv4 = new RegExp(`^(?:${octet}\\.){3}${octet}$`);

/** A valid IPv6 literal, as java.net.URI checks it: 8 groups, or fewer with one "::", optionally ending in IPv4. */
function isIpv6(text: string): boolean {
  let s = text;
  let groups = 8;
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    if (!ipv4.test(s.slice(lastColon + 1))) return false;
    s = s.slice(0, lastColon + 1) + "0";
    groups = 7;
  }
  const hex = /^[0-9A-Fa-f]{1,4}$/;
  const parts = s.split("::");
  if (parts.length > 2) return false;
  const count = (p: string) => (p === "" ? [] : p.split(":"));
  const all = parts.flatMap(count);
  if (!all.every((g) => hex.test(g))) return false;
  if (parts.length === 2) return all.length <= groups - 1;
  return all.length === groups;
}

/**
 * The host for display, read the way java.net.URI reads it: case kept, "" when the
 * address is malformed or its authority is not a plain host[:port]. Nothing is fetched.
 */
function host(uri: string): string {
  if (illegal.test(uri)) return "";
  const authority = /^https:\/\/([^/?#]*)/.exec(uri)?.[1] ?? "";
  const at = authority.indexOf("@");
  const server = at >= 0 ? authority.slice(at + 1) : authority;
  const m = /^(\[[0-9A-Fa-f:.]+\]|[^:]*)(?::\d*)?$/.exec(server);
  if (m === null || m[1] === "") return "";
  const h = m[1];
  if (h.startsWith("[")) return isIpv6(h.slice(1, -1)) ? h : "";
  return ipv4.test(h) || hostname.test(h) ? h : "";
}

export const GroundingParser = { CITATIONS_MAX, parse };
