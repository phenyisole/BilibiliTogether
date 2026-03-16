const DEFAULT_SETTINGS = {
  sessionId: "",
  nickname: "用户",
  role: "guest",
  clientId: "",
};

const connections = new Map();
const tabState = new Map();
const tabCache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const nextValues = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!current[key]) {
      nextValues[key] = value;
    }
  }

  if (!current.clientId) {
    nextValues.clientId = crypto.randomUUID();
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === "bt:connect") {
    if (!tabId) {
      sendResponse({ ok: false, error: "missing_tab" });
      return;
    }
    const nextState = {
      serverUrl: message.serverUrl,
      sessionId: message.sessionId,
      clientId: message.clientId,
      nickname: message.nickname,
      role: message.role,
    };
    const previousState = tabState.get(tabId);
    tabState.set(tabId, nextState);

    if (shouldReuseConnection(previousState, nextState, connections.get(tabId))) {
      flushTabState(tabId);
      sendResponse({ ok: true, reused: true });
      return true;
    }

    connectSocket(tabId, nextState);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "bt:send") {
    if (!tabId) {
      sendResponse({ ok: false, error: "missing_tab" });
      return;
    }
    const socket = connections.get(tabId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      sendResponse({ ok: false, error: "socket_not_open" });
      return;
    }
    socket.send(JSON.stringify(message.payload));
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "bt:disconnect") {
    if (tabId) {
      disconnectSocket(tabId);
      tabState.delete(tabId);
      tabCache.delete(tabId);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "bt:get-status") {
    const socket = tabId ? connections.get(tabId) : null;
    sendResponse({
      ok: true,
      connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  disconnectSocket(tabId);
  tabState.delete(tabId);
  tabCache.delete(tabId);
});

function connectSocket(tabId, options) {
  disconnectSocket(tabId);

  const { serverUrl, sessionId, clientId, nickname, role } = options;
  const ws = new WebSocket(serverUrl);
  connections.set(tabId, ws);

  ws.addEventListener("open", () => {
    if (connections.get(tabId) !== ws) {
      ws.close();
      return;
    }

    tabCache.set(tabId, {
      socketEvent: "open",
      lastMessages: [],
    });

    ws.send(
      JSON.stringify({
        type: "join",
        sessionId,
        clientId,
        nickname,
        role,
      })
    );

    postSocketEvent(tabId, "open");
  });

  ws.addEventListener("message", (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    rememberMessage(tabId, data);
    postToTab(tabId, {
      type: "bt:server-message",
      payload: data,
    });
  });

  ws.addEventListener("close", () => {
    if (connections.get(tabId) === ws) {
      connections.delete(tabId);
    }

    postSocketEvent(tabId, "close");
    scheduleReconnect(tabId);
  });

  ws.addEventListener("error", () => {
    postSocketEvent(tabId, "error");
  });
}

function disconnectSocket(tabId) {
  const existing = connections.get(tabId);
  if (existing) {
    connections.delete(tabId);
    existing.close();
  }
}

function postToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function postSocketEvent(tabId, event) {
  const cache = tabCache.get(tabId) || { lastMessages: [] };
  cache.socketEvent = event;
  tabCache.set(tabId, cache);
  postToTab(tabId, {
    type: "bt:socket",
    event,
  });
}

function rememberMessage(tabId, message) {
  const cache = tabCache.get(tabId) || { socketEvent: "close", lastMessages: [] };
  const preserved = cache.lastMessages.filter((item) => !["joined", "presence", "navigate", "video_state"].includes(item.type));
  if (["joined", "presence", "navigate", "video_state"].includes(message.type)) {
    preserved.push(message);
  }
  cache.lastMessages = preserved.slice(-20);
  tabCache.set(tabId, cache);
}

function flushTabState(tabId) {
  const cache = tabCache.get(tabId);
  if (!cache) {
    return;
  }

  if (cache.socketEvent) {
    postToTab(tabId, {
      type: "bt:socket",
      event: cache.socketEvent,
    });
  }

  for (const payload of cache.lastMessages || []) {
    postToTab(tabId, {
      type: "bt:server-message",
      payload,
    });
  }
}

function shouldReuseConnection(previousState, nextState, socket) {
  if (!previousState || !socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  return (
    previousState.serverUrl === nextState.serverUrl &&
    previousState.sessionId === nextState.sessionId &&
    previousState.clientId === nextState.clientId &&
    previousState.nickname === nextState.nickname &&
    previousState.role === nextState.role
  );
}

function scheduleReconnect(tabId) {
  const desiredState = tabState.get(tabId);
  if (!desiredState) {
    return;
  }

  setTimeout(() => {
    if (connections.has(tabId)) {
      return;
    }

    const latestState = tabState.get(tabId);
    if (!latestState) {
      return;
    }

    connectSocket(tabId, latestState);
  }, 1500);
}
