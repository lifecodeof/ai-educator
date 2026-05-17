import { Hono } from "hono"
import { upgradeWebSocket } from "hono/cloudflare-workers"
import type { WSContext } from "hono/ws"
import { match } from "ts-pattern"
import { type LiveRequest } from "../shared/live-request"
import { sendMessage as sendLiveResponse } from "../shared/live-response"
import { createLiveSession } from "./live"

type Bindings = {
  GEMINI_API_KEY?: string
  CF_AIG_GATEWAY_ID?: string
  CF_AIG_ACCOUNT_ID?: string
  CF_AIG_TOKEN?: string
}

const app = new Hono<{ Bindings: Bindings }>()
const WS_CLOSE_INTERNAL_ERROR = 1011
const WS_ERROR_REASON = "Live session error"
const WS_INVALID_MESSAGE_REASON = "Invalid message payload"

function parseLiveRequest(data: unknown): LiveRequest | null {
  if (typeof data !== "string") return null
  try {
    return JSON.parse(data) as LiveRequest
  } catch {
    return null
  }
}

app.get(
  "/api/live",
  upgradeWebSocket(async (c) => {
    let ws: WSContext<WebSocket> | undefined

    // Determine API configuration - prefer Cloudflare Gateway if available
    const apiKey = c.env.GEMINI_API_KEY
    const cfGatewayConfig =
      c.env.CF_AIG_GATEWAY_ID && c.env.CF_AIG_ACCOUNT_ID && c.env.CF_AIG_TOKEN
        ? {
            gatewayId: c.env.CF_AIG_GATEWAY_ID,
            accountId: c.env.CF_AIG_ACCOUNT_ID,
            token: c.env.CF_AIG_TOKEN,
          }
        : null

    if (!apiKey && !cfGatewayConfig) {
      throw new Error(
        "Either GEMINI_API_KEY or Cloudflare Gateway credentials (CF_AIG_*) must be configured.",
      )
    }

    const {
      events,
      session,
      [Symbol.dispose]: dispose,
    } = await createLiveSession({
      apiKey: apiKey || undefined,
      cfGatewayConfig: cfGatewayConfig || undefined,
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

    const cleanups = [
      events.on("audioChunk", (audioChunk, mimeType, transcript) => {
        if (ws?.readyState !== WebSocket.OPEN) return
        sendLiveResponse(ws, {
          type: "audioOutputChunk",
          audioBase64: audioChunk,
          mimeType,
          transcript,
        })
      }),

      events.on("requestComplete", () => {
        if (ws?.readyState !== WebSocket.OPEN) return
        sendLiveResponse(ws, { type: "requestComplete" })
      }),

      events.on("error", (error) => {
        if (ws?.readyState !== WebSocket.OPEN) return
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        const statusCandidate = error as {
          status?: number
          statusCode?: number
        }
        sendLiveResponse(ws, {
          type: "error",
          message: errorMessage,
          statusCode: statusCandidate.status ?? statusCandidate.statusCode,
        })
        ws.close(WS_CLOSE_INTERNAL_ERROR, WS_ERROR_REASON)
      }),
    ]

    let isDisposed = false
    const disposeSession = () => {
      if (isDisposed) return
      isDisposed = true
      cleanups.forEach((cleanup) => cleanup())
      dispose()
    }

    return {
      onMessage(event, localWs) {
        ws = localWs
        const request = parseLiveRequest(event.data)
        if (!request) {
          sendLiveResponse(localWs, {
            type: "error",
            message: WS_INVALID_MESSAGE_REASON,
          })
          localWs.close(WS_CLOSE_INTERNAL_ERROR, WS_INVALID_MESSAGE_REASON)
          return
        }
        match(request)
          .with({ type: "textInputChunk" }, ({ text, isFinished }) => {
            session.sendTextInput({ text, isFinished })
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
