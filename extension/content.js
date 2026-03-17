const STORAGE_KEYS = [
  "sessionId",
  "nickname",
  "clientId",
  "role",
  "serverUrl",
  "serverLocked",
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
  serverUrl: "",
  serverLocked: false,
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
  dragSource: null,
  dragMoved: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  panelX: null,
  panelY: 88,
  panelWidth: 272,
  panelHeight: 304,
  voicesReady: false,
  hostSyncTimer: null,
  guestEnforceTimer: null,
  hostObserveTimer: null,
  lastObservedVideoState: null,
  fullscreenMode: false,
  fullscreenDockX: null,
  fullscreenDockY: null,
  chatMessages: [],
  speechQueue: [],
  speechPlaying: false,
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
  state.clientId = stored.clientId || crypto.randomUUID();
  state.role = stored.role === "host" ? "host" : "guest";
  state.nickname = state.role === "host" ? "主" : "客";
  state.serverUrl = normalizeServerUrl(stored.serverUrl || "");
  state.serverLocked = Boolean(stored.serverLocked && state.serverUrl);
  state.speechEnabled = Boolean(stored.speechEnabled);
  state.rememberPanel = stored.rememberPanel !== false;
  state.collapsed = Boolean(stored.collapsed);
  state.panelX = typeof stored.panelX === "number" ? stored.panelX : null;
  state.panelY = typeof stored.panelY === "number" ? stored.panelY : 88;
  state.panelWidth = typeof stored.panelWidth === "number" ? stored.panelWidth : 272;
  state.panelHeight = typeof stored.panelHeight === "number" ? stored.panelHeight : 304;

  await chrome.storage.local.set({
    sessionId: state.sessionId,
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
    serverUrl: state.serverUrl,
    serverLocked: state.serverLocked,
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
  installFullscreenWatcher();

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
    <div class="bt-fullscreen-dock" data-role="fullscreenDock">
      <div class="bt-fullscreen-chip" data-role="fullscreenRole">客</div>
      <form class="bt-fullscreen-form" data-role="fullscreenForm">
        <input data-role="fullscreenInput" placeholder="发送一条消息" maxlength="500" />
        <button type="submit">发送</button>
      </form>
    </div>
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
          <div class="bt-hero-chip bt-hero-chip-muted" data-role="serverBadge">未设置服务器</div>
        </div>
        <div class="bt-settings" data-role="settingsPanel">
          <div class="bt-settings-title">常用设置</div>
          <label class="bt-toggle">
            <span>服务器地址</span>
            <div class="bt-server-row">
              <input data-role="serverUrl" type="text" placeholder="ws://localhost:8787" />
              <button class="bt-server-btn" data-role="serverToggle" type="button">记住</button>
            </div>
          </label>
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
          <label>身份</label>
          <div class="bt-inline-row">
            <label class="bt-role-option bt-inline-cell">
              <input data-role="hostRadio" type="radio" name="bt-role" value="host" />
              <span>主人</span>
            </label>
            <label class="bt-role-option bt-inline-cell">
              <input data-role="guestRadio" type="radio" name="bt-role" value="guest" />
              <span>客人</span>
            </label>
            <button data-role="save" class="bt-inline-action" type="button">进入</button>
            <button data-role="leave" class="bt-inline-action secondary" type="button">退出</button>
          </div>
        </div>
        <div class="bt-meta-card">
          <div class="bt-presence" data-role="presence">在线人数：0/2</div>
          <div class="bt-hint" data-role="hint">主人控制页面跟随、播放、暂停和拖动，客人只负责跟随。</div>
        </div>
        <form class="bt-chat-form" data-role="chatForm">
          <input data-role="chatInput" placeholder="发送一条消息" maxlength="500" />
          <button type="submit">发送</button>
        </form>
        <div class="bt-chat-list" data-role="chatList"></div>
      </div>
    </div>
  `;

  elements.panel = root.querySelector(".bt-panel");
  elements.miniLauncher = root.querySelector('[data-role="miniLauncher"]');
  elements.fullscreenDock = root.querySelector('[data-role="fullscreenDock"]');
  elements.fullscreenRole = root.querySelector('[data-role="fullscreenRole"]');
  elements.fullscreenForm = root.querySelector('[data-role="fullscreenForm"]');
  elements.fullscreenInput = root.querySelector('[data-role="fullscreenInput"]');
  elements.status = root.querySelector('[data-role="status"]');
  elements.sessionId = root.querySelector('[data-role="sessionId"]');
  elements.hostRadio = root.querySelector('[data-role="hostRadio"]');
  elements.guestRadio = root.querySelector('[data-role="guestRadio"]');
  elements.roleBadge = root.querySelector('[data-role="roleBadge"]');
  elements.serverBadge = root.querySelector('[data-role="serverBadge"]');
  elements.presence = root.querySelector('[data-role="presence"]');
  elements.hint = root.querySelector('[data-role="hint"]');
  elements.body = root.querySelector('[data-role="body"]');
  elements.dragHandle = root.querySelector('[data-role="dragHandle"]');
  elements.settingsPanel = root.querySelector('[data-role="settingsPanel"]');
  elements.speechEnabled = root.querySelector('[data-role="speechEnabled"]');
  elements.rememberPanel = root.querySelector('[data-role="rememberPanel"]');
  elements.serverUrl = root.querySelector('[data-role="serverUrl"]');
  elements.serverToggle = root.querySelector('[data-role="serverToggle"]');
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
    if (state.dragMoved) {
      state.dragMoved = false;
      return;
    }
    state.collapsed = false;
    state.panelVisible = true;
    persistUiState();
    render();
  });
  root.querySelector('[data-role="settings"]').addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    render();
  });
  elements.serverToggle.addEventListener("click", handleServerToggle);
  elements.speechEnabled.addEventListener("change", async () => {
    state.speechEnabled = elements.speechEnabled.checked;
    await persistUiState();
    if (state.speechEnabled) {
      speakPreview();
    } else if (window.speechSynthesis) {
      state.speechQueue = [];
      state.speechPlaying = false;
      window.speechSynthesis.cancel();
    }
  });
  elements.rememberPanel.addEventListener("change", async () => {
    state.rememberPanel = elements.rememberPanel.checked;
    if (!state.rememberPanel) {
      state.panelX = null;
      state.panelY = 88;
      state.panelWidth = 272;
      state.panelHeight = 304;
      state.collapsed = false;
    }
    await persistUiState();
    render();
  });
  root.querySelector('[data-role="exportLog"]').addEventListener("click", exportDebugLog);

  root.querySelector('[data-role="save"]').addEventListener("click", saveSettings);
  root.querySelector('[data-role="leave"]').addEventListener("click", leaveRoom);
  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage();
  });
  elements.fullscreenForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatMessage(elements.fullscreenInput);
  });
  initDrag();

  render();
}

function render() {
  if (!elements.panel) {
    return;
  }

  elements.panel.style.display = state.fullscreenMode ? "none" : state.panelVisible && !state.collapsed ? "flex" : "none";
  elements.miniLauncher.style.display = !state.panelVisible || state.collapsed ? "inline-flex" : "none";
  elements.fullscreenDock.style.display = state.fullscreenMode ? "flex" : "none";
  elements.fullscreenDock.style.left = state.fullscreenDockX == null ? "50%" : `${state.fullscreenDockX}px`;
  elements.fullscreenDock.style.top = state.fullscreenDockY == null ? "18px" : `${state.fullscreenDockY}px`;
  elements.fullscreenDock.style.transform = state.fullscreenDockX == null ? "translateX(-50%)" : "none";
  elements.fullscreenRole.textContent = state.role === "host" ? "主" : "客";
  elements.panel.style.left = state.panelX == null ? "auto" : `${state.panelX}px`;
  elements.panel.style.right = state.panelX == null ? "20px" : "auto";
  elements.panel.style.top = `${state.panelY}px`;
  elements.panel.style.width = `${state.panelWidth}px`;
  elements.panel.style.height = `${state.panelHeight}px`;
  elements.miniLauncher.style.left = state.panelX == null ? "auto" : `${state.panelX}px`;
  elements.miniLauncher.style.right = state.panelX == null ? "20px" : "auto";
  elements.miniLauncher.style.top = `${state.panelY}px`;
  elements.sessionId.value = state.sessionId;
  elements.hostRadio.checked = state.role === "host";
  elements.guestRadio.checked = state.role !== "host";
  elements.roleBadge.textContent = state.role === "host" ? "主人模式" : "客人模式";
  elements.serverBadge.textContent = getServerBadgeText();
  elements.speechEnabled.checked = state.speechEnabled;
  elements.rememberPanel.checked = state.rememberPanel;
  elements.serverUrl.value = state.serverUrl;
  elements.serverUrl.disabled = state.serverLocked;
  elements.serverToggle.textContent = state.serverLocked ? "编辑" : "记住";
  elements.settingsPanel.style.display = state.settingsOpen ? "flex" : "none";
  elements.body.style.display = state.collapsed ? "none" : "flex";
  elements.panel.classList.toggle("bt-panel-fullscreen", state.fullscreenMode);
  root.querySelector('[data-role="collapse"]').textContent = state.collapsed ? "+" : "-";
  elements.panel.classList.toggle("bt-panel-collapsed", state.collapsed);
  elements.status.textContent = state.isConnected ? `${roleText(state.role)}已连接` : elements.status.textContent;
  elements.presence.textContent = `在线人数：${state.users.length}/2`;
  elements.chatInput.disabled = !state.isConnected;
  elements.fullscreenInput.disabled = !state.isConnected;
  elements.hint.textContent =
    state.role === "host"
      ? "你是主人。你在 B 站里的页面切换、播放、暂停和拖动会驱动客人。"
      : "你是客人。你会跟随主人在 B 站里的页面和视频状态。";
  renderChatMessages();
}

async function saveSettings() {
  state.sessionId = elements.sessionId.value.trim();
  state.role = elements.hostRadio.checked ? "host" : "guest";
  state.nickname = state.role === "host" ? "主" : "客";
  state.speechEnabled = elements.speechEnabled.checked;
  state.rememberPanel = elements.rememberPanel.checked;

  const serverReady = await ensureServerReady();
  if (!serverReady.ok) {
    setStatus(false, serverReady.message);
    render();
    return;
  }

  await chrome.storage.local.set({
    sessionId: state.sessionId,
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
    serverUrl: state.serverUrl,
    serverLocked: state.serverLocked,
    speechEnabled: state.speechEnabled,
    rememberPanel: state.rememberPanel,
    panelX: state.rememberPanel ? state.panelX : null,
    panelY: state.rememberPanel ? state.panelY : 88,
    panelWidth: state.rememberPanel ? state.panelWidth : 272,
    panelHeight: state.rememberPanel ? state.panelHeight : 304,
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
  if (!state.serverUrl) {
    setStatus(false, "请先在设置里填写服务器地址");
    render();
    return;
  }

  addDebugLog("connect", `准备连接 ${state.serverUrl} 房间 ${state.sessionId}，身份：${roleText(state.role)}`);
  setStatus(false, "连接中...");
  render();
  chrome.runtime.sendMessage({
    type: "bt:connect",
    serverUrl: state.serverUrl,
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
  state.chatMessages = [];
  state.chatListClearedAt = Date.now();
  clearChatIfFreshJoin(true);
  setStatus(false, "已退出房间");
  state.panelVisible = !hidePanel;
  state.collapsed = false;
  await chrome.storage.local.set({
    sessionId: state.sessionId,
    nickname: state.nickname,
    clientId: state.clientId,
    role: state.role,
    serverUrl: state.serverUrl,
    serverLocked: state.serverLocked,
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
    appendPresenceMessage(message.role === "host" ? "主" : "客", "加入了房间");
    return;
  }

  if (message.type === "peer_left") {
    const leavingUser = state.users.find((user) => user.clientId === message.clientId);
    appendPresenceMessage(leavingUser?.role === "host" ? "主" : "客", "离开了房间");
    return;
  }

  if (message.type === "chat_message") {
    appendChatMessage(message, {
      speak: true,
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
      if (message.url && message.url !== location.href) {
        navigateTo(message.url);
        return;
      }
      addDebugLog(
        "video:recv",
        `动作=${message.action} time=${Number(message.currentTime || 0).toFixed(2)} paused=${Boolean(message.paused)}`
      );
      state.lastRemoteVideoState = message;
      applyRemoteVideoState(message);
    }
    return;
  }

  if (message.type === "sync_ack" && state.role === "host") {
    setStatus(true, `客人已同步 ${new Date(message.sentAt || Date.now()).toLocaleTimeString()}`);
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

function appendPresenceMessage(roleLabel, actionText) {
  appendChatMessage(
    {
      nickname: roleLabel,
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

  state.chatMessages.push(message);
  state.chatMessages = state.chatMessages.slice(-100);
  renderChatMessages();

  if (options.speak) {
    maybeSpeakMessage(message);
  }
}

function sendChatMessage(inputElement = elements.chatInput) {
  const text = inputElement.value.trim();
  if (!text || !state.isConnected) {
    return;
  }

  elements.chatInput.value = "";
  elements.fullscreenInput.value = "";
  sendToBackground({ type: "chat_message", text });
  appendChatMessage({
    senderId: state.clientId,
    nickname: state.role === "host" ? "主" : "客",
    text,
    sentAt: Date.now(),
  }, { speak: true });
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

function installFullscreenWatcher() {
  const updateFullscreenMode = () => {
    const fullscreenHost = getFullscreenHost();
    state.fullscreenMode = Boolean(fullscreenHost);

    if (fullscreenHost && root.parentElement !== fullscreenHost) {
      fullscreenHost.appendChild(root);
    } else if (!fullscreenHost && root.parentElement !== document.documentElement) {
      document.documentElement.appendChild(root);
    }

    render();
  };

  document.addEventListener("fullscreenchange", updateFullscreenMode);
  document.addEventListener("webkitfullscreenchange", updateFullscreenMode);
  window.addEventListener("resize", updateFullscreenMode);
  updateFullscreenMode();
}

function getFullscreenHost() {
  const nativeFullscreenHost = document.fullscreenElement || document.webkitFullscreenElement;
  if (nativeFullscreenHost instanceof Element) {
    return nativeFullscreenHost;
  }

  const video = getVideoElement();
  if (!video) {
    return null;
  }

  const rect = video.getBoundingClientRect();
  const coversViewport =
    rect.width >= window.innerWidth * 0.72 &&
    rect.height >= window.innerHeight * 0.72;

  if (!coversViewport) {
    return null;
  }

  return (
    video.closest(".bpx-player-container") ||
    video.closest(".bpx-player-video-wrap") ||
    video.parentElement ||
    null
  );
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

  if (state.role === "guest") {
    sendToBackground({
      type: "sync_ack",
      kind: "video",
      url: message.url || location.href,
      currentTime: Number(message.currentTime || 0),
    });
  }
}

function navigateTo(url) {
  if (!isBilibiliUrl(url)) {
    return;
  }
  state.suppressUntil = Date.now() + 3000;
  location.href = url;
  if (state.role === "guest") {
    window.setTimeout(() => {
      sendToBackground({
        type: "sync_ack",
        kind: "navigate",
        url,
      });
    }, 1200);
  }
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
    state.chatMessages = [];
  }
}

function renderChatMessages() {
  if (!elements.chatList) {
    return;
  }

  const visibleMessages = state.chatMessages.slice(-6).reverse();
  elements.chatList.innerHTML = "";

  for (const message of visibleMessages) {
    const item = document.createElement("div");
    item.className = "bt-chat-item";
    if (message.senderId === state.clientId) {
      item.classList.add("bt-chat-item-self");
    }
    if ((message.nickname || "") === "系统") {
      item.classList.add("bt-chat-item-system");
    }
    const time = new Date(message.sentAt || Date.now()).toLocaleTimeString();
    item.innerHTML = `<div class="bt-chat-meta"><strong>${escapeHtml(resolveChatLabel(message))}</strong><span>${time}</span></div><div class="bt-chat-text">${escapeHtml(message.text || "")}</div>`;
    elements.chatList.appendChild(item);
  }
}

function roleText(role) {
  return role === "host" ? "主人" : "客人";
}

function roleShortText(role) {
  return role === "host" ? "主" : "客";
}

function getServerBadgeText() {
  if (state.isConnected && state.serverUrl) {
    return `已连接 ${shortServerLabel(state.serverUrl)}`;
  }
  if (state.serverLocked && state.serverUrl) {
    return shortServerLabel(state.serverUrl);
  }
  if (state.serverUrl) {
    return "未连接服务器";
  }
  return "未设置服务器";
}

function normalizeServerUrl(input) {
  const value = String(input || "").trim();
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    if (!["ws:", "wss:"].includes(url.protocol)) {
      return "";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function shortServerLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return "未设置服务器";
  }
}

async function handleServerToggle() {
  if (state.serverLocked) {
    state.serverLocked = false;
    await chrome.storage.local.set({ serverLocked: false });
    setStatus(false, "服务器地址可编辑");
    render();
    return;
  }

  const result = await ensureServerReady();
  setStatus(result.ok, result.message);
  render();
}

async function ensureServerReady() {
  const nextServerUrl = normalizeServerUrl(elements.serverUrl?.value || state.serverUrl);
  if (!nextServerUrl) {
    state.serverLocked = false;
    return { ok: false, message: "请填写正确的服务器地址" };
  }

  const response = await chrome.runtime.sendMessage({
    type: "bt:test-server",
    serverUrl: nextServerUrl,
  });

  if (!response?.ok) {
    state.serverLocked = false;
    return { ok: false, message: "服务器连接失败" };
  }

  state.serverUrl = nextServerUrl;
  state.serverLocked = true;
  await chrome.storage.local.set({
    serverUrl: state.serverUrl,
    serverLocked: true,
  });
  return { ok: true, message: "服务器已连接" };
}

function resolveChatLabel(message) {
  if ((message.nickname || "") === "系统") {
    return "系统";
  }

  if (message.senderId) {
    if (message.senderId === state.hostClientId) {
      return "主";
    }
    if (message.senderId === state.clientId) {
      return roleShortText(state.role);
    }
    return state.role === "host" ? "客" : "主";
  }

  if (message.role) {
    return roleShortText(message.role);
  }

  return "消息";
}

function initDrag() {
  const getDragWidth = (targetElement) => {
    if (targetElement === elements.miniLauncher) {
      return targetElement.offsetWidth;
    }
    if (targetElement === elements.fullscreenDock) {
      return targetElement.getBoundingClientRect().width || targetElement.offsetWidth;
    }
    if (state.fullscreenMode) {
      return elements.panel.getBoundingClientRect().width || elements.panel.offsetWidth;
    }
    return elements.panel.offsetWidth;
  };

  const startDrag = (event, targetElement, captureElement = targetElement) => {
    if (event.target.closest(".bt-icon-btn")) {
      return;
    }
    if (event.target.closest("input, button") && targetElement === elements.fullscreenDock) {
      return;
    }

    const rect = targetElement.getBoundingClientRect();
    state.dragPointerId = event.pointerId;
    state.dragSource = targetElement === elements.miniLauncher ? "mini" : "panel";
    state.dragMoved = false;
    state.dragOffsetX = event.clientX - rect.left;
    state.dragOffsetY = event.clientY - rect.top;
    if (targetElement === elements.fullscreenDock) {
      state.fullscreenDockX = rect.left;
      state.fullscreenDockY = rect.top;
    } else {
      state.panelX = rect.left;
      state.panelY = rect.top;
    }
    captureElement.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event, targetElement) => {
    if (state.dragPointerId !== event.pointerId) {
      return;
    }

    state.dragMoved = true;
    const width = getDragWidth(targetElement);
    const nextX = Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - state.dragOffsetX));
    const nextY = Math.max(8, Math.min(window.innerHeight - 48, event.clientY - state.dragOffsetY));
    if (targetElement === elements.fullscreenDock) {
      state.fullscreenDockX = nextX;
      state.fullscreenDockY = nextY;
    } else {
      state.panelX = nextX;
      state.panelY = nextY;
    }
    if (state.rememberPanel) {
      persistUiState();
    }
    render();
  };

  const stopDrag = (event, targetElement, captureElement = targetElement) => {
    if (state.dragPointerId !== event.pointerId) {
      return;
    }
    state.dragPointerId = null;
    state.dragSource = null;
    captureElement.releasePointerCapture(event.pointerId);
    if (state.rememberPanel) {
      persistUiState();
    }
  };

  elements.dragHandle.addEventListener("pointerdown", (event) => startDrag(event, elements.panel, elements.dragHandle));
  elements.dragHandle.addEventListener("pointermove", (event) => moveDrag(event, elements.panel));
  elements.dragHandle.addEventListener("pointerup", (event) => stopDrag(event, elements.panel, elements.dragHandle));
  elements.dragHandle.addEventListener("pointercancel", (event) => stopDrag(event, elements.panel, elements.dragHandle));

  elements.miniLauncher.addEventListener("pointerdown", (event) => startDrag(event, elements.miniLauncher));
  elements.miniLauncher.addEventListener("pointermove", (event) => moveDrag(event, elements.miniLauncher));
  elements.miniLauncher.addEventListener("pointerup", (event) => stopDrag(event, elements.miniLauncher));
  elements.miniLauncher.addEventListener("pointercancel", (event) => stopDrag(event, elements.miniLauncher));
  elements.fullscreenDock.addEventListener("pointerdown", (event) => startDrag(event, elements.fullscreenDock));
  elements.fullscreenDock.addEventListener("pointermove", (event) => moveDrag(event, elements.fullscreenDock));
  elements.fullscreenDock.addEventListener("pointerup", (event) => stopDrag(event, elements.fullscreenDock));
  elements.fullscreenDock.addEventListener("pointercancel", (event) => stopDrag(event, elements.fullscreenDock));
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

  state.speechQueue.push(`${message.text}`);
  speakNextMessage();
}

async function persistUiState() {
  await chrome.storage.local.set({
    panelX: state.rememberPanel ? state.panelX : null,
    panelY: state.rememberPanel ? state.panelY : 88,
    panelWidth: state.rememberPanel ? state.panelWidth : 272,
    panelHeight: state.rememberPanel ? state.panelHeight : 304,
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

function speakNextMessage() {
  if (!state.speechEnabled || !window.speechSynthesis || state.speechPlaying || state.speechQueue.length === 0) {
    return;
  }

  const nextText = state.speechQueue.shift();
  if (!nextText) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice =
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("zh")) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("en")) ||
    null;

  const utterance = new SpeechSynthesisUtterance(nextText);
  utterance.lang = "zh-CN";
  if (preferredVoice) {
    utterance.voice = preferredVoice;
    utterance.lang = preferredVoice.lang || "zh-CN";
  }
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onend = () => {
    state.speechPlaying = false;
    speakNextMessage();
  };
  utterance.onerror = () => {
    state.speechPlaying = false;
    speakNextMessage();
  };
  state.speechPlaying = true;
  window.speechSynthesis.speak(utterance);
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
