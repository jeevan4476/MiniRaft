import { websocket } from "hono/bun";
import pino from "pino";
import { createGatewayApp } from "./app";
import { LeaderTracker } from "./leader";

const DEFAULT_REPLICA_URLS = [
  "http://localhost:9001",
  "http://localhost:9002",
  "http://localhost:9003",
];

const log = pino({ transport: { target: "pino-pretty" } });

const tracker = new LeaderTracker({
  peers: process.env.REPLICA_URLS?.split(",").filter(Boolean) ?? DEFAULT_REPLICA_URLS,
});

if (process.env.DISABLE_GATEWAY_POLLING !== "1") {
  tracker.startPolling();
}

const app = createGatewayApp({ tracker });
const port = Number(process.env.GATEWAY_PORT ?? process.env.PORT ?? 3001);

log.info(`Gateway starting on port ${port}`);

export { app, tracker };

export default {
  port,
  fetch: app.fetch,
  websocket,
};
