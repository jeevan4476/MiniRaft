import { describe, expect, mock, test } from "bun:test";
import { setupWebSocket } from "../../ws";
import { createLeaderSource, createStroke, flushAsyncWork, jsonResponse } from "../helpers";

class MockRoomSocket {
  sentMessages: string[] = [];
  publishedMessages: Array<{ channel: string; payload: string }> = [];
  subscriptions: string[] = [];
  unsubscriptions: string[] = [];
  readyState = 1 as const;
  raw = undefined;
  url = null;
  protocol = null;

  send(payload: string | ArrayBuffer | Uint8Array) {
    this.sentMessages.push(String(payload));
  }

  close() {}

  subscribe(channel: string) {
    this.subscriptions.push(channel);
  }

  publish(channel: string, payload: string) {
    this.publishedMessages.push({ channel, payload });
  }

  unsubscribe(channel: string) {
    this.unsubscriptions.push(channel);
  }
}

const silentLogger = {
  error: mock(() => {}),
};

describe("gateway websocket handlers", () => {
  test("loads stroke history on open when a leader exists", async () => {
    const stroke = createStroke();
    const ws = new MockRoomSocket();
    const events = setupWebSocket(createLeaderSource("http://leader:9001"), {
      fetchImpl: async () => jsonResponse({ entries: [stroke] }),
      logger: silentLogger,
    });

    events.onOpen?.(new Event("open"), ws as never);
    await flushAsyncWork();

    expect(ws.subscriptions).toEqual(["strokes"]);
    expect(ws.sentMessages).toHaveLength(1);
    expect(JSON.parse(ws.sentMessages[0] as string)).toEqual({
      type: "history",
      strokes: [stroke],
    });
  });

  test("forwards committed strokes to the leader and broadcasts them", async () => {
    const stroke = createStroke({ color: "#22aa44" });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const ws = new MockRoomSocket();
    const events = setupWebSocket(createLeaderSource("http://leader:9001"), {
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });

        if (String(input).endsWith("/stroke")) {
          return jsonResponse({ committed: true });
        }

        return jsonResponse({ entries: [] });
      },
      logger: silentLogger,
    });

    await events.onMessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "stroke", stroke }),
      }),
      ws as never,
    );
    await flushAsyncWork();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://leader:9001/stroke");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(stroke);
    expect(ws.publishedMessages).toEqual([
      {
        channel: "strokes",
        payload: JSON.stringify({ type: "stroke", stroke }),
      },
    ]);
  });

  test("rejects invalid stroke payloads before hitting the backend", async () => {
    const fetchImpl = mock(async () => jsonResponse({ committed: true }));
    const ws = new MockRoomSocket();
    const events = setupWebSocket(createLeaderSource("http://leader:9001"), {
      fetchImpl,
      logger: silentLogger,
    });

    await events.onMessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "stroke",
          stroke: { ...createStroke(), width: "wide" },
        }),
      }),
      ws as never,
    );
    await flushAsyncWork();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(silentLogger.error).toHaveBeenCalledTimes(1);
  });

  test("does nothing when no leader is known", async () => {
    const fetchImpl = mock(async () => jsonResponse({ committed: true }));
    const ws = new MockRoomSocket();
    const events = setupWebSocket(createLeaderSource(null), {
      fetchImpl,
      logger: silentLogger,
    });

    await events.onMessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "stroke", stroke: createStroke() }),
      }),
      ws as never,
    );
    await flushAsyncWork();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ws.publishedMessages).toEqual([]);
  });
});
