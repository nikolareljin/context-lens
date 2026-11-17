// Web configuration, read at build time from VITE_FIREBASE_* in apps/web/.env.local for local
// builds. The published site is built without any, so visitors never reach the maintainer's project.

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId: string;
}

export interface WebConfig {
  firebase: FirebaseWebConfig | null;
  recaptchaSiteKey: string | null;
}

type Env = Record<string, string | undefined>;

const REQUIRED = {
  apiKey: "VITE_FIREBASE_API_KEY",
  authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID",
  appId: "VITE_FIREBASE_APP_ID",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
} as const;

/** Reads the configuration; Firebase is null unless every required value is present. */
export function readConfig(env: Env): WebConfig {
  const values = Object.fromEntries(
    Object.entries(REQUIRED).map(([key, name]) => [key, (env[name] ?? "").trim()]),
  ) as Record<keyof typeof REQUIRED, string>;
  const complete = Object.values(values).every((v) => v.length > 0);
  const site = (env.VITE_RECAPTCHA_SITE_KEY ?? "").trim();
  return {
    firebase: complete ? (values as FirebaseWebConfig) : null,
    recaptchaSiteKey: site.length > 0 ? site : null,
  };
}

export const config: WebConfig = readConfig(import.meta.env as unknown as Env);

export const RELEASES = "https://github.com/nikolareljin/context-lens/releases";
export const LATEST_APK = `${RELEASES}/latest/download/context-lens.apk`;
export const REPOSITORY = "https://github.com/nikolareljin/context-lens";
export const DOCS = "/context-lens/docs/";
