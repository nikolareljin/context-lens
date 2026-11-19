import { describe, expect, it } from "vitest";
import { CHIP_SANDBOX, chipDocument, sanitizeChip } from "./searchChip";

describe("Search Suggestions chip", () => {
  it("keeps the chip's markup and links, opening in a new tab", () => {
    const out = sanitizeChip('<style>.c{color:red}</style><div class="c"><a href="https://www.google.com/search?q=springfield">springfield</a></div>');
    expect(out).toContain("<style>.c{color:red}</style>");
    expect(out).toContain('href="https://www.google.com/search?q=springfield"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("removes scripts, frames, handlers and script or remote URLs", () => {
    const out = sanitizeChip(
      '<script>alert(1)</script><iframe src="https://example.com"></iframe><img src="https://example.com/t.gif" onerror="alert(2)">' +
        '<a href="javascript:alert(3)">x</a><svg><a xlink:href="javascript:alert(4)"></a></svg><form action="https://example.com"><input></form>' +
        '<img src="data:image/png;base64,AAAA">',
    );
    expect(out).not.toMatch(/script|iframe|onerror|javascript:|example\.com|<form|<input/i);
    expect(out).toContain('src="data:image/png;base64,AAAA"');
  });

  it("isolates the chip: no scripts, no same origin, and a policy that blocks every load", () => {
    expect(CHIP_SANDBOX).not.toContain("allow-scripts");
    expect(CHIP_SANDBOX).not.toContain("allow-same-origin");
    const doc = chipDocument("<b>chip</b>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("<b>chip</b>");
  });

  it("removes everything that can navigate, redirect or submit", () => {
    const out = sanitizeChip(
      '<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com/">' +
        '<form action="https://example.com"><button formaction="https://example.com">go</button></form>' +
        '<svg><a><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="href" to="https://example.com"/>x</a></svg>' +
        '<area href="https://example.com"><div style="color:red" ping="https://example.com">ok</div>',
    );
    expect(out).not.toMatch(/meta|base|form|button|animate|<set|area|ping|example\.com|javascript/i);
    expect(out).toContain('style="color:red"');
  });

  it("cleans again until nothing changes, so re-parsed markup cannot bring anything back (mXSS)", () => {
    const tricky = [
      '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
      '<math><mtext><table><mglyph><style><img src=x onerror=alert(2)></style></mglyph></table></mtext></math>',
      '<noscript><p title="</noscript><img src=x onerror=alert(3)>">',
      '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(4)>',
    ];
    for (const html of tricky) {
      const out = sanitizeChip(html);
      expect(out).not.toMatch(/onerror|<img src="?[^d"]/i);
      expect(sanitizeChip(out)).toBe(out);
    }
  });
});
