import {
  FunctionResponse,
  GoogleGenAI,
  type FunctionCall,
  type Session,
} from "@google/genai"
import { createNanoEvents, type Emitter } from "nanoevents"
import { liveConfig } from "./live-config"

type LiveSession = {
  events: Emitter<{
    audioChunk: (chunk: string, mimeType: string) => void // Encoded as base64
    error: (event: unknown) => void
    close: (event: CloseEvent) => void
  }>
  session: Session
  [Symbol.dispose](): void
}

const DEFAULT_RESPONSE_MIME_TYPE = "audio/pcm;rate=24000"

export async function createLiveSession({
  apiKey,
  toolSet,
}: {
  apiKey: string
  toolSet: {
    def: FunctionDefinition
    call: (args: unknown) => Promise<Record<string, unknown>>
  }[]
}): Promise<LiveSession> {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.")
  }

  const ai = new GoogleGenAI({ apiKey })
  const events: LiveSession["events"] = createNanoEvents()

  const executeToolCalls = async (functionCalls: FunctionCall[]) => {
    const functionResponses: FunctionResponse[] = []

    for (const functionCall of functionCalls) {
      const { id, args, name, willContinue } = functionCall
      if (willContinue || !id || !args) continue
      const tool = toolSet.find((t) => t.def.name === name)
      if (!tool) continue
      const response = await tool.call(args)
      functionResponses.push({ id, name, response })
    }

    return functionResponses
  }

  const config = liveConfig(
    {
      onmessage: async (message) => {
        try {
          const parts = message.serverContent?.modelTurn?.parts ?? []
          const functionResponses: FunctionResponse[] = []

          for (const part of parts) {
            const audioChunk = part.inlineData
            if (audioChunk?.data) {
              events.emit(
                "audioChunk",
                audioChunk.data,
                audioChunk.mimeType ?? DEFAULT_RESPONSE_MIME_TYPE,
              )
            }

            if (part.functionCall) {
              const responses = await executeToolCalls([part.functionCall])
              functionResponses.push(...responses)
            }
          }

          if (message.toolCall?.functionCalls) {
            const responses = await executeToolCalls(
              message.toolCall.functionCalls,
            )
            functionResponses.push(...responses)
          }

          if (functionResponses.length > 0) {
            console.log({ functionResponses })
            session.sendToolResponse({ functionResponses })
          }
        } catch (error) {
          console.error(error) // Promise won't be awaited
        }
      },
      onerror: (event) => {
        console.error("Live session error:", event)
        events.emit("error", event)
      },
      onclose: (event) => {
        console.log("Live session closed:", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        })
        events.emit("close", event)
      },
    },
    toolSet.map((t) => ({ functionDeclarations: [t.def] })),
  )

  const session = await ai.live.connect(config)

  return {
    events,
    session,
    [Symbol.dispose]() {
      session.close()
    },
  }
}
