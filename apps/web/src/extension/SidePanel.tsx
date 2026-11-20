import logoUrl from "../../../../docs/assets/logo.svg?url";
import { DemoSection } from "../components/DemoSection";
import { DOCS, REPOSITORY } from "../lib/config";

/** The extension's side panel: the live demo of the site, with links that open in a new tab. */
export function SidePanel() {
  const link = "hover:text-device";
  return (
    <div className="flex min-h-screen flex-col gap-6 px-3 py-4">
      <header className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <img src={logoUrl} alt="" width={28} height={28} />
          <span className="text-lg font-bold tracking-tight">ContextLens</span>
        </span>
        <nav className="flex gap-3 text-xs text-slate-300">
          <a className={link} href={`${DOCS}extension/`} target="_blank" rel="noopener noreferrer">Help</a>
          <a className={link} href={`${DOCS}privacy/`} target="_blank" rel="noopener noreferrer">Privacy</a>
          <a className={link} href={REPOSITORY} target="_blank" rel="noopener noreferrer">Source</a>
        </nav>
      </header>
      <div className="lens-gradient h-0.5 w-full rounded" aria-hidden="true" />
      <main>
        <DemoSection />
      </main>
    </div>
  );
}
