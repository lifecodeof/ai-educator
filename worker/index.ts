import { Hono } from "hono"
import { upgradeWebSocket } from "hono/cloudflare-workers"
import type { WSContext } from "hono/ws"
import { match } from "ts-pattern"
import { parseLiveRequestEnvelope } from "../shared/live-request-envelope"
import { createAudioOutputChunkResponseEnvelope } from "../shared/live-response-envelope"
import { createLiveSession } from "./live"

type Bindings = {
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.get(
  "/api/live",
  upgradeWebSocket(async (c) => {
    let ws: WSContext<WebSocket> | undefined
    const {
      events,
      session,
      [Symbol.dispose]: dispose,
    } = await createLiveSession({
      apiKey: c.env.GEMINI_API_KEY,
      toolSet: [
        {
          def: {
            name: "append_markdown",
            description:
              "Anlatmadan önce bu araç ile sunacağın ve öğrenciye görünecek olan markdown dökümanına ekleme yap",
            parameters: { type: "STRING" },
          },
          async call(functionCalls) {
            console.log("GOTTEM", functionCalls)
            return { status: "success" }
          },
        },
      ],
    })

    const cleanupMessage = events.on("audioChunk", (audioChunk, mimeType) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return
      }

      const responseEnvelope = createAudioOutputChunkResponseEnvelope(
        audioChunk,
        mimeType,
      )
      ws.send(JSON.stringify(responseEnvelope))
    })

    const cleanupError = events.on("error", () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1011, "Live session error")
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

        if (typeof event.data !== "string") {
          console.warn("Ignored websocket message: expected text envelope.")
          return
        }

        const requestEnvelope = parseLiveRequestEnvelope(event.data)
        if (!requestEnvelope) {
          console.warn("Ignored websocket message: invalid request envelope.")
          return
        }

        match(requestEnvelope)
          .with({ type: "audioInputChunk" }, (audioEnvelope) => {
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
