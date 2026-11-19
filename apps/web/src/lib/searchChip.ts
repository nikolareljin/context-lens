/**
 * Google's Search Suggestions chip (renderedContent) as a self-contained document for a
 * sandboxed iframe, as the Android app shows it in a WebView with JavaScript and network
 * loads off. Scripts, frames, forms, meta and base tags, SVG animation and event handlers are
 * removed, and so is every URL but an https link; a Content Security Policy blocks every load
 * and script; links open in a new tab.
 */
const DROP = [
  "script", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet", "portal",
  "form", "input", "button", "textarea", "select", "option", "datalist", "keygen", "isindex",
  "link", "meta", "base", "title", "head",
  "audio", "video", "source", "track", "picture",
  "animate", "animatemotion", "animatetransform", "set", "use", "foreignobject", "handler", "listener",
  "math", "xmp", "plaintext", "noembed", "noframes", "area", "map",
].join(",");

/** Attributes that load or navigate: kept only as an https link (href) or an inline image (src). */
const URL_ATTRIBUTES = new Set([
  "src", "srcset", "action", "formaction", "background", "poster", "data", "codebase", "cite", "longdesc",
  "lowsrc", "dynsrc", "ping", "manifest", "xlink:href", "xml:base", "to", "from", "values", "by", "attributename",
]);

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

/** Rounds of cleaning before giving up: markup that keeps changing when parsed again is dropped. */
const MAX_ROUNDS = 5;

function safeLink(value: string): boolean {
  return /^https:\/\//i.test(value.trim());
}

function cleanOnce(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(DROP).forEach((el) => el.remove());
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "http-equiv" || name === "target" || name === "rel") {
        el.removeAttribute(attr.name);
      } else if (name === "href") {
        if (el.tagName.toLowerCase() !== "a" || !safeLink(attr.value)) el.removeAttribute(attr.name);
      } else if (name === "src") {
        if (el.tagName.toLowerCase() !== "img" || !attr.value.trim().startsWith("data:image/")) el.removeAttribute(attr.name);
      } else if (URL_ATTRIBUTES.has(name) || name.endsWith(":href")) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName.toLowerCase() === "a" && el.hasAttribute("href")) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  }
  return doc.body.innerHTML;
}

/**
 * The chip's markup without anything that could run, load or navigate. It is cleaned again on
 * its own output until it no longer changes, so markup that mutates when parsed (mXSS) cannot
 * bring anything back; if it never settles, nothing is shown.
 */
export function sanitizeChip(html: string): string {
  let current = html;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const next = cleanOnce(current);
    if (next === current) return next;
    current = next;
  }
  return "";
}

/** The iframe document: the cleaned chip under a policy that allows no script and no load. */
export function chipDocument(html: string): string {
  return [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="referrer" content="no-referrer">',
    "<style>html,body{margin:0;background:transparent}</style>",
    "</head><body>",
    sanitizeChip(html),
    "</body></html>",
  ].join("");
}

/** No allow-scripts and no allow-same-origin: the chip can only open its links in a new tab. */
export const CHIP_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";
