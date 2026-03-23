import type { LeaderSource } from "./leader";
import { StrokeSchema } from "./types";
import type { WSEvents, WSContext } from "hono/ws";

type Logger = Pick<Console, "error">;
type FetchImpl = typeof fetch;
type RoomSocket = WSContext & {
  subscribe?: (channel: string) => void;
  publish?: (channel: string, payload: string) => void;
  unsubscribe?: (channel: string) => void;
};

type WebSocketOptions = {
  fetchImpl?: FetchImpl;
  logger?: Logger;
};

/**
 * setupWebSocket wires the Bun/Hono WebSocket events to the Go RAFT backend APIs.
 * It handles loading initial history, validating incoming strokes, forwarding them to 
 * the Leader replica, and broadcasting committed strokes back to browsers.
 */
export function setupWebSocket(
  tracker: LeaderSource,
  { fetchImpl = fetch, logger = console }: WebSocketOptions = {},
): WSEvents {
  return {
    /**
     * onOpen: Triggered when a new user connects via WebSocket.
     * We grab the full canvas history from the Go Leader's `GET /log` endpoint
     * and push it down the socket so they can see existing drawings.
     */
    onOpen(_event, ws) {
      const roomSocket = ws as RoomSocket;
      // Native Bun Pub/Sub: Add this user to the "strokes" broadcast room
      roomSocket.subscribe?.("strokes");

      const leaderUrl = tracker.getLeaderUrl();
      if (!leaderUrl) {
        return;
      }

      void fetchImpl(`${leaderUrl}/log`)
        .then((response) => response.json())
        .then((data: unknown) => {
          const typedData = data as { entries?: unknown[] };
          ws.send(JSON.stringify({ type: "history", strokes: typedData.entries ?? [] }));
        })
        .catch((error) => logger.error("Failed to fetch history", error));
    },

    /**
     * onMessage: Triggered when a user draws a stroke and sends JSON.
     * We validate it with Zod, forward it to the Go Leader's `POST /stroke` API,
     * and wait safely for RAFT confirmation.
     */
    async onMessage(event, ws) {
      try {
        const payload = JSON.parse(String(event.data));

        if (payload.type !== "stroke") {
          return;
        }

        const validStroke = StrokeSchema.parse(payload.stroke);
        const leaderUrl = tracker.getLeaderUrl();

        if (!leaderUrl) {
          return;
        }

        const roomSocket = ws as RoomSocket;

        // Forward the stroke strictly to the active Leader.
        // A Follower replica will reject this request.
        void fetchImpl(`${leaderUrl}/stroke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validStroke),
        })
          .then((response) => response.json())
          .then((data: unknown) => {
            const typedData = data as { committed?: boolean };
            // Once the Leader confirms a majority of replicas stored it, it's safe to broadcast!
            if (typedData.committed) {
              // Beams the validated stroke to every connected browser except the sender.
              roomSocket.publish?.(
                "strokes",
                JSON.stringify({ type: "stroke", stroke: validStroke }),
              );
            }
          })
          .catch((error) => logger.error("Failed to append stroke", error));
      } catch (error) {
        logger.error("Failed to parse stroke", error);
      }
    },

    /**
     * onClose: Triggered when a browser tab closes.
     * Cleanly remove them from the Pub/Sub room.
     */
    onClose(_event, ws) {
      const roomSocket = ws as RoomSocket;
      roomSocket.unsubscribe?.("strokes");
    },
  };
}
