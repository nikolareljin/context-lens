import qrUrl from "../../../../docs/assets/apk-qr.svg?url";
import { DOCS, LATEST_APK, RELEASES } from "../lib/config";

/** The Android download: a button for phones, a QR code for desktops, the USB route for the rest. */
export function DownloadStrip() {
  return (
    <section aria-labelledby="get-android" className="rounded-2xl border border-edge bg-slate-950/70 p-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <img
          src={qrUrl}
          alt="QR code that downloads the newest ContextLens APK"
          width={152}
          height={152}
          className="h-38 w-38 rounded-xl bg-white p-2"
        />
        <div className="flex flex-col gap-3">
          <h2 id="get-android" className="text-xl font-semibold">Get the Android app</h2>
          <p className="text-slate-300">
            Scan with the phone's camera, or tap below on the phone. Android 8.0 or newer; the on-device
            gatekeeper needs a phone with Gemini Nano.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={LATEST_APK}
              className="rounded-full bg-bridge px-5 py-2 font-medium text-white hover:bg-cloud"
            >
              Download the signed APK
            </a>
            <a href={RELEASES} className="rounded-full border border-edge px-5 py-2 hover:border-device">
              All releases
            </a>
            <a href={`${DOCS}download/`} className="rounded-full border border-edge px-5 py-2 hover:border-device">
              Install over USB
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
