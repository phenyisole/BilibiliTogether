import http from "http";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT || 8787);
const maxRoomSize = 2;
const rooms = new Map();
const heartbeatIntervalMs = 30000;

function getRoom(sessionId) {
  if (!rooms.has(sessionId)) {
    rooms.set(sessionId, {
      clients: new Map(),
      lastVideoState: null,
      lastNavigate: null,
      chatHistory: [],
    });
  }

  return rooms.get(sessionId);
}

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function roomUsers(room) {
  return Array.from(room.clients.values()).map((client) => ({
    clientId: client.clientId,
    nickname: client.nickname,
  }));
}

function broadcast(sessionId, payload, exceptClientId = null) {
  const room = rooms.get(sessionId);
  if (!room) {
    return;
  }

  for (const [clientId, client] of room.clients.entries()) {
    if (clientId === exceptClientId) {
      continue;
    }
    safeSend(client.ws, payload);
  }
}

function emitPresence(sessionId) {
  const room = rooms.get(sessionId);
  if (!room) {
    return;
  }

  broadcast(sessionId, {
    type: "presence",
    sessionId,
    users: roomUsers(room),
  });
}

function cleanupRoom(sessionId) {
  const room = rooms.get(sessionId);
  if (!room) {
    return;
  }

  if (room.clients.size === 0) {
    rooms.delete(sessionId);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bilibili Together MVP signaling server");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let joinedSessionId = null;
  let joinedClientId = null;
  ws.isAlive = true;

  safeSend(ws, {
    type: "hello",
    message: "connected",
    serverTime: Date.now(),
  });

  ws.on("message", (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch {
      safeSend(ws, { type: "error", message: "invalid_json" });
      return;
    }

    if (data.type === "join") {
      const sessionId = String(data.sessionId || "").trim();
      const clientId = String(data.clientId || "").trim();
      const nickname = String(data.nickname || "Guest").slice(0, 24);

      if (!sessionId || !clientId) {
        safeSend(ws, { type: "error", message: "missing_join_fields" });
        return;
      }

      const room = getRoom(sessionId);
      if (!room.clients.has(clientId) && room.clients.size >= maxRoomSize) {
        safeSend(ws, { type: "error", message: "room_full" });
        return;
      }

      if (joinedSessionId && joinedClientId && (joinedSessionId !== sessionId || joinedClientId !== clientId)) {
        const previousRoom = rooms.get(joinedSessionId);
        previousRoom?.clients.delete(joinedClientId);
        emitPresence(joinedSessionId);
        cleanupRoom(joinedSessionId);
      }

      joinedSessionId = sessionId;
      joinedClientId = clientId;

      room.clients.set(clientId, {
        ws,
        clientId,
        nickname,
      });

      safeSend(ws, {
        type: "joined",
        sessionId,
        clientId,
        users: roomUsers(room),
        lastVideoState: room.lastVideoState,
        lastNavigate: room.lastNavigate,
        chatHistory: room.chatHistory.slice(-30),
      });

      broadcast(
        sessionId,
        {
          type: "peer_joined",
          sessionId,
          clientId,
          nickname,
        },
        clientId
      );
      emitPresence(sessionId);
      return;
    }

    if (!joinedSessionId || !joinedClientId) {
      safeSend(ws, { type: "error", message: "join_required" });
      return;
    }

    const room = rooms.get(joinedSessionId);
    if (!room) {
      safeSend(ws, { type: "error", message: "room_missing" });
      return;
    }

    if (data.type === "video_state") {
      const payload = {
        type: "video_state",
        sessionId: joinedSessionId,
        senderId: joinedClientId,
        action: data.action,
        currentTime: Number(data.currentTime || 0),
        paused: Boolean(data.paused),
        playbackRate: Number(data.playbackRate || 1),
        url: typeof data.url === "string" ? data.url : "",
        sentAt: Date.now(),
      };

      room.lastVideoState = payload;
      broadcast(joinedSessionId, payload, joinedClientId);
      return;
    }

    if (data.type === "navigate") {
      const payload = {
        type: "navigate",
        sessionId: joinedSessionId,
        senderId: joinedClientId,
        url: String(data.url || ""),
        sentAt: Date.now(),
      };

      room.lastNavigate = payload;
      broadcast(joinedSessionId, payload, joinedClientId);
      return;
    }

    if (data.type === "chat_message") {
      const text = String(data.text || "").trim().slice(0, 500);
      if (!text) {
        return;
      }

      const message = {
        type: "chat_message",
        sessionId: joinedSessionId,
        senderId: joinedClientId,
        nickname: room.clients.get(joinedClientId)?.nickname || "Guest",
        text,
        sentAt: Date.now(),
      };

      room.chatHistory.push(message);
      room.chatHistory = room.chatHistory.slice(-100);
      broadcast(joinedSessionId, message);
      return;
    }

    safeSend(ws, { type: "error", message: "unknown_type" });
  });

  ws.on("close", () => {
    if (!joinedSessionId || !joinedClientId) {
      return;
    }

    const room = rooms.get(joinedSessionId);
    if (!room) {
      return;
    }

    room.clients.delete(joinedClientId);
    broadcast(joinedSessionId, {
      type: "peer_left",
      sessionId: joinedSessionId,
      clientId: joinedClientId,
    });
    emitPresence(joinedSessionId);
    cleanupRoom(joinedSessionId);
  });

  ws.on("pong", () => {
    ws.isAlive = true;
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }
}, heartbeatIntervalMs);

wss.on("close", () => {
  clearInterval(heartbeat);
});

server.listen(port, () => {
  console.log(`Bilibili Together MVP server listening on :${port}`);
});
