import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { STORAGE_KEY, type WebProject } from "../cloud/project";
import { CLEAN_QUESTION, FAKE_APP_ID, FAKE_KEY, FakeSource, GATE_CLAIM, fakeProject, held } from "../test/fakes";
import { DemoSection, type DemoModels } from "./DemoSection";

const snippet = `const firebaseConfig = { apiKey: "${FAKE_KEY}", authDomain: "demo-springfield.firebaseapp.com", projectId: "demo-springfield", messagingSenderId: "5550001", appId: "${FAKE_APP_ID}" };`;

let sources: { project: WebProject | null; source: FakeSource }[] = [];
const createModels = (project: WebProject | null): DemoModels => {
  const source = new FakeSource();
  sources.push({ project, source });
  return source;
};
const status = async () => "available" as const;
const fetchSpy = vi.fn();
const reload = vi.fn();

beforeEach(() => {
  sources = [];
  localStorage.clear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchSpy.mockClear();
  reload.mockClear();
});

function renderDemo() {
  return render(<DemoSection createModels={createModels} status={status} demoGapMs={0} reload={reload} />);
}

async function check(text: string) {
  fireEvent.change(screen.getByLabelText("Sentence"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
}

describe("connecting a project", () => {
  it("Disconnect of a remembered App Check project cleans up even without a cloud call in this tab", () => {
    const deleteDatabase = vi.fn(() => ({}) as IDBOpenDBRequest);
    vi.stubGlobal("indexedDB", { open: vi.fn(), deleteDatabase });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fakeProject({ recaptchaSiteKey: "6Lc_springfield_site_key_555" })));
    localStorage.setItem("_grecaptcha", "springfield-recaptcha-state");
    renderDemo();
    expect(screen.getByText("demo-springfield")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("_grecaptcha")).toBeNull();
    expect(deleteDatabase.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["firebase-app-check-database", "firebase-heartbeat-database"]);
    // App Check did not run in this tab, so nothing holds the database open: no reload needed
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses a site key when the project cannot be remembered", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderDemo();
    const withKey = snippet.replace("};", ', recaptchaSiteKey: "6Lc_springfield_site_key_555" };');
    fireEvent.change(screen.getByLabelText("Web app config or connect code"), { target: { value: withKey } });
    fireEvent.click(screen.getByLabelText(/Remember on this device/));
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect demo-springfield" }));
    expect(screen.getByRole("alert").textContent).toContain("can't be remembered and App Check stays off");
    expect(screen.getByText(/Not connected/)).toBeTruthy();
    expect(sources.at(-1)?.project).toBeNull();
  });

  it("asks for confirmation naming the project, keeps it in memory only, and disconnects", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open, deleteDatabase: vi.fn() });
    renderDemo();
    fireEvent.change(screen.getByLabelText("Web app config or connect code"), { target: { value: snippet } });
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Use the project “demo-springfield”?")).toBeTruthy();
    expect(within(dialog).getByText(/kept in this tab's memory only/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect demo-springfield" }));
    expect(screen.getByText("demo-springfield")).toBeTruthy();
    expect(screen.getByText(/gone when the tab closes/)).toBeTruthy();
    // a new model source (a fresh Firebase app) for the new project
    expect(sources.at(-1)?.project?.projectId).toBe("demo-springfield");
    await check("They raised it again here last month.");
    await screen.findByText("✓ Verified");
    // nothing of the project in any browser storage without opting in
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByText(/Not connected/)).toBeTruthy();
    expect(sources.at(-1)?.project).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("remembers the project only when asked, and Disconnect forgets it", () => {
    const deleteDatabase = vi.fn();
    vi.stubGlobal("indexedDB", { open: vi.fn(), deleteDatabase });
    renderDemo();
    fireEvent.change(screen.getByLabelText("Web app config or connect code"), { target: { value: snippet } });
    fireEvent.click(screen.getByLabelText(/Remember on this device/));
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    expect(screen.getByText(/remembered in this browser's local storage, shared by every site under nikolareljin.github.io/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect demo-springfield" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(fakeProject());
    expect(screen.getByText(/Remembered on this device/)).toBeTruthy();
    cleanup();
    // a new visit finds it
    renderDemo();
    expect(screen.getByText("demo-springfield")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // no App Check was used, so there is nothing to clean up and no reload
    expect(reload).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("allows an App Check site key only with Remember, and reloads on Disconnect to delete its token", () => {
    renderDemo();
    const withKey = snippet.replace("};", ', recaptchaSiteKey: "6Lc_springfield_site_key_555" };');
    fireEvent.change(screen.getByLabelText("Web app config or connect code"), { target: { value: withKey } });
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    expect(screen.getByRole("alert").textContent).toContain("needs “Remember on this device”");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Remember on this device/));
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    expect(screen.getByText(/its token is kept in this browser until Disconnect/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect demo-springfield" }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).recaptchaSiteKey).toBe("6Lc_springfield_site_key_555");
    sources.at(-1)!.source.usedAppCheck = true;
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog, closes it with Escape and returns focus", () => {
    renderDemo();
    fireEvent.change(screen.getByLabelText("Web app config or connect code"), { target: { value: snippet } });
    const opener = screen.getByRole("button", { name: "Connect…" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Connect demo-springfield" }));
    // Tab from the last button wraps to the first
    within(dialog).getByRole("button", { name: "Cancel" }).focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Connect demo-springfield" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("stores nothing when the visitor cancels", () => {
    renderDemo();
    fireEvent.change(screen.getByLabelText("Web app config or connect code"), { target: { value: snippet } });
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("says what is wrong with a pasted value", () => {
    renderDemo();
    fireEvent.change(screen.getByLabelText("Web app config or connect code"), { target: { value: snippet.replace(FAKE_KEY, "AIza-short") } });
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    expect(screen.getByRole("alert").textContent).toContain("apiKey is not a Firebase web API key");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("without a project", () => {
  it("keeps Balanced off and ends a claim at NO_PROJECT with a search link; nothing is sent", async () => {
    renderDemo();
    expect((screen.getByRole("radio", { name: /Balanced/ }) as HTMLInputElement).disabled).toBe(true);
    await check("They raised it again here last month.");
    const link = await screen.findByRole("link", { name: "Search this in your browser" });
    expect(link.getAttribute("href")).toBe(`https://www.google.com/search?q=${encodeURIComponent(CLEAN_QUESTION)}`);
    expect(screen.getByText(/no Firebase project is connected/)).toBeTruthy();
    const { source } = sources.at(-1)!;
    expect(source.asked).toEqual(["STRICT"]);
    expect(source.verifier.prompts).toEqual([]);
    expect(screen.getByText("No request has left this browser.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs the scripted Springfield conversation", async () => {
    renderDemo();
    fireEvent.click(screen.getByRole("button", { name: "Run demo" }));
    await waitFor(() => expect(screen.getAllByText("Demo input")).toHaveLength(6));
    expect((screen.getByLabelText("Area (nearest city)") as HTMLInputElement).value).toBe("Springfield");
    expect(screen.getAllByText(/local rules: small talk/)).toHaveLength(4);
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Search this in your browser" }).length).toBeGreaterThan(0));
  });
});

describe("with a project", () => {
  beforeEach(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(fakeProject())));

  it("renders a grounded card from the model and lists the request in the ledger", async () => {
    renderDemo();
    await check("They raised it again here last month.");
    expect(await screen.findByText("✓ Verified")).toBeTruthy();
    expect(screen.getByText("Clean question · written on the device")).toBeTruthy();
    expect(screen.getAllByTestId("source-pill").map((p) => p.textContent)).toEqual(["ON_DEVICE", "IN_CLOUD"]);
    expect(screen.getByRole("link", { name: "Fare table (transit.example.com)" }).getAttribute("href")).toBe("https://transit.example.com/fares");
    const chip = screen.getByTitle("Google Search Suggestions") as HTMLIFrameElement;
    expect(chip.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(chip.getAttribute("srcdoc")).toContain("springfield bus fare");
    expect(chip.getAttribute("srcdoc")).not.toContain("<script");
    const entry = screen.getByTestId("ledger-entry");
    expect(entry.textContent).toContain("CLEAN_QUERY");
    expect(entry.textContent).toContain(CLEAN_QUESTION);
    expect(entry.textContent).not.toContain("They raised it again");
    expect(screen.getByTestId("ledger-totals").textContent).toContain("Raw text sent: 0 B");
  });

  it("withholds a question with personal data before any cloud call", async () => {
    renderDemo();
    const { source } = sources.at(-1)!;
    source.onDevice.generate = async () => ({
      text: JSON.stringify({ kind: "world", query: "Did Mark at 555-0134 see bus fares rise?", refs: [] }),
      source: "ON_DEVICE",
    });
    await check("Call Mark at 555-0134 about the bus fare numbers.");
    expect(await screen.findByText(/Question withheld: it still contained personal data/)).toBeTruthy();
    expect(source.verifier.prompts).toEqual([]);
    expect(screen.getByText("No request has left this browser.")).toBeTruthy();
  });

  it("uses the cloud gatekeeper only in Balanced, which the visitor turns on", async () => {
    renderDemo();
    const { source } = sources.at(-1)!;
    await check("They raised it again here last month.");
    await screen.findByText("✓ Verified");
    expect(source.asked).toEqual(["STRICT"]);
    fireEvent.click(screen.getByRole("radio", { name: /Balanced/ }));
    await check("The bus fare went up twice this year.");
    await waitFor(() => expect(source.asked).toEqual(["STRICT", "BALANCED"]));
  });
});

describe("stopping work in progress", () => {
  beforeEach(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(fakeProject())));

  /** The on-device gatekeeper of the newest model set, held until released. */
  function holdGate() {
    const models = sources.at(-1)!.source;
    const gate = held({ text: GATE_CLAIM, source: "ON_DEVICE" });
    models.onDevice.generate = async (_prompt, signal) => {
      models.onDevice.signals.push(signal);
      return gate.wait();
    };
    return { models, gate };
  }

  it("Disconnect during the gatekeeper: nothing reaches the old project", async () => {
    renderDemo();
    const { models, gate } = holdGate();
    await check("They raised it again here last month.");
    await waitFor(() => expect(models.onDevice.signals).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(models.onDevice.signals[0]?.aborted).toBe(true);
    expect(models.disposed).toBe(true);
    gate.release();
    await new Promise((r) => setTimeout(r, 10));
    expect(models.verifier.prompts).toEqual([]);
    expect(screen.getByText("No request has left this browser.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Clear drops queued sentences and aborts the one in progress", async () => {
    renderDemo();
    const { models, gate } = holdGate();
    await check("They raised it again here last month.");
    await check("The bus fare went up twice this year.");
    await check("The city council doubled the parking fines.");
    await waitFor(() => expect(models.onDevice.signals).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(models.onDevice.signals[0]?.aborted).toBe(true);
    gate.release();
    await new Promise((r) => setTimeout(r, 10));
    expect(models.onDevice.signals).toHaveLength(1);
    expect(models.verifier.prompts).toEqual([]);
    expect(screen.getByText("No sentences yet.")).toBeTruthy();
  });

  it("announces the latest stage in one short status line", async () => {
    renderDemo();
    await check("They raised it again here last month.");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Latest sentence: checked."));
  });
});
