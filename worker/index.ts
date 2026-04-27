import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/cloudflare-workers'
import type { WSContext } from 'hono/ws'
import { match } from 'ts-pattern'
import {
  parseLiveRequestEnvelope,
  LIVE_REQUEST_ENVELOPE_TYPE,
} from '../shared/live-request-envelope'
import { createAudioOutputChunkResponseEnvelope } from '../shared/live-response-envelope'
import { LIVE_MODEL, createLiveSession } from './live'

type Bindings = {
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()
const DEFAULT_RESPONSE_MIME_TYPE = 'audio/pcm;rate=24000'

app.get('/api/health', (c) =>
  c.json({
    status: 'ok' as const,
    service: 'live-ai-gateway',
    websocketPath: '/api/live',
    model: LIVE_MODEL,
  }),
)

app.get(
  '/api/live',
  upgradeWebSocket(async (c) => {
    let ws: WSContext<WebSocket> | undefined
    const { events, session, [Symbol.dispose]: dispose } = await createLiveSession(c.env.GEMINI_API_KEY)

    const cleanupMessage = events.on('message', (message) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return
      }

      for (const part of message.serverContent?.modelTurn?.parts ?? []) {
        const audioChunk = part.inlineData
        if (!audioChunk?.data) {
          continue
        }

        const responseEnvelope = createAudioOutputChunkResponseEnvelope(
          audioChunk.data,
          audioChunk.mimeType ?? DEFAULT_RESPONSE_MIME_TYPE,
        )
        ws.send(JSON.stringify(responseEnvelope))
      }
    })

    const cleanupError = events.on('error', () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1011, 'Live session error')
      }
    })

    let isDisposed = false
    const disposeSession = () => {
      if (isDisposed) {
        return
      }
      isDisposed = true
      cleanupMessage()
      cleanupError()
      dispose()
    }

    return {
      onMessage(event, localWs) {
        ws = localWs

        if (typeof event.data !== 'string') {
          console.warn('Ignored websocket message: expected text envelope.')
          return
        }

        const requestEnvelope = parseLiveRequestEnvelope(event.data)
        if (!requestEnvelope) {
          console.warn('Ignored websocket message: invalid request envelope.')
          return
        }

        match(requestEnvelope)
          .with({ type: LIVE_REQUEST_ENVELOPE_TYPE.AudioInputChunk }, (audioEnvelope) => {
            session.sendRealtimeInput({
              audio: {
                data: audioEnvelope.audioBase64,
                mimeType: audioEnvelope.mimeType,
              },
            })
          })
          .exhaustive()
      },
      onClose() {
        disposeSession()
      },
      onError() {
        disposeSession()
      },
    }
  }),
)

export default app
