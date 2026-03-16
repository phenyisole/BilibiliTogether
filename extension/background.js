const DEFAULT_SETTINGS = {
  serverUrl: "ws://106.53.151.206:8787",
  sessionId: "demo-room",
  nickname: "Guest",
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const nextValues = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!current[key]) {
      nextValues[key] = value;
    }
  }

  if (Object.keys(nextValues).length > 0) {
    await chrome.storage.local.set(nextValues);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) {
    return;
  }

  await chrome.tabs.sendMessage(tab.id, { type: "toggle_panel" }).catch(() => {});
});
