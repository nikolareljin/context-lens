import logoUrl from "../../../docs/assets/logo.svg?url";
import heroUrl from "../../../docs/assets/hero.svg?url";
import { DownloadStrip } from "./components/DownloadStrip";
import { config, DOCS, REPOSITORY } from "./lib/config";

const STAGES = [
  { n: 1, title: "Local speech", where: "on this device", text: "The sentence and its references (“here”, “they”, “last month”) stay here." },
  { n: 2, title: "Resolved question", where: "Gemini Nano, on device", text: "One self-contained question, without your names, numbers or places." },
  { n: 3, title: "Grounded fact card", where: "cloud Gemini + Google Search", text: "A verdict, two neutral sentences and the sources." },
];

export default function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <a href="/context-lens/" className="flex items-center gap-3">
          <img src={logoUrl} alt="" width={44} height={44} />
          <span className="text-2xl font-bold tracking-tight">ContextLens</span>
        </a>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-300">
          <a className="hover:text-device" href={`${DOCS}download/`}>Download</a>
          <a className="hover:text-device" href={DOCS}>Docs</a>
          <a className="hover:text-device" href={`${DOCS}setup/`}>Setup</a>
          <a className="hover:text-device" href={`${DOCS}privacy/`}>Privacy</a>
          <a className="hover:text-device" href={REPOSITORY}>Source</a>
        </nav>
      </header>
      <div className="lens-gradient h-0.5 w-full rounded" aria-hidden="true" />

      <main className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <p className="flex flex-wrap gap-2 text-xs font-medium">
            {["Android", "Chrome web", "Firebase AI Logic", "Gemini Nano on device", "Grounding with Google Search"].map((b) => (
              <span key={b} className="rounded-full border border-bridge/50 bg-bridge/10 px-3 py-1">{b}</span>
            ))}
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Private, grounded fact checks for real conversations.</h1>
          <p className="max-w-3xl text-lg text-slate-300">
            The device decides which sentences are checkable claims and rewrites them without personal data. Only that
            clean question goes to the cloud, and every result shows where it actually ran.
          </p>
          <img src={heroUrl} alt="The three stages: local speech, a resolved question on the device, a grounded fact card from the cloud" className="w-full rounded-2xl" />
        </section>

        <section aria-labelledby="stages" className="grid gap-4 sm:grid-cols-3">
          <h2 id="stages" className="sr-only">How it works</h2>
          {STAGES.map((s) => (
            <article key={s.n} className="rounded-2xl border border-edge bg-slate-950/70 p-5">
              <p className="text-xs font-bold tracking-widest text-device">{s.n} · {s.title.toUpperCase()}</p>
              <p className="mt-1 text-sm text-slate-400">{s.where}</p>
              <p className="mt-3">{s.text}</p>
            </article>
          ))}
        </section>

        <section aria-labelledby="web-demo" className="rounded-2xl border border-edge bg-panel/60 p-6">
          <h2 id="web-demo" className="text-xl font-semibold">Try it in Chrome</h2>
          {config.firebase ? (
            <p className="mt-2 text-slate-300">The live demo is being connected; it runs Gemini Nano inside Chrome where available.</p>
          ) : (
            <p className="mt-2 text-slate-300">
              The live demo needs this site's Firebase configuration, which this build does not have. The Android app
              below works on its own.
            </p>
          )}
        </section>

        <DownloadStrip />
      </main>

      <footer className="mt-auto border-t border-edge pt-6 text-sm text-slate-400">
        Apache License 2.0 · Created by Nik Reljin · <a className="hover:text-device" href={REPOSITORY}>github.com/nikolareljin/context-lens</a>
      </footer>
    </div>
  );
}
