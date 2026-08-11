import { DurableObject } from "cloudflare:workers";

// 1. Worker Router: Upgrades client connections to WebSockets and routes them to a specific room
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Route format: /api/room/ROOMCODE
    if (url.pathname.startsWith("/api/room/")) {
      const roomCode = url.pathname.split("/")[3]?.toUpperCase();
      if (!roomCode) return new Response("Room code required", { status: 400 });

      // Find or create the Durable Object instance for this room
      const id = env.GAME_ROOM.idFromName(roomCode);
      const roomObject = env.GAME_ROOM.get(id);

      return roomObject.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};

// 2. Durable Object Class: Manages state and WebSockets for a single Game Room
export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map(); // Stores active WebSocket connections
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();

    const playerId = crypto.randomUUID();
    this.sessions.set(server, { id: playerId, name: "Player" });

    // Handle messages sent from clients over WebSocket
    server.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "JOIN_ROOM") {
          this.sessions.get(server).name = message.playerName;
          this.broadcast({
            type: "ROOM_UPDATE",
            players: Array.from(this.sessions.values())
          });
        }
      } catch (err) {
        console.error("Invalid JSON message:", err);
      }
    });

    // Handle client disconnects
    server.addEventListener("close", () => {
      this.sessions.delete(server);
      this.broadcast({
        type: "ROOM_UPDATE",
        players: Array.from(this.sessions.values())
      });
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Helper method to send messages to all players in the room
  broadcast(message) {
    const msgString = JSON.stringify(message);
    this.sessions.forEach((session, ws) => {
      try {
        ws.send(msgString);
      } catch {
        this.sessions.delete(ws);
      }
    });
  }
}