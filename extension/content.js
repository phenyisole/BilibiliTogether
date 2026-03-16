const SERVER_URL = "ws://106.53.151.206:8787";
const STORAGE_KEYS = [
  "sessionId",
  "nickname",
  "clientId",
  "role",
  "speechEnabled",
  "rememberPanel",
  "panelX",
  "panelY",
  "collapsed",
  "panelWidth",
  "panelHeight",
];
const VIDEO_SELECTORS = [
  ".bpx-player-video-wrap video",
  ".bilibili-player-video video",
  ".bpx-player-container video",
  "video",
];
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
  lastRemoteVideoState: null,
  recentChatKeys: new Set(),
  reconnectTimer: null,
  settingsOpen: false,
  speechEnabled: false,
  rememberPanel: true,
  collapsed: false,
  dragPointerId: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  panelX: null,
  panelY: 88,
  panelWidth: 348,
  panelHeight: 620,
  voicesReady: false,
  hostSyncTimer: null,
  guestEnforceTimer: null,
  hostObserveTimer: null,
  lastObservedVideoState: null,
  debugLogs: [],
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
  state.speechEnabled = Boolean(stored.speechEnabled);
  state.rememberPanel = stored.rememberPanel !== false;
  state.collapsed = Boolean(stored.collapsed);
  state.panelX = typeof stored.panelX === "number" ? stored.panelX : null;
  state.panelY = typeof stored.panelY === "number" ? stored.panelY : 88;
  state.panelWidth = typeof stored.panelWidth === "number" ? stored.panelWidth : 348;
  state.panelHeight = typeof stored.panelHeight === "number" ? stored.panelHeight : 620;

  await chrome.storage.local.set({
    sessionId: state.sessionId,
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
    speechEnabled: state.speechEnabled,
    rememberPanel: state.rememberPanel,
    panelX: state.panelX,
    panelY: state.panelY,
    panelWidth: state.panelWidth,
    panelHeight: state.panelHeight,
    collapsed: state.collapsed,
  });

  buildPanel();
  installHistoryHooks();
  watchVideo();
  installGuestPlaybackGuard();
  installVisibilitySync();
  initSpeechVoices();
  startHostSyncLoop();
  startHostObserveLoop();
  startGuestEnforceLoop();
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
    <button class="bt-mini-launcher" data-role="miniLauncher" type="button">
      <span class="bt-mini-dot"></span>
      <span class="bt-mini-text">一起看</span>
    </button>
    <div class="bt-panel" style="display:${state.panelVisible ? "flex" : "none"}">
      <div class="bt-header" data-role="dragHandle">
        <div class="bt-header-copy">
          <div class="bt-kicker">Bilibili watch party</div>
          <div class="bt-title">Bilibili Together</div>
          <div class="bt-status" data-role="status">请输入房间秘钥</div>
        </div>
        <div class="bt-header-actions">
          <button data-role="settings" class="bt-icon-btn" type="button">⚙</button>
          <button data-role="collapse" class="bt-icon-btn" type="button">-</button>
          <button data-role="hide" class="bt-icon-btn" type="button">×</button>
        </div>
      </div>
      <div class="bt-body" data-role="body">
        <div class="bt-hero">
          <div class="bt-hero-chip" data-role="roleBadge">客人模式</div>
          <div class="bt-hero-chip bt-hero-chip-muted" data-role="serverBadge">服务器已内置</div>
        </div>
        <div class="bt-settings" data-role="settingsPanel">
          <div class="bt-settings-title">常用设置</div>
          <label class="bt-toggle">
            <span>收到对方消息时朗读</span>
            <input data-role="speechEnabled" type="checkbox" />
          </label>
          <label class="bt-toggle">
            <span>记住面板位置和最小化状态</span>
            <input data-role="rememberPanel" type="checkbox" />
          </label>
          <button class="bt-export-btn" data-role="exportLog" type="button">导出日志文件</button>
        </div>
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
          <button data-role="leave" class="secondary">退出房间</button>
        </div>
        <div class="bt-meta-card">
          <div class="bt-presence" data-role="presence">在线人数：0/2</div>
          <div class="bt-hint" data-role="hint">主人控制页面跟随、播放、暂停和拖动，客人只负责跟随。</div>
        </div>
        <div class="bt-chat-list" data-role="chatList"></div>
        <form class="bt-chat-form" data-role="chatForm">
          <input data-role="chatInput" placeholder="发送一条消息" maxlength="500" />
          <button type="submit">发送</button>
        </form>
      </div>
    </div>
  `;

  elements.panel = root.querySelector(".bt-panel");
  elements.miniLauncher = root.querySelector('[data-role="miniLauncher"]');
  elements.status = root.querySelector('[data-role="status"]');
  elements.sessionId = root.querySelector('[data-role="sessionId"]');
  elements.nickname = root.querySelector('[data-role="nickname"]');
  elements.hostRadio = root.querySelector('[data-role="hostRadio"]');
  elements.guestRadio = root.querySelector('[data-role="guestRadio"]');
  elements.roleBadge = root.querySelector('[data-role="roleBadge"]');
  elements.presence = root.querySelector('[data-role="presence"]');
  elements.hint = root.querySelector('[data-role="hint"]');
  elements.body = root.querySelector('[data-role="body"]');
  elements.dragHandle = root.querySelector('[data-role="dragHandle"]');
  elements.settingsPanel = root.querySelector('[data-role="settingsPanel"]');
  elements.speechEnabled = root.querySelector('[data-role="speechEnabled"]');
  elements.rememberPanel = root.querySelector('[data-role="rememberPanel"]');
  elements.chatList = root.querySelector('[data-role="chatList"]');
  elements.chatForm = root.querySelector('[data-role="chatForm"]');
  elements.chatInput = root.querySelector('[data-role="chatInput"]');

  root.querySelector('[data-role="hide"]').addEventListener("click", () => {
    leaveRoom({ hidePanel: true });
  });

  root.querySelector('[data-role="collapse"]').addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    persistUiState();
    render();
  });
  elements.miniLauncher.addEventListener("click", () => {
    state.collapsed = false;
    state.panelVisible = true;
    persistUiState();
    render();
  });
  root.querySelector('[data-role="settings"]').addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    render();
  });
  elements.speechEnabled.addEventListener("change", async () => {
    state.speechEnabled = elements.speechEnabled.checked;
    await persistUiState();
    if (state.speechEnabled) {
      speakPreview();
    } else if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  });
  elements.rememberPanel.addEventListener("change", async () => {
    state.rememberPanel = elements.rememberPanel.checked;
    if (!state.rememberPanel) {
      state.panelX = null;
      state.panelY = 88;
      state.panelWidth = 348;
      state.panelHeight = 620;
      state.collapsed = false;
    }
    await persistUiState();
    render();
  });
  root.querySelector('[data-role="exportLog"]').addEventListener("click", exportDebugLog);

  root.querySelector('[data-role="save"]').addEventListener("click", saveSettings);
  root.querySelector('[data-role="syncNow"]').addEventListener("click", syncCurrentVideoState);
  root.querySelector('[data-role="leave"]').addEventListener("click", leaveRoom);
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
  elements.miniLauncher.style.display = !state.panelVisible || state.collapsed ? "inline-flex" : "none";
  elements.panel.style.left = state.panelX == null ? "auto" : `${state.panelX}px`;
  elements.panel.style.right = state.panelX == null ? "20px" : "auto";
  elements.panel.style.top = `${state.panelY}px`;
  elements.panel.style.width = `${state.panelWidth}px`;
  elements.panel.style.height = `${state.panelHeight}px`;
  elements.miniLauncher.style.left = state.panelX == null ? "auto" : `${state.panelX}px`;
  elements.miniLauncher.style.right = state.panelX == null ? "20px" : "auto";
  elements.miniLauncher.style.top = `${state.panelY}px`;
  elements.sessionId.value = state.sessionId;
  elements.nickname.value = state.nickname;
  elements.hostRadio.checked = state.role === "host";
  elements.guestRadio.checked = state.role !== "host";
  elements.roleBadge.textContent = state.role === "host" ? "主人模式" : "客人模式";
  elements.speechEnabled.checked = state.speechEnabled;
  elements.rememberPanel.checked = state.rememberPanel;
  elements.settingsPanel.style.display = state.settingsOpen ? "flex" : "none";
  elements.body.style.display = state.collapsed ? "none" : "flex";
  root.querySelector('[data-role="collapse"]').textContent = state.collapsed ? "+" : "-";
  elements.panel.classList.toggle("bt-panel-collapsed", state.collapsed);
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
  state.speechEnabled = elements.speechEnabled.checked;
  state.rememberPanel = elements.rememberPanel.checked;

  await chrome.storage.local.set({
    sessionId: state.sessionId,
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
    speechEnabled: state.speechEnabled,
    rememberPanel: state.rememberPanel,
    panelX: state.rememberPanel ? state.panelX : null,
    panelY: state.rememberPanel ? state.panelY : 88,
    panelWidth: state.rememberPanel ? state.panelWidth : 348,
    panelHeight: state.rememberPanel ? state.panelHeight : 620,
    collapsed: state.rememberPanel ? state.collapsed : false,
  });

  if (!state.sessionId) {
    setStatus(false, "请输入房间秘钥");
    render();
    return;
  }

  connect();
}

function connect() {
  if (!state.sessionId) {
    return;
  }

  addDebugLog("connect", `准备连接房间 ${state.sessionId}，身份：${roleText(state.role)}`);
  setStatus(false, "连接中...");
  render();
  chrome.runtime.sendMessage({
    type: "bt:connect",
    serverUrl: SERVER_URL,
    sessionId: state.sessionId,
    clientId: state.clientId,
    nickname: state.nickname,
    role: state.role,
  });
}

async function leaveRoom(options = {}) {
  const { hidePanel = false } = options;
  addDebugLog("leave", `退出房间 ${state.sessionId || "(空)"}`);
  chrome.runtime.sendMessage({ type: "bt:disconnect" });
  state.isConnected = false;
  state.ws = null;
  state.hostClientId = null;
  state.users = [];
  state.lastRemoteVideoState = null;
  state.lastObservedVideoState = null;
  state.sessionId = "";
  state.chatListClearedAt = Date.now();
  clearChatIfFreshJoin(true);
  setStatus(false, "已退出房间");
  state.panelVisible = !hidePanel;
  state.collapsed = false;
  await chrome.storage.local.set({
    sessionId: "",
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
  });
  render();
}

function handleServerMessage(message) {
  if (message.type === "joined") {
    addDebugLog("joined", `已进入房间，hostClientId=${message.hostClientId || "none"}`);
    state.users = message.users || [];
    state.hostClientId = message.hostClientId || null;
    setStatus(true, `${roleText(state.role)}已连接`);
    render();
    clearChatIfFreshJoin();

    if (Array.isArray(message.chatHistory)) {
      for (const item of message.chatHistory) {
        appendChatMessage(item, { speak: false });
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
    addDebugLog("presence", `在线人数=${(message.users || []).length}`);
    state.users = message.users || [];
    const hostUser = state.users.find((user) => user.role === "host");
    state.hostClientId = hostUser?.clientId || null;
    render();
    return;
  }

  if (message.type === "peer_joined") {
    appendPresenceMessage(message.nickname || "对方", "加入了房间");
    return;
  }

  if (message.type === "peer_left") {
    const leavingUser = state.users.find((user) => user.clientId === message.clientId);
    appendPresenceMessage(leavingUser?.nickname || "对方", "离开了房间");
    return;
  }

  if (message.type === "chat_message") {
    appendChatMessage(message, {
      speak: message.senderId !== state.clientId,
    });
    return;
  }

  if (message.type === "navigate") {
    if (state.role === "guest" && message.senderId === state.hostClientId && message.url && message.url !== location.href) {
      addDebugLog("navigate:recv", `收到页面跳转 ${shortUrl(message.url)}`);
      navigateTo(message.url);
    }
    return;
  }

  if (message.type === "video_state") {
    if (state.role === "guest" && message.senderId === state.hostClientId) {
      addDebugLog(
        "video:recv",
        `动作=${message.action} time=${Number(message.currentTime || 0).toFixed(2)} paused=${Boolean(message.paused)}`
      );
      state.lastRemoteVideoState = message;
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
    setStatus(false, messageMap[message.message] || "连接异常");
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
  }, { speak: false });
}

function appendPresenceMessage(nickname, actionText) {
  appendChatMessage(
    {
      nickname,
      text: actionText,
      sentAt: Date.now(),
    },
    { speak: false }
  );
}

function appendChatMessage(message, options = {}) {
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
  if (message.senderId === state.clientId) {
    item.classList.add("bt-chat-item-self");
  }
  if ((message.nickname || "") === "系统") {
    item.classList.add("bt-chat-item-system");
  }
  const time = new Date(message.sentAt || Date.now()).toLocaleTimeString();
  item.innerHTML = `<div class="bt-chat-meta"><strong>${escapeHtml(message.nickname || "Guest")}</strong><span>${time}</span></div><div class="bt-chat-text">${escapeHtml(message.text || "")}</div>`;
  elements.chatList.appendChild(item);
  elements.chatList.scrollTop = elements.chatList.scrollHeight;

  if (options.speak) {
    maybeSpeakMessage(message);
  }
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
  }, { speak: false });
}

function watchVideo() {
  const installListeners = () => {
    const video = getVideoElement();
    if (!video || video.dataset.btBound === "1") {
      return;
    }

    video.dataset.btBound = "1";
    addDebugLog("video:bind", describeVideo(video));
    video.addEventListener("play", () => sendVideoState("play"));
    video.addEventListener("pause", () => sendVideoState("pause"));
    video.addEventListener("seeked", () => sendVideoState("seeked"));
    video.addEventListener("ratechange", () => sendVideoState("ratechange"));
  };

  installListeners();
  const observer = new MutationObserver(installListeners);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function installGuestPlaybackGuard() {
  const bindGuard = () => {
    const video = getVideoElement();
    if (!video || video.dataset.btGuestGuardBound === "1") {
      return;
    }

    video.dataset.btGuestGuardBound = "1";
    video.addEventListener("play", () => {
      if (state.role !== "guest" || Date.now() < state.suppressUntil) {
        return;
      }

      if (state.lastRemoteVideoState?.paused) {
        state.suppressUntil = Date.now() + 800;
        video.pause();
      }
    });
  };

  bindGuard();
  const observer = new MutationObserver(bindGuard);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function installVisibilitySync() {
  document.addEventListener("visibilitychange", () => {
    if (state.role !== "host" || !state.isConnected) {
      return;
    }

    window.setTimeout(() => {
      syncCurrentVideoState();
    }, 300);
  });
}

function startHostSyncLoop() {
  if (state.hostSyncTimer) {
    clearInterval(state.hostSyncTimer);
  }

  state.hostSyncTimer = window.setInterval(() => {
    if (state.role !== "host" || !state.isConnected || Date.now() < state.suppressUntil) {
      return;
    }

    const video = getVideoElement();
    if (!video) {
      return;
    }

    sendVideoState("heartbeat");
  }, 1200);
}

function startHostObserveLoop() {
  if (state.hostObserveTimer) {
    clearInterval(state.hostObserveTimer);
  }

  state.hostObserveTimer = window.setInterval(() => {
    if (state.role !== "host" || !state.isConnected || Date.now() < state.suppressUntil) {
      return;
    }

    const video = getVideoElement();
    if (!video) {
      state.lastObservedVideoState = null;
      return;
    }

    const observed = {
      currentTime: Number(video.currentTime.toFixed(2)),
      paused: video.paused,
      playbackRate: Number(video.playbackRate.toFixed(2)),
      url: location.href,
    };

    if (!state.lastObservedVideoState) {
      state.lastObservedVideoState = observed;
      return;
    }

    const timeDiff = Math.abs(observed.currentTime - state.lastObservedVideoState.currentTime);
    const pauseChanged = observed.paused !== state.lastObservedVideoState.paused;
    const rateChanged = Math.abs(observed.playbackRate - state.lastObservedVideoState.playbackRate) > 0.01;
    const urlChanged = observed.url !== state.lastObservedVideoState.url;

    if (pauseChanged || rateChanged || urlChanged || timeDiff > (observed.paused ? 0.35 : 1.1)) {
      sendVideoState(pauseChanged ? "state-change" : "state-observe");
    }

    state.lastObservedVideoState = observed;
  }, 350);
}

function startGuestEnforceLoop() {
  if (state.guestEnforceTimer) {
    clearInterval(state.guestEnforceTimer);
  }

  state.guestEnforceTimer = window.setInterval(() => {
    if (state.role !== "guest" || !state.lastRemoteVideoState) {
      return;
    }

    const video = getVideoElement();
    if (!video) {
      return;
    }

    if (state.lastRemoteVideoState.paused && !video.paused && Date.now() > state.suppressUntil) {
      state.suppressUntil = Date.now() + 600;
      video.pause();
      return;
    }

    if (!state.lastRemoteVideoState.paused && video.paused && Date.now() > state.suppressUntil) {
      state.suppressUntil = Date.now() + 600;
      video.play().catch(() => {});
      return;
    }

    if (
      state.lastRemoteVideoState.playbackRate &&
      Math.abs(video.playbackRate - state.lastRemoteVideoState.playbackRate) > 0.01 &&
      Date.now() > state.suppressUntil
    ) {
      state.suppressUntil = Date.now() + 600;
      video.playbackRate = state.lastRemoteVideoState.playbackRate;
    }

    const remoteTime = Number(state.lastRemoteVideoState.currentTime || 0);
    const timeThreshold = state.lastRemoteVideoState.paused ? 0.35 : 0.9;
    if (Math.abs(video.currentTime - remoteTime) > timeThreshold && Date.now() > state.suppressUntil) {
      state.suppressUntil = Date.now() + 600;
      video.currentTime = remoteTime;
    }
  }, 350);
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
  addDebugLog("navigate:send", shortUrl(url));
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
  addDebugLog(
    "video:send",
    `动作=${action} time=${payload.currentTime.toFixed(2)} paused=${payload.paused}`
  );
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
      addDebugLog("video:apply", "未找到视频元素");
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
    addDebugLog(
      "video:apply",
      `已应用 time=${targetTime.toFixed(2)} paused=${Boolean(message.paused)} localPaused=${video.paused}`
    );
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
  const candidates = VIDEO_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  const unique = [...new Set(candidates)];

  if (unique.length === 0) {
    return null;
  }

  return unique
    .filter((video) => video instanceof HTMLVideoElement)
    .sort((a, b) => {
      const areaA = (a.clientWidth || 0) * (a.clientHeight || 0);
      const areaB = (b.clientWidth || 0) * (b.clientHeight || 0);
      return areaB - areaA;
    })[0] || null;
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

function clearChatIfFreshJoin(force = false) {
  const existingItems = elements.chatList.querySelectorAll(".bt-chat-item");
  if (force || existingItems.length > 60) {
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
    if (state.rememberPanel) {
      persistUiState();
    }
    render();
  });

  const stopDrag = (event) => {
    if (state.dragPointerId !== event.pointerId) {
      return;
    }
    state.dragPointerId = null;
    elements.dragHandle.releasePointerCapture(event.pointerId);
    if (state.rememberPanel) {
      persistUiState();
    }
  };

  elements.dragHandle.addEventListener("pointerup", stopDrag);
  elements.dragHandle.addEventListener("pointercancel", stopDrag);

  const resizeObserver = new ResizeObserver(() => {
    if (state.collapsed) {
      return;
    }

    const rect = elements.panel.getBoundingClientRect();
    state.panelWidth = Math.round(rect.width);
    state.panelHeight = Math.round(rect.height);
    if (state.rememberPanel) {
      persistUiState();
    }
  });
  resizeObserver.observe(elements.panel);
}

function sendToBackground(payload) {
  chrome.runtime.sendMessage({
    type: "bt:send",
    payload,
  });
}

function maybeSpeakMessage(message) {
  if (!state.speechEnabled || !window.speechSynthesis) {
    return;
  }

  if (!message.text || message.nickname === "系统") {
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice =
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("zh")) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("en")) ||
    null;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(`${message.text}`);
  utterance.lang = "zh-CN";
  if (preferredVoice) {
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang || "zh-CN";
  }
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

async function persistUiState() {
  await chrome.storage.local.set({
    panelX: state.rememberPanel ? state.panelX : null,
    panelY: state.rememberPanel ? state.panelY : 88,
    panelWidth: state.rememberPanel ? state.panelWidth : 348,
    panelHeight: state.rememberPanel ? state.panelHeight : 620,
    collapsed: state.rememberPanel ? state.collapsed : false,
    rememberPanel: state.rememberPanel,
    speechEnabled: state.speechEnabled,
  });
}

function initSpeechVoices() {
  if (!window.speechSynthesis) {
    return;
  }

  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    state.voicesReady = true;
  });
}

function speakPreview() {
  if (!state.speechEnabled) {
    return;
  }

  maybeSpeakMessage({
    nickname: "提示",
    text: "朗读已开启",
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "bt:server-message") {
    handleServerMessage(message.payload);
    return;
  }

  if (message.type === "bt:socket") {
    if (message.event === "open") {
      addDebugLog("socket", "连接已建立");
      setStatus(true, `${roleText(state.role)}已连接`);
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      render();
      return;
    }

    if (message.event === "close") {
      addDebugLog("socket", "连接关闭");
      setStatus(false, state.sessionId ? "连接断开，正在重试..." : "连接断开");
      render();
      return;
    }

    if (message.event === "error") {
      addDebugLog("socket", "连接错误");
      setStatus(false, "连接错误");
      render();
    }
  }
});

function addDebugLog(tag, text) {
  const entry = {
    tag,
    text,
    at: new Date().toLocaleTimeString(),
  };
  state.debugLogs.unshift(entry);
  state.debugLogs = state.debugLogs.slice(0, 200);
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function describeVideo(video) {
  return `video ${video.clientWidth}x${video.clientHeight} paused=${video.paused} time=${video.currentTime.toFixed(2)}`;
}

function exportDebugLog() {
  const lines = [
    `时间: ${new Date().toLocaleString()}`,
    `身份: ${roleText(state.role)}`,
    `房间: ${state.sessionId || "(空)"}`,
    `页面: ${location.href}`,
    "",
    ...state.debugLogs.map((item) => `[${item.at}] ${item.tag} ${item.text}`),
  ];

  chrome.runtime.sendMessage({
    type: "bt:download-log",
    filename: `bilibili-together-log-${createTimestamp()}.txt`,
    content: lines.join("\n"),
  });
}

function createTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
