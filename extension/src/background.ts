// MV3 service worker. Opens the side panel when the toolbar icon is clicked.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: unknown) => console.error('[fargain] setPanelBehavior failed', err));
