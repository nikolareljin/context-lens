/**
 * Google's Search Suggestions chip (renderedContent) as a self-contained document for a
 * sandboxed iframe, as the Android app shows it in a WebView with JavaScript and network
 * loads off. Scripts, frames, forms, event handlers and script URLs are removed; a Content
 * Security Policy blocks every load and script; links open in a new tab.
 */
const DROP = "script,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,link,meta,base,noscript,template";

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

function safeUrl(value: string): boolean {
  return /^\s*https:\/\//i.test(value);
}

/** The chip's markup without anything that could run or load. */
export function sanitizeChip(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll(DROP).forEach((el) => el.remove());
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction" || name === "ping") {
        el.removeAttribute(attr.name);
      } else if (name === "href" || name === "xlink:href") {
        if (!safeUrl(attr.value)) el.removeAttribute(attr.name);
      } else if (name === "src" || name === "srcset" || name === "action" || name === "background" || name === "poster") {
        if (!attr.value.trim().startsWith("data:image/")) el.removeAttribute(attr.name);
      }
    }
    if (el.tagName.toLowerCase() === "a") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  }
  return doc.body.innerHTML;
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
