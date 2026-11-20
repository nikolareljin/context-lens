// The extension build's stand-in for @firebase/app-check (vite.config.ts): App Check's reCAPTCHA
// provider loads a script from google.com, which extension pages may not run, so the package
// carries no App Check code at all. The connect form refuses a site key before this is reached.
import { EXTENSION_APP_CHECK } from "../lib/config";

export function initializeAppCheck(): never {
  throw new Error(EXTENSION_APP_CHECK);
}

export class ReCaptchaEnterpriseProvider {
  constructor() {
    throw new Error(EXTENSION_APP_CHECK);
  }
}
