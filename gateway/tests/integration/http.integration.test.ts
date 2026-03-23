import { describe, expect, test } from "bun:test";
import { createGatewayApp } from "../../app";
import { createLeaderSource } from "../helpers";

describe("gateway status route", () => {
  test("returns the active leader URL", async () => {
    const app = createGatewayApp({
      tracker: createLeaderSource("http://replica2:9002"),
    });

    const response = await app.request("/status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      currentLeader: "http://replica2:9002",
    });
  });

  test("returns null when no leader is known", async () => {
    const app = createGatewayApp({
      tracker: createLeaderSource(null),
    });

    const response = await app.request("/status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      currentLeader: null,
    });
  });
});
