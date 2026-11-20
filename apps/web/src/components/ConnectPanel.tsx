import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DOCS, EXTENSION_APP_CHECK, inExtension } from "../lib/config";
import { ANDROID_CONNECT_PREFIX, PROBLEM_TEXT, parseProject, problems, type WebProject } from "../cloud/project";

interface Props {
  project: WebProject | null;
  /** True when the project is kept in this browser's storage. */
  remembered: boolean;
  /** Returns why the project was not connected, or null when it was. */
  onConnect: (project: WebProject, remember: boolean) => string | null;
  onDisconnect: () => void;
}

/**
 * The visitor's own Firebase project: pasted, confirmed by name, kept in memory (or, only
 * when asked, in this browser's storage), removable. Nothing is sent while connecting; the
 * first cloud call uses it.
 */
export function ConnectPanel({ project, remembered, onConnect, onDisconnect }: Props) {
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<WebProject | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Focus moves into the dialog when it opens and back to the page when it closes.
  useEffect(() => {
    if (pending !== null) {
      wasOpen.current = true;
      confirmButton.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      (opener.current ?? disconnectButton.current)?.focus();
    }
  }, [pending]);

  /** Escape cancels; Tab stays inside the dialog. */
  const dialogKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setPending(null);
      return;
    }
    if (e.key !== "Tab" || dialog.current === null) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const check = () => {
    // The access code field first; the own-project field when it is empty.
    const usingCode = code.trim().length > 0;
    const pasted = usingCode ? code : text;
    if (!pasted.trim()) {
      setError("Paste an access code, or your own project's web app config under “Use your own Firebase project”.");
      return;
    }
    if (pasted.trim().startsWith(ANDROID_CONNECT_PREFIX)) {
      setError(
        "This is the Android app's connect code (contextlens-connect:1). The page needs the web app's config or a web connect code (contextlens-web-connect:1), which carries the web app id.",
      );
      return;
    }
    // The access code carries its own sign-in setting (anon=1); the box applies to your own project.
    const parsed = parseProject(pasted, usingCode ? false : anonymous);
    if (parsed === null) {
      setError(
        usingCode
          ? "This access code is incomplete or not an access code: copy the whole line, starting with contextlens-web-connect:1?"
          : "Paste the web app's firebaseConfig from the Firebase console, or a web connect code.",
      );
      return;
    }
    const found = problems(parsed);
    if (found.size > 0) {
      setError([...found].map((p) => PROBLEM_TEXT[p]).join("; "));
      return;
    }
    if (parsed.recaptchaSiteKey && inExtension()) {
      setError(EXTENSION_APP_CHECK);
      return;
    }
    if (parsed.recaptchaSiteKey && !remember) {
      setError(
        "App Check keeps a token in this browser's storage, so a reCAPTCHA site key needs “Remember on this device”. Tick it, or leave the site key out.",
      );
      return;
    }
    setError(null);
    setPending(parsed);
  };

  const confirm = () => {
    if (pending === null) return;
    const refused = onConnect(pending, remember);
    setPending(null);
    if (refused !== null) {
      setError(refused);
      return;
    }
    setText("");
    setCode("");
  };

  return (
    <section aria-labelledby="connect-title" className="rounded-xl border border-edge bg-slate-950/60 p-4">
      <h3 id="connect-title" className="font-semibold">Cloud check: your Firebase project</h3>
      {project ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-300">
            Connected: <strong className="text-slate-100">{project.projectId}</strong>
            {project.recaptchaSiteKey ? " · App Check on" : ""}
            {project.anonymousAuth ? " · anonymous sign-in" : ""}.{" "}
            {remembered
              ? "Remembered on this device."
              : inExtension()
                ? "Kept only while this ContextLens page is open."
                : "Kept in this tab's memory only; gone when the tab closes."}
          </p>
          <button ref={disconnectButton} type="button" onClick={() => onDisconnect()} className="rounded-full border border-edge px-4 py-1 text-sm hover:border-device">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-sm text-slate-300">
            Not connected: everything stays in this browser and the grounded check is skipped. The check runs Gemini with
            Google Search through Firebase AI Logic in a connected project, on that project's quota.{" "}
            {inExtension() ? "This extension" : "This site"} has no project of its own.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="access-code" className="text-sm font-medium">Access code</label>
            <input
              id="access-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="contextlens-web-connect:1?…"
              className="w-full rounded-full border border-edge bg-ink px-4 py-2 font-mono text-xs"
            />
            <p className="text-xs text-slate-400">
              Hackathon judges: the access code is in the submission's testing notes. It connects the demo project, with its own
              limits; use one only from someone you trust.
            </p>
          </div>
          <details className="rounded-lg border border-edge px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Use your own Firebase project</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-sm text-slate-300">
                Paste your web app's config from the Firebase console (Project settings, Your apps), or a web connect code you made
                for it.{" "}
                <a className="text-device underline" href={`${DOCS}web-setup/`} target="_blank" rel="noopener noreferrer">How to set one up</a>
              </p>
              <label htmlFor="connect-input" className="text-sm font-medium">Web app config or connect code</label>
              <textarea
                id="connect-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                placeholder={'const firebaseConfig = { apiKey: "…", authDomain: "…", projectId: "…", appId: "…", messagingSenderId: "…" };'}
                className="w-full rounded-lg border border-edge bg-ink p-2 font-mono text-xs"
              />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                Sign in anonymously before cloud calls (only if your project requires a signed-in user; needs the Anonymous
                provider and authDomain)
              </label>
            </div>
          </details>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-1" />
            {inExtension() ? (
              <span>
                Remember on this device. Otherwise the project is kept only while this ContextLens page is open. A remembered project
                is kept in this extension's own storage, separate from every website.
              </span>
            ) : (
              <span>
                Remember on this device. Otherwise the project is kept in this tab's memory only. All sites under
                nikolareljin.github.io share this browser's storage (same origin), so remember it only in a personal browser.
                Needed for an App Check site key.
              </span>
            )}
          </label>
          <div>
            <button ref={opener} type="button" onClick={check} className="rounded-full bg-bridge px-4 py-1 text-sm font-medium text-white hover:bg-cloud">
              Connect…
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onKeyDown={dialogKeys}
            className="max-w-md rounded-2xl border border-edge bg-panel p-5"
          >
            <h4 id="confirm-title" className="text-lg font-semibold">Use the project “{pending.projectId}”?</h4>
            <ul className="mt-3 list-disc pl-5 text-sm text-slate-300">
              <li>Clean questions (never your sentences in Strict mode) go to Gemini in this project, on its quota and bill.</li>
              <li>
                {remember
                  ? inExtension()
                    ? "The values are remembered in this extension's own storage and sent only to Firebase."
                    : "The values are remembered in this browser's local storage, shared by every site under nikolareljin.github.io, and sent only to Firebase."
                  : inExtension()
                    ? "The values are kept only while this ContextLens page is open and sent only to Firebase."
                    : "The values are kept in this tab's memory only and sent only to Firebase; they are gone when the tab closes."}
              </li>
              {pending.recaptchaSiteKey && (
                <li>App Check with reCAPTCHA Enterprise is turned on; its token is kept in this browser until Disconnect, which reloads the page to delete it.</li>
              )}
              {pending.anonymousAuth && <li>An anonymous sign-in is made before the first cloud call.</li>}
              <li>Disconnect removes them again.</li>
            </ul>
            <div className="mt-4 flex gap-3">
              <button ref={confirmButton} type="button" onClick={confirm} className="rounded-full bg-bridge px-4 py-1 font-medium text-white hover:bg-cloud">
                Connect {pending.projectId}
              </button>
              <button type="button" onClick={() => setPending(null)} className="rounded-full border border-edge px-4 py-1 hover:border-device">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
