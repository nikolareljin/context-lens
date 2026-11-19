import { describe, expect, it } from "vitest";
import { GatekeeperParser } from "./gatekeeperParser";

describe("GatekeeperParser", () => {
  it("takes the first balanced object", () => {
    const r = GatekeeperParser.parse('{"claim": true, "query": "Is {x} a set?"} and {"claim": false}');
    expect(r?.sanitizedResolvedQuery).toBe("Is {x} a set?");
    expect(GatekeeperParser.parse('{"claim": true, "query": "open')).toBeNull();
  });

  it("reads fenced and aliased JSON", () => {
    const r = GatekeeperParser.parse(
      'Here you go:\n```json\n{"claim": true, "query": "  Did Springfield raise\n bus fares in October 2026? ", "refs": ["here -> Springfield", ""], "reason": ""}\n```',
    );
    expect(r).toEqual({
      hasVerifiableClaim: true,
      sanitizedResolvedQuery: "Did Springfield raise bus fares in October 2026?",
      resolvedReferences: ["here -> Springfield"],
      filterReason: null,
    });

    const spec = GatekeeperParser.parse('{"hasVerifiableClaim": "false", "sanitizedResolvedQuery": "x", "filterReason": "small talk"}');
    expect(spec).toEqual({ hasVerifiableClaim: false, sanitizedResolvedQuery: "", resolvedReferences: [], filterReason: "small talk" });

    // prompt v2: no claim flag; a "world" sentence is a claim, any other kind is the reason it is not
    const v2 = GatekeeperParser.parse('{"kind": "request", "query": "", "refs": []}');
    expect(v2).toEqual({ hasVerifiableClaim: false, sanitizedResolvedQuery: "", resolvedReferences: [], filterReason: "request" });
    const world = GatekeeperParser.parse('{"kind": " World ", "query": "Is Mount Everest in Peru?", "refs": []}');
    expect(world).toEqual({ hasVerifiableClaim: true, sanitizedResolvedQuery: "Is Mount Everest in Peru?", resolvedReferences: [], filterReason: null });
    expect(GatekeeperParser.parse('{"kind": "world", "query": ""}')).toBeNull();
    expect(GatekeeperParser.parse('{"query": "x"}')).toBeNull();
    // the kind decides over a stray flag; an empty v1 reason does not hide it
    expect(GatekeeperParser.parse('{"kind": "world", "claim": false, "query": "Are bats blind?"}')?.hasVerifiableClaim).toBe(true);
    expect(GatekeeperParser.parse('{"kind": " Request ", "query": "", "reason": ""}')?.filterReason).toBe("request");
    expect(GatekeeperParser.parse('{"kind": "World.", "query": "Is it?"}')?.hasVerifiableClaim).toBe(true);
    expect(GatekeeperParser.parse('{"kind": "world fact", "query": "Is it?"}')?.hasVerifiableClaim).toBe(true);
    // the template's list echoed back, or a kind it does not know, is not a valid reply
    expect(GatekeeperParser.parse('{"kind": "world, small talk, request, opinion or personal", "query": "x"}')).toBeNull();
    expect(GatekeeperParser.parse('{"kind": "joke", "query": ""}')).toBeNull();
  });

  it("rejects invalid replies", () => {
    expect(GatekeeperParser.parse(null)).toBeNull();
    expect(GatekeeperParser.parse("I think this is a claim.")).toBeNull();
    expect(GatekeeperParser.parse('{"claim": true, "query": "  "}')).toBeNull();
    expect(GatekeeperParser.parse('{"query": "no flag"}')).toBeNull();
    expect(GatekeeperParser.parse('{"claim": maybe}')).toBeNull();
    const long = GatekeeperParser.parse(`{"claim": true, "query": "${"a".repeat(500)}"}`);
    expect(long?.sanitizedResolvedQuery.length).toBe(GatekeeperParser.QUERY_MAX);
  });

  it("reads primitives the way the Android JSON reader does", () => {
    // yes/no words, a null flag that hides its alias, numbers as written
    expect(GatekeeperParser.parse('{"claim": " Yes ", "query": "q"}')?.hasVerifiableClaim).toBe(true);
    expect(GatekeeperParser.parse('{"claim": null, "hasVerifiableClaim": true, "query": "q"}')).toBeNull();
    expect(GatekeeperParser.parse('{"claim": true, "query": 7.50}')?.sanitizedResolvedQuery).toBe("7.50");
    expect(GatekeeperParser.parse('{"claim": true, "query": "q", "refs": [1.0, null, {"a": 1}, "x"]}')?.resolvedReferences).toEqual(["1.0", "x"]);
    expect(GatekeeperParser.parse('{"claim": true, "query": ["q"]}')).toBeNull();
    const refs = Array.from({ length: 8 }, (_, i) => `"${i}${"r".repeat(100)}"`).join(",");
    const many = GatekeeperParser.parse(`{"claim": true, "query": "q", "refs": [${refs}]}`);
    expect(many?.resolvedReferences.length).toBe(GatekeeperParser.REFS_MAX);
    expect(many?.resolvedReferences[0].length).toBe(GatekeeperParser.REF_MAX);
    expect(GatekeeperParser.firstObject('x {"a": "}\\"{"} y')).toBe('{"a": "}\\"{"}');
  });

  it("collapses mixed Unicode spaces in the question, as the phone does", () => {
    // made-up test card number with a no-break space next to a space
    const r = GatekeeperParser.parse('{"kind":"world","query":"Is card 4111\u00a0 1111 1111 1111 stolen?"}');
    expect(r?.sanitizedResolvedQuery).toBe("Is card 4111 1111 1111 1111 stolen?");
  });

  it("accepts unquoted values, as the app's JSON reader does", () => {
    expect(GatekeeperParser.parse('{"claim": True, "query": "Did the bus fare rise in 2026?"}')?.sanitizedResolvedQuery).toBe("Did the bus fare rise in 2026?");
    expect(GatekeeperParser.parse('{"kind": world, "query": "Did the bus fare rise in 2026?"}')?.hasVerifiableClaim).toBe(true);
    expect(GatekeeperParser.parse('{"claim": False, "query": "x"}')?.hasVerifiableClaim).toBe(false);
  });

  it("rejects what the app's reader rejects and keeps its token rules", () => {
    expect(GatekeeperParser.parse('{kind: world, query: "Did the bus fare rise in 2026?"}')).toBeNull();
    expect(GatekeeperParser.parse('{"kind":"world","query":who\\won}')).toBeNull();
    expect(GatekeeperParser.parse('{"claim":true,"query":"q","refs":[01]}')?.sanitizedResolvedQuery).toBe("q");
    expect(GatekeeperParser.parse('{"kind":small\u00a0talk,"query":"q"}')?.hasVerifiableClaim).toBe(false);
  });
});
