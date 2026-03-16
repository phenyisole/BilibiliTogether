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
  collapsed: false,
  dragPointerId: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  panelX: null,
  panelY: 88,
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
    setStatus(false, "请输入房间秘钥");
    render();
  }
}

function buildPanel() {
  root.innerHTML = `
    <div class="bt-panel" style="display:${state.panelVisible ? "flex" : "none"}">
      <div class="bt-header" data-role="dragHandle">
        <div>
          <div class="bt-title">Bilibili Together</div>
          <div class="bt-status" data-role="status">请输入房间秘钥</div>
        </div>
        <div class="bt-header-actions">
          <button data-role="collapse" class="bt-icon-btn" type="button">-</button>
          <button data-role="hide" class="bt-icon-btn" type="button">×</button>
        </div>
      </div>
      <div class="bt-body" data-role="body">
        <div class="bt-field">
          <label>房间秘钥</label>
          <input data-role="sessionId" placeholder="例如：room-001" />
        </div>
        <div class="bt-field">
          <label>昵称</label>
          <input data-role="nickname" />
        </div>
        <div class="bt-field">
          <label>身份</label>
          <div class="bt-role-row">
            <label class="bt-role-option">
              <input data-role="hostRadio" type="radio" name="bt-role" value="host" />
              <span>主人</span>
            </label>
            <label class="bt-role-option">
              <input data-role="guestRadio" type="radio" name="bt-role" value="guest" />
              <span>客人</span>
            </label>
          </div>
        </div>
        <div class="bt-actions">
          <button data-role="save">进入房间</button>
          <button data-role="syncNow" class="secondary">主人同步</button>
        </div>
        <div class="bt-presence" data-role="presence">在线人数：0/2</div>
        <div class="bt-hint" data-role="hint">主人控制页面跟随、播放、暂停和拖动，客人只负责跟随。</div>
        <div class="bt-chat-list" data-role="chatList"></div>
        <form class="bt-chat-form" data-role="chatForm">
          <input data-role="chatInput" placeholder="发送一条消息" maxlength="500" />
          <button type="submit">发送</button>
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
  elements.body = root.querySelector('[data-role="body"]');
  elements.dragHandle = root.querySelector('[data-role="dragHandle"]');
  elements.chatList = root.querySelector('[data-role="chatList"]');
  elements.chatForm = root.querySelector('[data-role="chatForm"]');
  elements.chatInput = root.querySelector('[data-role="chatInput"]');

  root.querySelector('[data-role="hide"]').addEventListener("click", () => {
    state.panelVisible = false;
    render();
  });

  root.querySelector('[data-role="collapse"]').addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    render();
  });

  root.querySelector('[data-role="save"]').addEventListener("click", saveSettings);
  root.querySelector('[data-role="syncNow"]').addEventListener("click", syncCurrentVideoState);
  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage();
  });
  initDrag();

  render();
}

function render() {
  if (!elements.panel) {
    return;
  }

  elements.panel.style.display = state.panelVisible ? "flex" : "none";
  elements.panel.style.left = state.panelX == null ? "auto" : `${state.panelX}px`;
  elements.panel.style.right = state.panelX == null ? "20px" : "auto";
  elements.panel.style.top = `${state.panelY}px`;
  elements.sessionId.value = state.sessionId;
  elements.nickname.value = state.nickname;
  elements.hostRadio.checked = state.role === "host";
  elements.guestRadio.checked = state.role !== "host";
  elements.body.style.display = state.collapsed ? "none" : "flex";
  root.querySelector('[data-role="collapse"]').textContent = state.collapsed ? "+" : "-";
  elements.status.textContent = state.isConnected ? `${roleText(state.role)}已连接` : elements.status.textContent;
  elements.presence.textContent = `在线人数：${state.users.length}/2`;
  elements.chatInput.disabled = !state.isConnected;
  elements.hint.textContent =
    state.role === "host"
      ? "你是主人。你在 B 站里的页面切换、播放、暂停和拖动会驱动客人。"
      : "你是客人。你会跟随主人在 B 站里的页面和视频状态。";
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
    setStatus(false, "请输入房间秘钥");
    render();
    return;
  }

  appendSystemMessage(`正在以${roleText(state.role)}身份加入房间 ${state.sessionId}`);
  connect();
}

function connect() {
  if (!state.sessionId) {
    return;
  }

  setStatus(false, "连接中...");
  render();
  chrome.runtime.sendMessage({
    type: "bt:disconnect",
  });
  chrome.runtime.sendMessage({
    type: "bt:connect",
    serverUrl: SERVER_URL,
    sessionId: state.sessionId,
    clientId: state.clientId,
    nickname: state.nickname,
    role: state.role,
  });
}

function handleServerMessage(message) {
  if (message.type === "joined") {
    state.users = message.users || [];
    state.hostClientId = message.hostClientId || null;
    setStatus(true, `${roleText(state.role)}已连接`);
    render();
    clearChatIfFreshJoin();
    appendSystemMessage(`已进入房间 ${message.sessionId}`);

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
    appendSystemMessage(`${message.nickname || "对方"}以${roleText(message.role || "guest")}身份加入了房间`);
    return;
  }

  if (message.type === "peer_left") {
    appendSystemMessage("对方已离开");
    return;
  }

  if (message.type === "chat_message") {
    appendChatMessage(message);
    return;
  }

  if (message.type === "navigate") {
    if (state.role === "guest" && message.senderId === state.hostClientId && message.url && message.url !== location.href) {
      appendSystemMessage("正在跟随主人切换到新的 B 站页面");
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
      room_full: "房间已满",
      host_taken: "这个房间里已经有主人了",
      host_only: "只有主人可以控制同步",
      join_required: "请先进入房间",
    };
    appendSystemMessage(`服务器：${messageMap[message.message] || message.message}`);
    if ((message.message === "room_full" || message.message === "host_taken") && state.ws) {
      state.ws.close();
    }
  }
}

function setStatus(connected, text) {
  state.isConnected = connected;
  state.ws = connected ? { readyState: WebSocket.OPEN } : null;
  if (elements.status) {
    elements.status.textContent = text;
  }
}

function appendSystemMessage(text) {
  appendChatMessage({
    nickname: "系统",
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
  if (!text || !state.isConnected) {
    return;
  }

  elements.chatInput.value = "";
  sendToBackground({ type: "chat_message", text });
  appendChatMessage({
    senderId: state.clientId,
    nickname: `${state.nickname}（我）`,
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
  if (state.role !== "host" || !state.isConnected) {
    return;
  }
  if (!isBilibiliUrl(url)) {
    return;
  }
  sendToBackground({ type: "navigate", url });
}

function sendVideoState(action) {
  if (state.role !== "host" || !state.isConnected || Date.now() < state.suppressUntil) {
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
  sendToBackground(payload);
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
  return `用户-${Math.random().toString(36).slice(2, 6)}`;
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

function roleText(role) {
  return role === "host" ? "主人" : "客人";
}

function initDrag() {
  elements.dragHandle.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".bt-icon-btn")) {
      return;
    }

    const rect = elements.panel.getBoundingClientRect();
    state.dragPointerId = event.pointerId;
    state.dragOffsetX = event.clientX - rect.left;
    state.dragOffsetY = event.clientY - rect.top;
    state.panelX = rect.left;
    state.panelY = rect.top;
    elements.dragHandle.setPointerCapture(event.pointerId);
  });

  elements.dragHandle.addEventListener("pointermove", (event) => {
    if (state.dragPointerId !== event.pointerId) {
      return;
    }

    state.panelX = Math.max(8, Math.min(window.innerWidth - elements.panel.offsetWidth - 8, event.clientX - state.dragOffsetX));
    state.panelY = Math.max(8, Math.min(window.innerHeight - 48, event.clientY - state.dragOffsetY));
    render();
  });

  const stopDrag = (event) => {
    if (state.dragPointerId !== event.pointerId) {
      return;
    }
    state.dragPointerId = null;
    elements.dragHandle.releasePointerCapture(event.pointerId);
  };

  elements.dragHandle.addEventListener("pointerup", stopDrag);
  elements.dragHandle.addEventListener("pointercancel", stopDrag);
}

function sendToBackground(payload) {
  chrome.runtime.sendMessage({
    type: "bt:send",
    payload,
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "bt:server-message") {
    handleServerMessage(message.payload);
    return;
  }

  if (message.type === "bt:socket") {
    if (message.event === "open") {
      setStatus(true, `${roleText(state.role)}已连接`);
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      render();
      return;
    }

    if (message.event === "close") {
      setStatus(false, state.sessionId ? "连接断开，正在重试..." : "连接断开");
      render();
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
      }
      state.reconnectTimer = window.setTimeout(() => {
        if (state.sessionId) {
          connect();
        }
      }, 2000);
      return;
    }

    if (message.event === "error") {
      setStatus(false, "连接错误");
      render();
    }
  }
});
