import { Hono } from "hono"
import { upgradeWebSocket } from "hono/cloudflare-workers"
import type { WSContext } from "hono/ws"
import { match } from "ts-pattern"
import { type LiveRequest } from "../shared/live-request"
import { sendMessage as sendLiveResponse } from "../shared/live-response"
import { createLiveSession } from "./live"
import { StartStopControlDurableObject } from "./start-stop-control"

type Bindings = {
  GEMINI_API_KEY?: string
  CF_AIG_GATEWAY_ID?: string
  CF_AIG_ACCOUNT_ID?: string
  CF_AIG_TOKEN?: string
  CONTROL_STATE: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Bindings }>()

const getControlStub = (env: Bindings) => {
  const id = env.CONTROL_STATE.idFromName("global")
  return env.CONTROL_STATE.get(id)
}

const getRunningState = async (env: Bindings) => {
  const response = await getControlStub(env).fetch("https://control/status")
  if (!response.ok) {
    throw new Error("Failed to read control status")
  }

  const payload = (await response.json()) as { isRunning: boolean }
  return payload.isRunning
}

app.use("/api/live", async (c, next) => {
  const isRunning = await getRunningState(c.env)
  if (!isRunning) {
    return c.json(
      {
        message:
          "Live API is stopped. Open /control to start it before connecting.",
      },
      503,
    )
  }

  await next()
})

app.get("/api/control/status", async (c) => {
  try {
    const isRunning = await getRunningState(c.env)
    return c.json({ isRunning })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read control status."
    return c.json({ message }, 500)
  }
})

app.post("/api/control/start", async (c) => {
  try {
    const response = await getControlStub(c.env).fetch("https://control/start", {
      method: "POST",
    })
    if (!response.ok) {
      throw new Error("Failed to start live API.")
    }
    const payload = (await response.json()) as { isRunning: boolean }
    return c.json(payload)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to start live API."
    return c.json({ message }, 500)
  }
})

app.post("/api/control/stop", async (c) => {
  try {
    const response = await getControlStub(c.env).fetch("https://control/stop", {
      method: "POST",
    })
    if (!response.ok) {
      throw new Error("Failed to stop live API.")
    }
    const payload = (await response.json()) as { isRunning: boolean }
    return c.json(payload)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to stop live API."
    return c.json({ message }, 500)
  }
})

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

    const cleanupMessage = events.on(
      "audioChunk",
      (audioChunk, mimeType, transcript) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return
        }

        sendLiveResponse(ws, {
          type: "audioOutputChunk",
          audioBase64: audioChunk,
          mimeType,
          transcript,
        })
      },
    )

    const cleanupComplete = events.on("requestComplete", () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return
      }

      sendLiveResponse(ws, {
        type: "requestComplete",
      })
    })

    const cleanupError = events.on("error", (error) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        const statusCode = (error as any)?.status || (error as any)?.statusCode
        sendLiveResponse(ws, {
          type: "error",
          message: errorMessage,
          statusCode: statusCode,
        })
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

export { StartStopControlDurableObject }
export default app
