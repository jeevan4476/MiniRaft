import { Hono } from 'hono'
import pino from 'pino'

const app = new Hono()
const log = pino({ transport: { target: 'pino-pretty' } })

app.get('/status', (c) => {
  log.info('gateway healthcheck')
  return c.json({ status: 'ok', service: 'gateway', runtime: 'bun' })
})

const port = process.env.PORT || 3001
log.info(`Gateway starting on port ${port}`)

export default {
  port,
  fetch: app.fetch,
}