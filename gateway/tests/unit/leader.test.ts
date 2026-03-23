import { describe, expect, test } from "bun:test";
import { LeaderTracker } from "../../leader";
import { jsonResponse } from "../helpers";

const silentLogger = {
  log() {},
};

describe("LeaderTracker", () => {
  test("pollOnce keeps the highest-term leader response", async () => {
    const tracker = new LeaderTracker({
      peers: ["http://replica1:9001", "http://replica2:9002"],
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.startsWith("http://replica1:9001")) {
          return jsonResponse({
            replicaId: "replica1",
            state: "LEADER",
            term: 2,
            commitIndex: 10,
            logLength: 10,
          });
        }

        return jsonResponse({
          replicaId: "replica2",
          state: "LEADER",
          term: 5,
          commitIndex: 12,
          logLength: 12,
        });
      },
      logger: silentLogger,
    });

    await tracker.pollOnce();

    expect(tracker.getLeaderUrl()).toBe("http://replica2:9002");
  });

  test("pollOnce ignores offline peers and followers", async () => {
    const tracker = new LeaderTracker({
      peers: ["http://replica1:9001", "http://replica2:9002"],
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.startsWith("http://replica1:9001")) {
          throw new Error("offline");
        }

        return jsonResponse({
          replicaId: "replica2",
          state: "FOLLOWER",
          term: 3,
          commitIndex: 8,
          logLength: 9,
        });
      },
      logger: silentLogger,
    });

    await tracker.pollOnce();

    expect(tracker.getLeaderUrl()).toBeNull();
  });
});
