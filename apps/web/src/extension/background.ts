// The extension's service worker: clicking the toolbar icon opens the side panel. Nothing else.

interface SidePanelApi {
  setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>;
}
declare const chrome: { sidePanel?: SidePanelApi; runtime: { onInstalled: { addListener(f: () => void): void } } };

function openOnClick(): void {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(openOnClick);
openOnClick();
