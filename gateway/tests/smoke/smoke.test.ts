import { describe, expect, test } from "bun:test";

describe("gateway smoke test", () => {
  test("boots the production gateway entrypoint and serves status", async () => {
    const originalDisablePolling = process.env.DISABLE_GATEWAY_POLLING;
    process.env.DISABLE_GATEWAY_POLLING = "1";

    try {
      const { default: server } = await import("../../index");
      const response = await server.fetch(new Request("http://localhost/status"));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: "ok",
        currentLeader: null,
      });
      expect(typeof server.websocket.message).toBe("function");
    } finally {
      if (originalDisablePolling === undefined) {
        delete process.env.DISABLE_GATEWAY_POLLING;
      } else {
        process.env.DISABLE_GATEWAY_POLLING = originalDisablePolling;
      }
    }
  });
});
