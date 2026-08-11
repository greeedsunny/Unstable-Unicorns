export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = [];
    this.gameState = null; // Store active game state on the server
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    await this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleSession(socket) {
    socket.accept();
    const session = { socket, name: 'Anonymous', id: -1 };
    this.sessions.push(session);

    socket.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'JOIN_ROOM') {
          session.name = data.playerName || 'Anonymous';
          this.reindexPlayers();
          
          // Send specific player index back to this user
          socket.send(JSON.stringify({
            type: 'ASSIGN_INDEX',
            playerIndex: session.id
          }));

          // Broadcast updated player list to room
          this.broadcast({
            type: 'ROOM_UPDATE',
            players: this.sessions.map(s => ({ id: s.id, name: s.name }))
          });

          // If game has already started, immediately send current game state to joiner
          if (this.gameState) {
            socket.send(JSON.stringify({
              type: 'START_GAME',
              gameState: this.gameState,
              state: this.gameState
            }));
          }
        } 
        else if (data.type === 'START_GAME') {
          // Store initial game state sent by host
          this.gameState = data.gameState || data.state || null;
          
          // Broadcast START_GAME to ALL connected players
          this.broadcast(data);
        }
        else if (data.type === 'GAME_ACTION' || data.type === 'SYNC_STATE') {
          // Update cached game state
          if (data.gameState) this.gameState = data.gameState;
          if (data.state) this.gameState = data.state;

          // Broadcast state or action payload to all players in room
          this.broadcast(data);
        }
        else if (data.type === 'RESET_GAME') {
          this.gameState = null;
          this.broadcast(data);
        }
      } catch (err) {
        console.error("Error processing message:", err);
      }
    });

    socket.addEventListener('close', () => {
      this.sessions = this.sessions.filter(s => s.socket !== socket);
      this.reindexPlayers();
      this.broadcast({
        type: 'ROOM_UPDATE',
        players: this.sessions.map(s => ({ id: s.id, name: s.name }))
      });
    });

    socket.addEventListener('error', () => {
      this.sessions = this.sessions.filter(s => s.socket !== socket);
    });
  }

  reindexPlayers() {
    this.sessions.forEach((s, idx) => {
      s.id = idx;
    });
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    // Send to all active sessions and automatically prune dead sockets
    this.sessions = this.sessions.filter(s => {
      try {
        s.socket.send(payload);
        return true;
      } catch (e) {
        return false;
      }
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith('/api/room/')) {
      const roomCode = url.pathname.split('/')[3].toUpperCase();
      const roomId = env.GAME_ROOM.idFromName(roomCode);
      const roomObject = env.GAME_ROOM.get(roomId);
      return roomObject.fetch(request);
    }

    return new Response("Unstable Unicorns Durable Object Server Active", { status: 200 });
  }
};