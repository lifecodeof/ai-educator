import {
  FunctionResponse,
  GoogleGenAI,
  Modality,
  type Content,
  type FunctionCall,
} from "@google/genai"
import { createNanoEvents, type Emitter } from "nanoevents"
import { systemInstruction } from "./live-config"

type GatewayConfig = {
  gatewayId: string
  accountId: string
  token: string
}

type ToolDefinition = {
  name: string
  [key: string]: unknown
}

type LiveSession = {
  events: Emitter<{
    audioChunk: (chunk: string, mimeType: string, transcript?: string) => void
    error: (event: unknown) => void
    close: (event: CloseEvent) => void
    requestComplete: () => void
  }>
  session: {
    sendTextInput: (params: { text: string; isFinished: boolean }) => void
  }
  [Symbol.dispose](): void
}

const DEFAULT_RESPONSE_MIME_TYPE = "audio/pcm;rate=24000"

const TEXT_MODEL = "gemini-3.1-flash-lite-preview"
const TTS_MODEL = "gemini-2.5-flash-preview-tts"

const base64ToUint8Array = (b64: string) => {
  const binary =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary")
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const uint8ArrayToBase64 = (u8: Uint8Array) => {
  if (typeof btoa === "function") {
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < u8.length; i += chunkSize) {
      const chunk = u8.subarray(i, i + chunkSize)
      let chunkStr = ""
      for (let j = 0; j < chunk.length; j += 1) {
        chunkStr += String.fromCharCode(chunk[j])
      }
      binary += chunkStr
    }
    return btoa(binary)
  }

  return Buffer.from(u8).toString("base64")
}

const normalizeTtsMimeType = (mimeType?: string) => {
  const normalized = mimeType?.trim().toLowerCase()
  if (!normalized) {
    return "audio/pcm;rate=24000"
  }

  if (normalized.startsWith("audio/l16")) {
    return normalized.replace("audio/l16", "audio/pcm")
  }

  return normalized
}

const createGenAIClient = (apiKey: string, cfGatewayConfig?: GatewayConfig) => {
  if (!cfGatewayConfig) {
    return new GoogleGenAI({ apiKey })
  }

  return new GoogleGenAI({
    apiKey: cfGatewayConfig.token,
    httpOptions: {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${cfGatewayConfig.accountId}/${cfGatewayConfig.gatewayId}/google-ai-studio`,
    },
  })
}

const synthesizeSpeech = async ({
  apiKey,
  cfGatewayConfig,
  text,
  voiceName = "Charon",
}: {
  apiKey: string
  cfGatewayConfig?: GatewayConfig
  text: string
  voiceName?: string
}) => {
  const ai = createGenAIClient(apiKey, cfGatewayConfig)
  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: text,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName,
          },
        },
      },
    },
  })

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    const inlineData = part.inlineData
    if (inlineData?.data) {
      return {
        sound: base64ToUint8Array(inlineData.data),
        mimeType: normalizeTtsMimeType(inlineData.mimeType),
      }
    }
  }

  throw new Error("Gemini TTS did not return audio data")
}

export async function createLiveSession({
  apiKey,
  cfGatewayConfig,
  toolSet,
}: {
  apiKey?: string
  cfGatewayConfig?: GatewayConfig
  toolSet: {
    def: ToolDefinition
    call: (args: Record<string, unknown>) => Promise<Record<string, unknown>>
  }[]
}): Promise<LiveSession> {
  if (!apiKey && !cfGatewayConfig) {
    throw new Error(
      "Either API key or Cloudflare Gateway credentials must be provided.",
    )
  }

  const ai = createGenAIClient(apiKey!, cfGatewayConfig)
  const events: LiveSession["events"] = createNanoEvents()

  const bufferedTextChunks: string[] = []
  let isDisposed = false
  let processQueue: Promise<void> = Promise.resolve()
  const conversationHistory: Content[] = []

  const executeToolCalls = async (functionCalls: FunctionCall[]) => {
    const functionResponses: FunctionResponse[] = []

    for (const functionCall of functionCalls) {
      const { id, args, name, willContinue } = functionCall
      if (willContinue || !id || !args) continue
      const tool = toolSet.find((candidate) => candidate.def.name === name)
      if (!tool) continue
      const response = await tool.call(args as Record<string, unknown>)
      functionResponses.push({ id, name, response })
    }

    return functionResponses
  }

  const processBufferedText = async () => {
    if (isDisposed) {
      bufferedTextChunks.length = 0
      return
    }

    const text = bufferedTextChunks.join(" ").replace(/\s+/g, " ").trim()
    bufferedTextChunks.length = 0

    if (!text) {
      events.emit("requestComplete")
      return
    }

    conversationHistory.push({
      role: "user",
      parts: [{ text }],
    })

    try {
      const toolDeclarations = toolSet.map((candidate) => ({
        functionDeclarations: [candidate.def],
      }))

      const replyResponse = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: conversationHistory,
        config: {
          tools: toolDeclarations,
          systemInstruction,
        },
      })

      const res = replyResponse.candidates?.[0]?.content
      if (!res) {
        events.emit("requestComplete")
        return
      }

      conversationHistory.push(res)

      const functionCalls: FunctionCall[] = []
      for (const part of res.parts ?? []) {
        if (part.functionCall) functionCalls.push(part.functionCall)
      }

      if (functionCalls.length > 0) {
        const functionResponses = await executeToolCalls(functionCalls)
        if (functionResponses.length > 0) {
          conversationHistory.push({
            parts: functionResponses.map((functionResponse) => ({
              functionResponse,
            })),
          })

          const finalResponse = await ai.models.generateContent({
            model: TEXT_MODEL,
            contents: conversationHistory,
            config: {
              tools: toolDeclarations,
              systemInstruction,
            },
          })

          const finalContent = finalResponse.candidates?.[0]?.content
          if (finalContent) conversationHistory.push(finalContent)

          const replyText = finalResponse.text?.trim() ?? ""
          if (replyText) {
            const tts = await synthesizeSpeech({
              apiKey: apiKey!,
              cfGatewayConfig,
              text: replyText,
              voiceName: "Charon",
            })
            events.emit(
              "audioChunk",
              uint8ArrayToBase64(tts.sound),
              tts.mimeType ?? DEFAULT_RESPONSE_MIME_TYPE,
              replyText,
            )
          }

          for (const part of finalContent?.parts ?? []) {
            if (part.text) {
              const appendTool = toolSet.find(
                (candidate) => candidate.def.name === "append_markdown",
              )
              if (appendTool) await appendTool.call({ content: part.text })
            }
          }

          events.emit("requestComplete")
          return
        }
      }

      const replyText = replyResponse.text?.trim() ?? ""
      if (replyText) {
        const tts = await synthesizeSpeech({
          apiKey: apiKey!,
          cfGatewayConfig,
          text: replyText,
          voiceName: "Charon",
        })
        events.emit(
          "audioChunk",
          uint8ArrayToBase64(tts.sound),
          tts.mimeType ?? DEFAULT_RESPONSE_MIME_TYPE,
          replyText,
        )
      }

      for (const part of res.parts ?? []) {
        if (part.text) {
          const appendTool = toolSet.find(
            (candidate) => candidate.def.name === "append_markdown",
          )
          if (appendTool) await appendTool.call({ content: part.text })
        }
      }

      events.emit("requestComplete")
    } catch (error) {
      console.error(error)
      events.emit("error", error)
    }
  }

  const session = {
    sendTextInput: (params: { text: string; isFinished: boolean }) => {
      if (!params.text) return
      bufferedTextChunks.push(params.text)

      if (params.isFinished) {
        processQueue = processQueue
          .then(processBufferedText)
          .catch((error) => events.emit("error", error))
      }
    },
  }

  return {
    events,
    session,
    [Symbol.dispose]() {
      isDisposed = true
      bufferedTextChunks.length = 0
    },
  }
}
