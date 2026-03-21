import { Hono } from 'hono'
import { upgradeWebSocket, websocket } from 'hono/bun'
import pino from 'pino'

const app = new Hono()
const log = pino({ transport: { target: 'pino-pretty' } })

app.get('/ws', upgradeWebSocket((_) => {
  return {
    onOpen(data, ws) {
      log.info("client connected");
    },
    onMessage(data, ws) {
      log.info(`message received: ${data.data}`);
    },
    onClose(_, ws) {
      log.info("client disconnected");
    }
  }
}))

app.get('/status', (c) => {
  log.info('gateway healthcheck')
  return c.json({ status: 'ok', service: 'gateway', runtime: 'bun' })
})

const port = process.env.PORT || 3001
log.info(`Gateway starting on port ${port}`)

export default {
  port,
  fetch: app.fetch,
  websocket
}