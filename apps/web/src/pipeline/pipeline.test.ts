import { describe, expect, it } from "vitest";
import { CLEAN_QUESTION, FakeModel, FakeSource, GATE_CLAIM, held } from "../test/fakes";
import { DemoScript } from "./demoScript";
import { totals } from "./ledger";
import { GATE_TIMEOUT_MS, WebPipeline, isCloudLimit, redact, searchUrl } from "./pipeline";

function pipeline(source: FakeSource, cloud = true, online = true) {
  const p = new WebPipeline({ models: source, cloudProject: () => cloud, online: () => online });
  p.setSession({ today: "2026-11-19", region: DemoScript.region, pinnedTopic: DemoScript.topic });
  return p;
}

async function run(p: WebPipeline, text: string) {
  const id = p.submit(text);
  await p.idle();
  return p.getSnapshot().checks.find((c) => c.id === id)!;
}

describe("WebPipeline", () => {
  it("drops small talk with the local rules: no model, nothing sent", async () => {
    const source = new FakeSource();
    const p = pipeline(source);
    const check = await run(p, "Thanks, that was great.");
    expect(check.stage).toBe("FILTERED");
    expect(source.asked).toEqual([]);
    expect(p.ledger.entries).toEqual([]);
  });

  it("Strict never calls the cloud gatekeeper, even with a project connected", async () => {
    const source = new FakeSource();
    const p = pipeline(source);
    p.setMode("STRICT");
    const check = await run(p, "They raised it again here last month.");
    expect(source.asked).toEqual(["STRICT"]);
    expect(source.cloudGate.prompts).toEqual([]);
    expect(check.stage).toBe("DONE");
    expect(check.gate?.source).toBe("ON_DEVICE");
    // only the clean question left the browser
    expect(p.ledger.entries.map((e) => e.kind)).toEqual(["CLEAN_QUERY"]);
    expect(p.ledger.entries[0].text).toContain(CLEAN_QUESTION);
    expect(p.ledger.entries[0].text).not.toContain("They raised it again");
    expect(totals(p.ledger.entries).rawBytes).toBe(0);
  });

  it("Strict without the on-device model checks nothing and sends nothing", async () => {
    const source = new FakeSource();
    source.ready = false;
    const p = pipeline(source);
    const check = await run(p, "They raised it again here last month.");
    expect(check.stage).toBe("NEEDS_MODEL");
    expect(source.asked).toEqual([]);
    expect(p.ledger.entries).toEqual([]);
  });

  it("Strict records and drops a gatekeeper reply that did not come from the device", async () => {
    const source = new FakeSource();
    source.onDevice = new FakeModel("on-device", () => ({ text: "{}", source: "IN_CLOUD" }));
    const p = pipeline(source);
    const check = await run(p, "They raised it again here last month.");
    expect(check.stage).toBe("FAILED");
    expect(check.sentToCloud).toBe(true);
    expect(p.ledger.entries.map((e) => e.kind)).toEqual(["RAW_TEXT"]);
    expect(source.verifier.prompts).toEqual([]);
  });

  it("stops a question with personal data before any cloud call", async () => {
    const source = new FakeSource();
    source.onDevice = new FakeModel("on-device", () => ({
      text: JSON.stringify({ kind: "world", query: "Did Mark at 555-0134 see bus fares rise?", refs: [] }),
      source: "ON_DEVICE",
    }));
    const p = pipeline(source);
    const check = await run(p, "Call Mark at 555-0134 about the bus fare numbers.");
    expect(check.stage).toBe("WITHHELD");
    expect(check.withheld).toContain("PHONE");
    expect(source.verifier.prompts).toEqual([]);
    expect(p.ledger.entries).toEqual([]);
  });

  it("without a project ends at NO_PROJECT, with Balanced asked for", async () => {
    const source = new FakeSource();
    const p = pipeline(source, false);
    p.setMode("BALANCED");
    const check = await run(p, "They raised it again here last month.");
    expect(source.asked).toEqual(["STRICT"]);
    expect(check.stage).toBe("NO_PROJECT");
    expect(check.gate?.result.sanitizedResolvedQuery).toBe(CLEAN_QUESTION);
    expect(source.verifier.prompts).toEqual([]);
    expect(p.ledger.entries).toEqual([]);
  });

  it("Balanced records a cloud gatekeeper call word for word", async () => {
    const source = new FakeSource();
    source.ready = false;
    const p = pipeline(source);
    p.setMode("BALANCED");
    const check = await run(p, "They raised it again here last month.");
    expect(source.asked).toEqual(["BALANCED"]);
    expect(check.sentToCloud).toBe(true);
    expect(check.stage).toBe("DONE");
    const raw = p.ledger.entries.find((e) => e.kind === "RAW_TEXT")!;
    expect(raw.text).toBe(source.cloudGate.prompts[0]);
    expect(raw.bytes).toBe(new TextEncoder().encode(raw.text).length);
    expect(raw.source).toBe("IN_CLOUD");
  });

  it("builds a grounded card with the verdict rules", async () => {
    const p = pipeline(new FakeSource());
    const check = await run(p, "They raised it again here last month.");
    expect(check.card?.verdict).toBe("VERIFIED");
    expect(check.card?.summary).toBe("The fare table lists the new fares. They start in October.");
    expect(check.card?.grounding.citations).toHaveLength(1);
    expect(p.getSnapshot().counts.checked).toBe(1);
  });

  it("offline: the question is not sent", async () => {
    const source = new FakeSource();
    const p = pipeline(source, true, false);
    expect((await run(p, "They raised it again here last month.")).stage).toBe("OFFLINE");
    expect(p.ledger.entries).toEqual([]);
  });

  it("quota refusals end at CLOUD_UNAVAILABLE", async () => {
    const source = new FakeSource();
    source.verifier = new FakeModel("v", () => {
      throw new Error("429 RESOURCE_EXHAUSTED: quota");
    });
    const p = pipeline(source);
    const check = await run(p, "They raised it again here last month.");
    expect(check.stage).toBe("CLOUD_UNAVAILABLE");
    expect(p.ledger.entries[0].source).toBeNull();
  });

  it("Clear forgets the cards and keeps the ledger", async () => {
    const p = pipeline(new FakeSource());
    await run(p, "They raised it again here last month.");
    p.clear();
    expect(p.getSnapshot().checks).toEqual([]);
    expect(p.ledger.entries).toHaveLength(1);
  });

  it("gives the gatekeeper the sentences before this one", async () => {
    const source = new FakeSource();
    const p = pipeline(source);
    p.submit("The city council met on Tuesday about the buses.");
    await run(p, "They raised it again here last month.");
    expect(source.onDevice.prompts[1]).toContain("- The city council met on Tuesday about the buses.");
  });
});

describe("stopping", () => {
  function holding(models: FakeSource, mode: "STRICT" | "BALANCED" = "STRICT") {
    const gate = held({ text: GATE_CLAIM, source: mode === "STRICT" ? "ON_DEVICE" : "IN_CLOUD" });
    const model = mode === "STRICT" ? models.onDevice : models.cloudGate;
    model.generate = async (prompt, signal) => {
      model.prompts.push(prompt);
      model.signals.push(signal);
      return gate.wait();
    };
    return { gate, model };
  }

  it("Clear aborts the sentence in progress and drops the queued ones", async () => {
    const models = new FakeSource();
    const { gate, model } = holding(models);
    const p = pipeline(models);
    p.submit("They raised it again here last month.");
    p.submit("The bus fare went up twice this year.");
    p.submit("The city council doubled the parking fines.");
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(model.prompts).toHaveLength(1);
    p.clear();
    expect(model.signals[0]?.aborted).toBe(true);
    gate.release();
    await p.idle();
    expect(model.prompts).toHaveLength(1);
    expect(models.verifier.prompts).toEqual([]);
    expect(p.getSnapshot().checks).toEqual([]);
    expect(p.ledger.entries).toEqual([]);
    // new sentences after Clear run normally
    model.generate = async () => ({ text: GATE_CLAIM, source: "ON_DEVICE" });
    expect((await run(p, "They raised it again here last month.")).stage).toBe("DONE");
  });

  it("close() stops everything for good", async () => {
    const models = new FakeSource();
    const { gate, model } = holding(models);
    const p = pipeline(models);
    p.submit("They raised it again here last month.");
    p.submit("The bus fare went up twice this year.");
    await new Promise((r) => setTimeout(r, 0));
    p.close();
    expect(model.signals[0]?.aborted).toBe(true);
    gate.release();
    await p.idle();
    expect(model.prompts).toHaveLength(1);
    expect(models.verifier.prompts).toEqual([]);
    expect(p.submit("Anything else at all here?")).toBeNull();
  });

  it("records a Balanced call stopped midway as maybe sent, and goes no further", async () => {
    const models = new FakeSource();
    models.ready = false;
    const { gate } = holding(models, "BALANCED");
    const p = pipeline(models);
    p.setMode("BALANCED");
    p.submit("They raised it again here last month.");
    await new Promise((r) => setTimeout(r, 0));
    p.close();
    gate.release();
    await p.idle();
    expect(p.ledger.entries.map((e) => [e.kind, e.outcome])).toEqual([["RAW_TEXT", "cancelled; may have been sent"]]);
    expect(models.verifier.prompts).toEqual([]);
  });

  it("aborts a request that times out", async () => {
    const models = new FakeSource();
    const { model } = holding(models);
    const p = new WebPipeline({ models, cloudProject: () => true, gateTimeoutMs: 5 });
    const check = await run(p, "They raised it again here last month.");
    expect(check.stage).toBe("FAILED");
    expect(check.note).toBe("gatekeeper: timed out");
    expect(model.signals[0]?.aborted).toBe(true);
  });

  it("a Strict gatekeeper that times out stayed on the device: nothing may have been sent", async () => {
    const models = new FakeSource();
    holding(models);
    const p = new WebPipeline({ models, cloudProject: () => true, gateTimeoutMs: 5 });
    const check = await run(p, "They raised it again here last month.");
    expect(check.note).toBe("gatekeeper: timed out");
    expect(check.note).not.toContain("may have been sent");
    expect(p.ledger.entries).toEqual([]);
  });

  it("a verifier that times out may have been sent, and the ledger says so", async () => {
    const models = new FakeSource();
    models.verifier.generate = () => new Promise(() => {});
    const p = new WebPipeline({ models, cloudProject: () => true, verifyTimeoutMs: 5 });
    await run(p, "They raised it again here last month.");
    expect(p.ledger.entries[0].outcome).toBe("timed out; may have been sent");
  });

  it("waits as long as Android for the gatekeeper", () => {
    expect(GATE_TIMEOUT_MS).toBe(15_000);
  });
});

describe("helpers", () => {
  it("builds a search link and recognizes limits", () => {
    expect(searchUrl("Is it 5 & 6?")).toBe("https://www.google.com/search?q=Is%20it%205%20%26%206%3F");
    expect(isCloudLimit("FetchError: 429 Too Many Requests")).toBe(true);
    expect(isCloudLimit("TypeError: failed")).toBe(false);
    expect(redact("see https://example.com/x?key=1 for 1:5550001:web:ab and 1234567")).toBe("see <url> for <app> and <number>");
  });
});
