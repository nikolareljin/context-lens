import { useEffect, useRef, useState } from "react";
import { DOCS, EXTENSION_ZIP, INSTALL_COMMANDS, WEB_STORE_URL } from "../lib/config";

function Command({ label, command }: { label: string; command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = (next: "copied" | "failed") => {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2_000);
  };
  const copy = () => {
    if (!navigator.clipboard) {
      show("failed");
      return;
    }
    navigator.clipboard.writeText(command).then(
      () => show("copied"),
      () => show("failed"),
    );
  };
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-edge bg-ink px-3 py-2 text-xs">{command}</code>
        <button type="button" onClick={copy} aria-label={`Copy the ${label} command`} className="rounded-full border border-edge px-3 text-sm hover:border-device">
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p role="status" className="text-xs text-amber-300">
        {state === "failed" ? "Copying didn't work here: select the command and copy it." : state === "copied" ? "Copied to the clipboard." : ""}
      </p>
    </div>
  );
}

/** The Chrome extension: the store button once listed, the one-line install and the ZIP. */
export function ExtensionStrip() {
  return (
    <section id="extension" aria-labelledby="get-extension" className="flex scroll-mt-4 flex-col gap-4 rounded-2xl border border-edge bg-slate-950/70 p-6">
      <div>
        <h2 id="get-extension" className="text-xl font-semibold">Get the Chrome extension</h2>
        <p className="mt-1 text-slate-300">
          The same checks in Chrome's side panel, next to the page or video you are watching. It reads nothing from the pages
          you visit; its only permission is the side panel. Chrome 138 or newer.
        </p>
      </div>
      {WEB_STORE_URL ? (
        <div>
          <a href={WEB_STORE_URL} className="inline-block rounded-full bg-bridge px-5 py-2 font-medium text-white hover:bg-cloud">
            Add to Chrome
          </a>
          <p className="mt-1 text-xs text-slate-400">From the Chrome Web Store; Chrome keeps it up to date.</p>
        </div>
      ) : (
        <p className="text-sm text-slate-400">The Chrome Web Store listing is on its way; until then, install it in one of these two ways.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-edge p-4">
          <h3 className="font-semibold">One command</h3>
          <Command label="Linux and macOS (terminal)" command={INSTALL_COMMANDS.unix} />
          <Command label="Windows (PowerShell)" command={INSTALL_COMMANDS.windows} />
          <p className="text-xs text-slate-400">
            It downloads the newest release, checks its checksum and unpacks it into context-lens/extension in your home folder.
            With Google Chrome, it opens Chrome's extensions page and prints the four clicks, needed once. Without Chrome, it
            starts Chromium (if installed) with ContextLens in a separate window, or prints the same four clicks for your browser.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-edge p-4">
          <h3 className="font-semibold">ZIP by hand</h3>
          <ol className="list-decimal pl-5 text-sm text-slate-300">
            <li><a className="text-device underline" href={EXTENSION_ZIP}>Download the extension ZIP</a> and unzip it into a folder you keep.</li>
            <li>Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> (top right).</li>
            <li>Choose <strong>Load unpacked</strong> and select the unzipped folder.</li>
            <li>Pin ContextLens from the puzzle icon, then click it to open the side panel.</li>
          </ol>
          <p className="text-xs text-slate-400">
            <a className="text-device underline" href={`${DOCS}extension/`}>Install guide</a>: updates, removal and what it can access.
          </p>
        </div>
      </div>
    </section>
  );
}
