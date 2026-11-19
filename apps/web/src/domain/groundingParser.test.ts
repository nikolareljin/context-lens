import { describe, expect, it } from "vitest";
import { GroundingParser } from "./groundingParser";

describe("GroundingParser", () => {
  it("keeps https sources once with a title", () => {
    const g = GroundingParser.parse(
      [
        { uri: "https://example.org/fares", title: "Fare change", domain: "example.org" },
        { uri: "https://example.org/fares", title: "Duplicate", domain: "example.org" },
        { uri: "https://news.example.com/a", title: null, domain: null },
        { uri: "http://insecure.example.net/", title: "Insecure", domain: null },
        { uri: null, title: "No link", domain: null },
      ],
      ["springfield bus fares", " "],
      "<div>chip</div>",
    );
    expect(g.citations).toEqual([
      { title: "Fare change", uri: "https://example.org/fares", domain: "example.org" },
      { title: "news.example.com", uri: "https://news.example.com/a", domain: "news.example.com" },
    ]);
    expect(g.searchQueries).toEqual(["springfield bus fares"]);
    expect(g.searchEntryPointHtml).toBe("<div>chip</div>");
  });

  it("caps sources and tolerates empty metadata", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ uri: `https://s${i + 1}.example.org/`, title: `S${i + 1}`, domain: `s${i + 1}.example.org` }));
    expect(GroundingParser.parse(many, [], null).citations.length).toBe(GroundingParser.CITATIONS_MAX);
    const empty = GroundingParser.parse([], [], " ");
    expect(empty.citations).toEqual([]);
    expect(empty.searchEntryPointHtml).toBeNull();
  });

  it("reads the host as java.net.URI does", () => {
    const domain = (uri: string) => GroundingParser.parse([{ uri, title: null, domain: null }], [], null).citations[0]?.domain;
    expect(domain("https://user@News.Example.com:8443/a?b#c")).toBe("News.Example.com");
    expect(domain("https://bad_host.example.com/")).toBe("");
    expect(domain("https://example.com/a b")).toBe("");
    expect(domain("https://192.0.2.1/x")).toBe("192.0.2.1");
  });

  it("reads hosts the way java.net.URI does for IPv4 and IPv6 literals", () => {
    const hostOf = (uri: string) => GroundingParser.parse([{ uri, title: null, domain: null }], [], null).citations[0]?.domain ?? "";
    expect(hostOf("https://001.2.3.4/")).toBe("001.2.3.4");
    expect(hostOf("https://[::1]/")).toBe("[::1]");
    expect(hostOf("https://[zz]/")).toBe("");
    expect(hostOf("https://[1:2:3:4:5:6:7:8:9]/")).toBe("");
  });
});
