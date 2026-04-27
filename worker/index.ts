import { Hono } from 'hono'
import { upgradeWebSocket } from 'hono/cloudflare-workers'
import type { WSContext } from 'hono/ws'
import { LIVE_MODEL, createLiveSession } from './live'

type Bindings = {
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

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
        const encodedAudio = part.inlineData?.data
        if (!encodedAudio) {
          continue
        }
        ws.send(decodeBase64(encodedAudio))
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
        const arrayBuffer = asArrayBuffer(event.data)
        if (!arrayBuffer) {
          return
        }
        if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
          return
        }

        const floatSamples = new Float32Array(arrayBuffer)
        const int16Samples = convertFloat32ToInt16(floatSamples)
        session.sendRealtimeInput({
          audio: {
            data: encodeBase64(new Uint8Array(int16Samples.buffer)),
            mimeType: 'audio/pcm;rate=16000',
          },
        })
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

function asArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) {
    return data
  }
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    return copy.buffer
  }
  return null
}

function decodeBase64(value: string): ArrayBuffer {
  const raw = atob(value)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return buffer
}

function encodeBase64(value: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < value.length; i += 1) {
    raw += String.fromCharCode(value[i])
  }
  return btoa(raw)
}

function convertFloat32ToInt16(floatSamples: Float32Array): Int16Array {
  const int16Buffer = new Int16Array(floatSamples.length)
  for (let i = 0; i < floatSamples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[i]))
    int16Buffer[i] = (sample < 0 ? sample * 0x8000 : sample * 0x7fff) | 0
  }
  return int16Buffer
}

export default app
