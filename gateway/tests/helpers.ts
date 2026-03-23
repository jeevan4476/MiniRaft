import type { LeaderSource } from "../leader";
import type { Stroke } from "../types";

export function createLeaderSource(leaderUrl: string | null): LeaderSource {
  return {
    getLeaderUrl: () => leaderUrl,
  };
}

export function createStroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    x0: 0,
    y0: 0,
    x1: 10,
    y1: 10,
    color: "#000000",
    width: 4,
    ...overrides,
  };
}

export function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

export async function flushAsyncWork() {
  await Bun.sleep(0);
  await Bun.sleep(0);
}
