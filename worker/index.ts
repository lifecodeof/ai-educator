import { Hono } from "hono"
import { upgradeWebSocket } from "hono/cloudflare-workers"
import type { WSContext } from "hono/ws"
import { match } from "ts-pattern"
import { type LiveRequest } from "../shared/live-request"
import { sendMessage as sendLiveResponse } from "../shared/live-response"
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
              "Anlatmadan önce bu araç ile sunacağın ve öğrenciye görünecek olan markdown dökümanına ekleme yap. " +
              "Mermaid diyagramlarını AGRESIF şekilde kullan: her kavram, süreç, ilişki, akış, hiyerarşi veya karşılaştırma için mutlaka bir mermaid kod blogu (```mermaid ... ```) ekle. " +
              "Gorselsiz anlatma — once diyagram, sonra aciklama.",
            parameters: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                },
              },
              required: ["content"],
              additionalProperties: false,
            },
          },
          async call({ content }) {
            console.log({ content })
            if (ws)
              sendLiveResponse(ws, {
                type: "markdownChunk",
                content: content as string,
              })
            return { status: "success" }
          },
        },
      ],
    })

    const cleanupMessage = events.on("audioChunk", (audioChunk, mimeType, transcript) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return
      }

      sendLiveResponse(ws, {
        type: "audioOutputChunk",
        audioBase64: audioChunk,
        mimeType,
        transcript,
      })
    })

    const cleanupComplete = events.on("requestComplete", () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return
      }

      sendLiveResponse(ws, {
        type: "requestComplete",
      })
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
      cleanupComplete()
      cleanupError()
      dispose()
    }

    return {
      onMessage(event, localWs) {
        ws = localWs
        const request = JSON.parse(event.data as string) as LiveRequest

        match(request)
          .with({ type: "audioInputChunk" }, (audioRequest) => {
            session.sendRealtimeInput({
              audio: {
                data: audioRequest.audioBase64,
                mimeType: audioRequest.mimeType,
              },
            })
          })
          .with({ type: "submitRequest" }, () => {
            session.submitRequest()
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
