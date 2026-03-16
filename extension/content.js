const SERVER_URL = "ws://106.53.151.206:8787";
const STORAGE_KEYS = ["sessionId", "nickname", "clientId", "role"];
const state = {
  ws: null,
  sessionId: "",
  nickname: "",
  clientId: "",
  role: "guest",
  hostClientId: null,
  isConnected: false,
  users: [],
  panelVisible: true,
  suppressUntil: 0,
  lastUrl: location.href,
  lastSyncAt: 0,
  lastSentSignature: "",
  recentChatKeys: new Set(),
  reconnectTimer: null,
};

const elements = {};
const root = document.createElement("div");
root.id = "bt-root";
document.documentElement.appendChild(root);

init().catch((error) => {
  console.error("Bilibili Together init failed", error);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "toggle_panel") {
    state.panelVisible = !state.panelVisible;
    render();
  }
});

async function init() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS);
  state.sessionId = stored.sessionId || "";
  state.nickname = stored.nickname || createDefaultNickname();
  state.clientId = stored.clientId || crypto.randomUUID();
  state.role = stored.role === "host" ? "host" : "guest";

  await chrome.storage.local.set({
    sessionId: state.sessionId,
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
  });

  buildPanel();
  installHistoryHooks();
  watchVideo();
  startUrlWatcher();

  if (state.sessionId) {
    connect();
  } else {
    setStatus(false, "Enter key to start");
    render();
  }
}

function buildPanel() {
  root.innerHTML = `
    <div class="bt-panel" style="display:${state.panelVisible ? "flex" : "none"}">
      <div class="bt-header">
        <div>
          <div class="bt-title">Bilibili Together</div>
          <div class="bt-status" data-role="status">Enter key to start</div>
        </div>
        <button data-role="hide" style="all:unset;cursor:pointer;font-size:18px;line-height:1;">×</button>
      </div>
      <div class="bt-body">
        <div class="bt-field">
          <label>Room Key</label>
          <input data-role="sessionId" placeholder="example: room-001" />
        </div>
        <div class="bt-field">
          <label>Nickname</label>
          <input data-role="nickname" />
        </div>
        <div class="bt-field">
          <label>Role</label>
          <div class="bt-role-row">
            <label class="bt-role-option">
              <input data-role="hostRadio" type="radio" name="bt-role" value="host" />
              <span>Host</span>
            </label>
            <label class="bt-role-option">
              <input data-role="guestRadio" type="radio" name="bt-role" value="guest" />
              <span>Guest</span>
            </label>
          </div>
        </div>
        <div class="bt-actions">
          <button data-role="save">Join Room</button>
          <button data-role="syncNow" class="secondary">Host Sync</button>
        </div>
        <div class="bt-presence" data-role="presence">Peers: 0/2</div>
        <div class="bt-hint" data-role="hint">Host controls page follow, play, pause and seek. Guest only follows.</div>
        <div class="bt-chat-list" data-role="chatList"></div>
        <form class="bt-chat-form" data-role="chatForm">
          <input data-role="chatInput" placeholder="Send a message" maxlength="500" />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  `;

  elements.panel = root.querySelector(".bt-panel");
  elements.status = root.querySelector('[data-role="status"]');
  elements.sessionId = root.querySelector('[data-role="sessionId"]');
  elements.nickname = root.querySelector('[data-role="nickname"]');
  elements.hostRadio = root.querySelector('[data-role="hostRadio"]');
  elements.guestRadio = root.querySelector('[data-role="guestRadio"]');
  elements.presence = root.querySelector('[data-role="presence"]');
  elements.hint = root.querySelector('[data-role="hint"]');
  elements.chatList = root.querySelector('[data-role="chatList"]');
  elements.chatForm = root.querySelector('[data-role="chatForm"]');
  elements.chatInput = root.querySelector('[data-role="chatInput"]');

  root.querySelector('[data-role="hide"]').addEventListener("click", () => {
    state.panelVisible = false;
    render();
  });

  root.querySelector('[data-role="save"]').addEventListener("click", saveSettings);
  root.querySelector('[data-role="syncNow"]').addEventListener("click", syncCurrentVideoState);
  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage();
  });

  render();
}

function render() {
  if (!elements.panel) {
    return;
  }

  elements.panel.style.display = state.panelVisible ? "flex" : "none";
  elements.sessionId.value = state.sessionId;
  elements.nickname.value = state.nickname;
  elements.hostRadio.checked = state.role === "host";
  elements.guestRadio.checked = state.role !== "host";
  elements.status.textContent = state.isConnected ? `${capitalizeRole(state.role)} connected` : elements.status.textContent;
  elements.presence.textContent = `Peers: ${state.users.length}/2`;
  elements.chatInput.disabled = !state.isConnected;
  elements.hint.textContent =
    state.role === "host"
      ? "You are host. Your Bilibili page, play, pause and seek will drive the guest."
      : "You are guest. You will follow the host on any Bilibili page and video state.";
}

async function saveSettings() {
  state.sessionId = elements.sessionId.value.trim();
  state.nickname = elements.nickname.value.trim() || createDefaultNickname();
  state.role = elements.hostRadio.checked ? "host" : "guest";

  await chrome.storage.local.set({
    sessionId: state.sessionId,
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
  });

  if (!state.sessionId) {
    setStatus(false, "Room key required");
    render();
    return;
  }

  appendSystemMessage(`Joining ${state.sessionId} as ${capitalizeRole(state.role)}`);
  connect(true);
}

function connect(forceReconnect = false) {
  if (!state.sessionId) {
    return;
  }

  if (forceReconnect && state.ws) {
    state.ws.close();
  }

  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const ws = new WebSocket(SERVER_URL);
  state.ws = ws;
  setStatus(false, "Connecting...");
  render();

  ws.addEventListener("open", () => {
    setStatus(true, `${capitalizeRole(state.role)} connected`);
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    render();
    ws.send(
      JSON.stringify({
        type: "join",
        sessionId: state.sessionId,
        clientId: state.clientId,
        nickname: state.nickname,
        role: state.role,
      })
    );
  });

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    handleServerMessage(message);
  });

  ws.addEventListener("close", () => {
    setStatus(false, state.sessionId ? "Disconnected, retrying..." : "Disconnected");
    render();
    state.reconnectTimer = window.setTimeout(() => {
      if (state.ws === ws && state.sessionId) {
        connect();
      }
    }, 2000);
  });

  ws.addEventListener("error", () => {
    setStatus(false, "Connection error");
    render();
  });
}

function handleServerMessage(message) {
  if (message.type === "joined") {
    state.users = message.users || [];
    state.hostClientId = message.hostClientId || null;
    setStatus(true, `${capitalizeRole(state.role)} connected`);
    render();
    clearChatIfFreshJoin();
    appendSystemMessage(`Joined room ${message.sessionId}`);

    if (Array.isArray(message.chatHistory)) {
      for (const item of message.chatHistory) {
        appendChatMessage(item);
      }
    }

    if (state.role === "host") {
      sendNavigate(location.href);
      syncCurrentVideoState();
    } else {
      if (message.lastNavigate?.url && message.lastNavigate.url !== location.href) {
        navigateTo(message.lastNavigate.url);
      }
      if (message.lastVideoState) {
        applyRemoteVideoState(message.lastVideoState);
      }
    }
    return;
  }

  if (message.type === "presence") {
    state.users = message.users || [];
    const hostUser = state.users.find((user) => user.role === "host");
    state.hostClientId = hostUser?.clientId || null;
    render();
    return;
  }

  if (message.type === "peer_joined") {
    appendSystemMessage(`${message.nickname || "Peer"} joined as ${capitalizeRole(message.role || "guest")}`);
    return;
  }

  if (message.type === "peer_left") {
    appendSystemMessage("Peer left");
    return;
  }

  if (message.type === "chat_message") {
    appendChatMessage(message);
    return;
  }

  if (message.type === "navigate") {
    if (state.role === "guest" && message.senderId === state.hostClientId && message.url && message.url !== location.href) {
      appendSystemMessage("Following host to another Bilibili page");
      navigateTo(message.url);
    }
    return;
  }

  if (message.type === "video_state") {
    if (state.role === "guest" && message.senderId === state.hostClientId) {
      applyRemoteVideoState(message);
    }
    return;
  }

  if (message.type === "error") {
    const messageMap = {
      room_full: "Room is full",
      host_taken: "Host already exists in this room",
      host_only: "Only host can control sync",
      join_required: "Join a room first",
    };
    appendSystemMessage(`Server: ${messageMap[message.message] || message.message}`);
    if ((message.message === "room_full" || message.message === "host_taken") && state.ws) {
      state.ws.close();
    }
  }
}

function setStatus(connected, text) {
  state.isConnected = connected;
  if (elements.status) {
    elements.status.textContent = text;
  }
}

function appendSystemMessage(text) {
  appendChatMessage({
    nickname: "System",
    text,
    sentAt: Date.now(),
  });
}

function appendChatMessage(message) {
  if (!elements.chatList) {
    return;
  }

  const key = `${message.senderId || message.nickname}-${message.sentAt}-${message.text}`;
  if (state.recentChatKeys.has(key)) {
    return;
  }
  state.recentChatKeys.add(key);
  if (state.recentChatKeys.size > 100) {
    const firstKey = state.recentChatKeys.values().next().value;
    state.recentChatKeys.delete(firstKey);
  }

  const item = document.createElement("div");
  item.className = "bt-chat-item";
  const time = new Date(message.sentAt || Date.now()).toLocaleTimeString();
  item.innerHTML = `<strong>${escapeHtml(message.nickname || "Guest")}</strong> <span style="opacity:.6">${time}</span><br>${escapeHtml(message.text || "")}`;
  elements.chatList.appendChild(item);
  elements.chatList.scrollTop = elements.chatList.scrollHeight;
}

function sendChatMessage() {
  const text = elements.chatInput.value.trim();
  if (!text || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  elements.chatInput.value = "";
  state.ws.send(JSON.stringify({ type: "chat_message", text }));
  appendChatMessage({
    senderId: state.clientId,
    nickname: `${state.nickname} (You)`,
    text,
    sentAt: Date.now(),
  });
}

function watchVideo() {
  const installListeners = () => {
    const video = getVideoElement();
    if (!video || video.dataset.btBound === "1") {
      return;
    }

    video.dataset.btBound = "1";
    video.addEventListener("play", () => sendVideoState("play"));
    video.addEventListener("pause", () => sendVideoState("pause"));
    video.addEventListener("seeked", () => sendVideoState("seeked"));
    video.addEventListener("ratechange", () => sendVideoState("ratechange"));
  };

  installListeners();
  const observer = new MutationObserver(installListeners);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function startUrlWatcher() {
  setInterval(() => {
    if (location.href !== state.lastUrl) {
      const newUrl = location.href;
      const oldUrl = state.lastUrl;
      state.lastUrl = newUrl;

      if (state.role === "host" && Date.now() > state.suppressUntil && isBilibiliUrl(newUrl) && oldUrl !== newUrl) {
        sendNavigate(newUrl);
      }

      if (state.role === "host") {
        setTimeout(() => {
          syncCurrentVideoState();
        }, 1500);
      }
    }
  }, 500);
}

function installHistoryHooks() {
  const wrap = (methodName) => {
    const original = history[methodName];
    history[methodName] = function (...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event("bt-location-change"));
      return result;
    };
  };

  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", () => window.dispatchEvent(new Event("bt-location-change")));
  window.addEventListener("bt-location-change", () => {
    state.lastUrl = location.href;
  });
}

function sendNavigate(url) {
  if (state.role !== "host" || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (!isBilibiliUrl(url)) {
    return;
  }
  state.ws.send(JSON.stringify({ type: "navigate", url }));
}

function sendVideoState(action) {
  if (state.role !== "host" || !state.ws || state.ws.readyState !== WebSocket.OPEN || Date.now() < state.suppressUntil) {
    return;
  }

  const video = getVideoElement();
  if (!video) {
    return;
  }

  const payload = {
    type: "video_state",
    action,
    currentTime: Number(video.currentTime.toFixed(2)),
    paused: video.paused,
    playbackRate: video.playbackRate,
    url: location.href,
  };

  const signature = JSON.stringify(payload);
  if (signature === state.lastSentSignature && Date.now() - state.lastSyncAt < 800) {
    return;
  }

  state.lastSentSignature = signature;
  state.lastSyncAt = Date.now();
  state.ws.send(JSON.stringify(payload));
}

function syncCurrentVideoState() {
  if (state.role !== "host") {
    return;
  }
  sendVideoState("sync");
}

function applyRemoteVideoState(message) {
  const apply = () => {
    const video = getVideoElement();
    if (!video) {
      return false;
    }

    state.suppressUntil = Date.now() + 1200;

    const targetTime = Number(message.currentTime || 0);
    const drift = Math.abs(video.currentTime - targetTime);
    if (drift > 0.8) {
      video.currentTime = targetTime;
    }

    if (message.playbackRate && Math.abs(video.playbackRate - message.playbackRate) > 0.01) {
      video.playbackRate = message.playbackRate;
    }

    if (message.paused) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
    return true;
  };

  if (!apply()) {
    let retries = 0;
    const timer = setInterval(() => {
      retries += 1;
      if (apply() || retries >= 12) {
        clearInterval(timer);
      }
    }, 800);
  }
}

function navigateTo(url) {
  if (!isBilibiliUrl(url)) {
    return;
  }
  state.suppressUntil = Date.now() + 3000;
  location.href = url;
}

function getVideoElement() {
  return document.querySelector("video");
}

function createDefaultNickname() {
  return `User-${Math.random().toString(36).slice(2, 6)}`;
}

function isBilibiliUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)?bilibili\.com\//i.test(url);
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clearChatIfFreshJoin() {
  const existingItems = elements.chatList.querySelectorAll(".bt-chat-item");
  if (existingItems.length > 60) {
    elements.chatList.innerHTML = "";
    state.recentChatKeys.clear();
  }
}

function capitalizeRole(role) {
  return role === "host" ? "Host" : "Guest";
}
