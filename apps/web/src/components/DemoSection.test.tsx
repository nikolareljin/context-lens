import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { STORAGE_KEY, type WebProject } from "../cloud/project";
import { CLEAN_QUESTION, FAKE_APP_ID, FAKE_KEY, FakeSource, fakeProject } from "../test/fakes";
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
});

function renderDemo() {
  return render(<DemoSection createModels={createModels} status={status} demoGapMs={0} />);
}

async function check(text: string) {
  fireEvent.change(screen.getByLabelText("Sentence"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
}

describe("connecting a project", () => {
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
    expect(deleteDatabase).toHaveBeenCalledWith("firebase-app-check-database");
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
