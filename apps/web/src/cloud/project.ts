/**
 * The Firebase project the cloud step runs on: the visitor's own, pasted on the page.
 * The site is built without any project, so nothing reaches the cloud until a visitor
 * connects one. The values are kept in the tab's memory, and in this browser's
 * localStorage only when the visitor ticks "Remember on this device"; they go only to
 * Firebase itself, through the SDK. None of them is a secret, but they decide whose quota
 * and bill the cloud step uses.
 */
export interface WebProject {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string | null;
  messagingSenderId: string;
  /**
   * reCAPTCHA Enterprise site key for App Check; null leaves App Check off. Allowed only for
   * a remembered project: the App Check SDK keeps its token in IndexedDB.
   */
  recaptchaSiteKey: string | null;
  /** Sign in anonymously before cloud calls (needs the Anonymous provider in the project). */
  anonymousAuth: boolean;
}

export type ProjectProblem = "PROJECT_ID" | "APP_ID" | "API_KEY" | "AUTH_DOMAIN" | "SENDER" | "SITE_KEY";

// As on Android (CloudProject.kt), with the web app id.
const projectIdPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const appIdPattern = /^1:\d+:web:[0-9a-f]+$/;
const apiKeyPattern = /^AIza[0-9A-Za-z_-]{35}$/;
const hostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const senderPattern = /^\d+$/;
const siteKeyPattern = /^[0-9A-Za-z_-]{20,100}$/;

/** The project id the Android placeholder build carries; never a real project. */
const PLACEHOLDER_PROJECT_ID = "placeholder-project";

/** The project number: the second part of the app id. */
export function projectNumber(appId: string): string {
  return appId.split(":")[1] ?? "";
}

/** Fields that don't look like a Firebase web app's values; empty when all do. */
export function problems(project: WebProject): Set<ProjectProblem> {
  const out = new Set<ProjectProblem>();
  if (!projectIdPattern.test(project.projectId) || project.projectId === PLACEHOLDER_PROJECT_ID) out.add("PROJECT_ID");
  if (!appIdPattern.test(project.appId)) out.add("APP_ID");
  if (!apiKeyPattern.test(project.apiKey)) out.add("API_KEY");
  if (project.authDomain !== null && !hostPattern.test(project.authDomain)) out.add("AUTH_DOMAIN");
  if (!senderPattern.test(project.messagingSenderId) || project.messagingSenderId !== projectNumber(project.appId)) {
    out.add("SENDER");
  }
  if (project.recaptchaSiteKey !== null && !siteKeyPattern.test(project.recaptchaSiteKey)) out.add("SITE_KEY");
  if (project.anonymousAuth && project.authDomain === null) out.add("AUTH_DOMAIN");
  return out;
}

export const PROBLEM_TEXT: Record<ProjectProblem, string> = {
  PROJECT_ID: "projectId is not a Firebase project id",
  APP_ID: "appId is not a Firebase web app id (1:<number>:web:<hex>)",
  API_KEY: "apiKey is not a Firebase web API key",
  AUTH_DOMAIN: "authDomain is not a host name (anonymous sign-in needs it)",
  SENDER: "messagingSenderId does not match the app id's project number",
  SITE_KEY: "the reCAPTCHA site key is not valid",
};

/** Trims what a copy and paste tends to add around a value. */
function clean(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

function orNull(value: string): string | null {
  return value.length > 0 ? value : null;
}

function build(fields: Record<string, string | undefined>, anonymousAuth: boolean): WebProject {
  const appId = clean(fields.appId);
  const sender = clean(fields.messagingSenderId);
  return {
    projectId: clean(fields.projectId),
    appId,
    apiKey: clean(fields.apiKey),
    authDomain: orNull(clean(fields.authDomain)),
    // The console always lists it; when left out it is the app id's project number, as on Android.
    messagingSenderId: sender.length > 0 ? sender : projectNumber(appId),
    recaptchaSiteKey: orNull(clean(fields.recaptchaSiteKey)),
    anonymousAuth,
  };
}

/** The start of the Android app's connect code, which carries an Android app id. */
export const ANDROID_CONNECT_PREFIX = "contextlens-connect:";

/** The start of a web connect code. */
export const WEB_CONNECT_PREFIX = "contextlens-web-connect:1?";

/**
 * The project in a web connect code:
 * `contextlens-web-connect:1?project=…&app=…&key=…&domain=…&sender=…[&site=…]`.
 * Null when it is not one or a required value is missing; check [problems] for the rest.
 */
export function fromConnectCode(text: string, anonymousAuth = false): WebProject | null {
  const code = text.trim();
  if (!code.startsWith(WEB_CONNECT_PREFIX)) return null;
  const params = new Map<string, string>();
  for (const part of code.slice(WEB_CONNECT_PREFIX.length).split("&")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try {
      params.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1).replaceAll("+", " ")));
    } catch {
      // a malformed escape: that value is left out
    }
  }
  const project = params.get("project");
  const app = params.get("app");
  const key = params.get("key");
  if (project === undefined || app === undefined || key === undefined) return null;
  return build(
    {
      projectId: project,
      appId: app,
      apiKey: key,
      authDomain: params.get("domain"),
      messagingSenderId: params.get("sender"),
      recaptchaSiteKey: params.get("site"),
    },
    anonymousAuth,
  );
}

const FIELDS = ["apiKey", "authDomain", "projectId", "appId", "messagingSenderId", "recaptchaSiteKey"] as const;

/**
 * The project in the web config the Firebase console shows (`const firebaseConfig = { apiKey: "…", … }`),
 * as JSON or as that JavaScript object. Only plain string fields are read; nothing is evaluated.
 * Null when apiKey, projectId or appId is missing.
 */
export function fromWebConfig(text: string, anonymousAuth = false): WebProject | null {
  const fields: Record<string, string> = {};
  const pair = /["']?([A-Za-z]+)["']?\s*:\s*(["'`])([^"'`\n]*)\2/g;
  for (const m of text.matchAll(pair)) {
    const name = m[1] as (typeof FIELDS)[number];
    if (FIELDS.includes(name) && fields[name] === undefined) fields[name] = m[3];
  }
  if (!fields.apiKey || !fields.projectId || !fields.appId) return null;
  return build(fields, anonymousAuth);
}

/** A connect code or a pasted web config, whichever the text is. */
export function parseProject(text: string, anonymousAuth = false): WebProject | null {
  return text.trim().startsWith(WEB_CONNECT_PREFIX) ? fromConnectCode(text, anonymousAuth) : fromWebConfig(text, anonymousAuth);
}

/** Where a project the visitor chose to remember is kept, in this browser only. */
export const STORAGE_KEY = "contextlens.webProject.v1";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored project; null when there is none. A stored value that no longer validates is removed. */
export function loadProject(store: Store | null = browserStore()): WebProject | null {
  try {
    const raw = store?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Record<keyof WebProject, unknown>>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const project = build(
      {
        projectId: str(data.projectId),
        appId: str(data.appId),
        apiKey: str(data.apiKey),
        authDomain: str(data.authDomain),
        messagingSenderId: str(data.messagingSenderId),
        recaptchaSiteKey: str(data.recaptchaSiteKey),
      },
      data.anonymousAuth === true,
    );
    if (problems(project).size === 0) return project;
    clearProject(store);
    return null;
  } catch {
    clearProject(store);
    return null;
  }
}

/** Keeps the project in this browser; false when storage is not available. */
export function saveProject(project: WebProject, store: Store | null = browserStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function clearProject(store: Store | null = browserStore()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
