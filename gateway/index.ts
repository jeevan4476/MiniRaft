import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import pino from 'pino'
import { LeaderTracker } from './leader'
import { setupWebSocket } from './ws'

const app = new Hono()
const log = pino({ transport: { target: 'pino-pretty' } })

const tracker = new LeaderTracker([
  'http://localhost:9001',
  'http://localhost:9002',
  'http://localhost:9003'
]);

tracker.startPolling();

app.get('/ws', upgradeWebSocket((c) => setupWebSocket(tracker)))

app.get('/status', (c) => {
  return c.json({ status: 'ok', currentLeader: tracker.getLeaderUrl() })
})

const port = process.env.PORT || 3001
log.info(`Gateway starting on port ${port}`)

export default {
  port,
  fetch: app.fetch,
  websocket
}