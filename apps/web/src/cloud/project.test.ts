import { describe, expect, it } from "vitest";
import { FAKE_APP_ID, FAKE_KEY, fakeProject } from "../test/fakes";
import {
  STORAGE_KEY,
  WEB_CONNECT_PREFIX,
  clearProject,
  fromConnectCode,
  fromWebConfig,
  loadProject,
  parseProject,
  problems,
  saveProject,
} from "./project";

const consoleSnippet = `
// Import the functions you need from the SDKs you need
const firebaseConfig = {
  apiKey: "${FAKE_KEY}",
  authDomain: "demo-springfield.firebaseapp.com",
  projectId: "demo-springfield",
  storageBucket: "demo-springfield.firebasestorage.app",
  messagingSenderId: "5550001",
  appId: "${FAKE_APP_ID}"
};`;

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("reading a project", () => {
  it("reads the console's JavaScript snippet without evaluating it", () => {
    expect(fromWebConfig(consoleSnippet)).toEqual(fakeProject());
  });

  it("reads JSON", () => {
    const json = JSON.stringify({ apiKey: FAKE_KEY, projectId: "demo-springfield", appId: FAKE_APP_ID, recaptchaSiteKey: "6Lc_springfield_site_key_555" });
    const p = fromWebConfig(json)!;
    expect(p.messagingSenderId).toBe("5550001");
    expect(p.authDomain).toBeNull();
    expect(p.recaptchaSiteKey).toBe("6Lc_springfield_site_key_555");
    expect(problems(p).size).toBe(0);
  });

  it("reads a web connect code", () => {
    const code = `${WEB_CONNECT_PREFIX}project=demo-springfield&app=${encodeURIComponent(FAKE_APP_ID)}&key=${FAKE_KEY}&domain=demo-springfield.firebaseapp.com&sender=5550001`;
    expect(fromConnectCode(`  ${code}\n`)).toEqual(fakeProject());
    expect(parseProject(code, true)).toEqual(fakeProject({ anonymousAuth: true }));
  });

  it("reads the anonymous sign-in from the connect code", () => {
    const code = `${WEB_CONNECT_PREFIX}project=demo-springfield&app=${encodeURIComponent(FAKE_APP_ID)}&key=${FAKE_KEY}&domain=demo-springfield.firebaseapp.com&sender=5550001`;
    expect(fromConnectCode(`${code}&anon=1`)).toEqual(fakeProject({ anonymousAuth: true }));
    expect(fromConnectCode(`${code}&anon=0`)).toEqual(fakeProject());
  });

  it("rejects what is not a connect code or misses a value", () => {
    expect(fromConnectCode(`contextlens-connect:1?project=demo-springfield&app=${FAKE_APP_ID}&key=${FAKE_KEY}`)).toBeNull();
    expect(fromConnectCode(`${WEB_CONNECT_PREFIX}project=demo-springfield&key=${FAKE_KEY}`)).toBeNull();
    expect(fromWebConfig('{"projectId": "demo-springfield"}')).toBeNull();
    expect(parseProject("hello")).toBeNull();
  });

  it("names each value that does not validate", () => {
    expect(problems(fakeProject({ apiKey: "AIza-too-short" }))).toEqual(new Set(["API_KEY"]));
    expect(problems(fakeProject({ appId: "1:5550001:android:5ca1ab1e" }))).toEqual(new Set(["APP_ID"]));
    expect(problems(fakeProject({ projectId: "Springfield!" }))).toEqual(new Set(["PROJECT_ID"]));
    expect(problems(fakeProject({ projectId: "placeholder-project" }))).toEqual(new Set(["PROJECT_ID"]));
    expect(problems(fakeProject({ messagingSenderId: "5550002" }))).toEqual(new Set(["SENDER"]));
    expect(problems(fakeProject({ authDomain: "not a host" }))).toEqual(new Set(["AUTH_DOMAIN"]));
    expect(problems(fakeProject({ authDomain: null, anonymousAuth: true }))).toEqual(new Set(["AUTH_DOMAIN"]));
    expect(problems(fakeProject({ recaptchaSiteKey: "<script>" }))).toEqual(new Set(["SITE_KEY"]));
  });
});

describe("keeping a project in this browser", () => {
  it("saves, loads and disconnects", () => {
    const store = memoryStore();
    expect(loadProject(store)).toBeNull();
    expect(saveProject(fakeProject(), store)).toBe(true);
    expect(loadProject(store)).toEqual(fakeProject());
    clearProject(store);
    expect(store.map.size).toBe(0);
    expect(loadProject(store)).toBeNull();
  });

  it("ignores a stored value that is broken or no longer validates", () => {
    const store = memoryStore();
    store.setItem(STORAGE_KEY, "{not json");
    expect(loadProject(store)).toBeNull();
    store.setItem(STORAGE_KEY, JSON.stringify({ ...fakeProject(), apiKey: "x" }));
    expect(loadProject(store)).toBeNull();
    expect(store.map.has(STORAGE_KEY)).toBe(false);
    store.setItem(STORAGE_KEY, "{not json");
    expect(loadProject(store)).toBeNull();
    expect(store.map.has(STORAGE_KEY)).toBe(false);
  });

  it("works without storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadProject(broken)).toBeNull();
    expect(saveProject(fakeProject(), broken)).toBe(false);
    expect(() => clearProject(broken)).not.toThrow();
  });
});
