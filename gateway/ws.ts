import type { LeaderSource } from "./leader";
import { StrokeSchema } from "./types";
import type { WSEvents, WSContext } from "hono/ws";

type Logger = Pick<Console, "error" | "log">;
type FetchImpl = typeof fetch;

type WebSocketOptions = {
  fetchImpl?: FetchImpl;
  logger?: Logger;
};

class ClientManager {
  private clients = new Set<WSContext>();
  private logger: Logger;

  constructor(logger: Logger = console) {
    this.logger = logger;
  }

  add(ws: WSContext) {
    this.clients.add(ws);
    this.logger.log(`[ClientManager] Client connected. Total: ${this.clients.size}`);
  }

  remove(ws: WSContext) {
    this.clients.delete(ws);
    this.logger.log(`[ClientManager] Client disconnected. Total: ${this.clients.size}`);
  }

  broadcast(message: string, sender?: WSContext) {
    let sentCount = 0;
    for (const client of this.clients) {
      if (client === sender) continue;
      
      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        this.logger.error("[ClientManager] Failed to send to client, removing", error);
        this.clients.delete(client);
      }
    }
    this.logger.log(`[ClientManager] Broadcast to ${sentCount} clients`);
  }

  get size() {
    return this.clients.size;
  }
}

const clientManager = new ClientManager();

export function setupWebSocket(
  tracker: LeaderSource,
  { fetchImpl = fetch, logger = console }: WebSocketOptions = {},
): WSEvents {
  return {
    onOpen(_event, ws) {
      clientManager.add(ws);

      const leaderUrl = tracker.getLeaderUrl();
      if (!leaderUrl) {
        logger.error("[WebSocket] No leader available to fetch history");
        return;
      }

      void fetchImpl(`${leaderUrl}/log`)
        .then((response) => response.json())
        .then((data: unknown) => {
          const typedData = data as { entries?: unknown[] };
          const historyMessage = JSON.stringify({ 
            type: "history", 
            strokes: typedData.entries ?? [] 
          });
          ws.send(historyMessage);
          logger.log(`[WebSocket] Sent ${typedData.entries?.length ?? 0} history entries`);
        })
        .catch((error) => logger.error("[WebSocket] Failed to fetch history", error));
    },

    async onMessage(event, ws) {
      try {
        const payload = JSON.parse(String(event.data));

        if (payload.type !== "stroke") {
          return;
        }

        const validStroke = StrokeSchema.parse(payload.stroke);
        const leaderUrl = tracker.getLeaderUrl();

        if (!leaderUrl) {
          logger.error("[WebSocket] No leader available to accept stroke");
          return;
        }

        const response = await fetchImpl(`${leaderUrl}/stroke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validStroke),
        });

        const data = await response.json() as { committed?: boolean };

        if (data.committed) {
          const broadcastMessage = JSON.stringify({ 
            type: "stroke", 
            stroke: validStroke 
          });
          
          clientManager.broadcast(broadcastMessage, ws);
        } else {
          logger.error("[WebSocket] Stroke not committed by RAFT");
        }
      } catch (error) {
        logger.error("[WebSocket] Failed to process stroke", error);
      }
    },

    onClose(_event, ws) {
      clientManager.remove(ws);
    },
  };
}

export { ClientManager, clientManager };
