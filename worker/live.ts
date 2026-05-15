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
const VOICE_NAME = "Charon"

const base64ToUint8Array = (b64: string): Uint8Array => {
  const binary =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary")
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const uint8ArrayToBase64 = (u8: Uint8Array): string => {
  if (typeof btoa === "function") {
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < u8.length; i += chunkSize) {
      binary += String.fromCharCode(...u8.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }
  return Buffer.from(u8).toString("base64")
}

const normalizeTtsMimeType = (mimeType?: string) => {
  const normalized = mimeType?.trim().toLowerCase()
  if (!normalized) return DEFAULT_RESPONSE_MIME_TYPE
  return normalized.startsWith("audio/l16")
    ? normalized.replace("audio/l16", "audio/pcm")
    : normalized
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
  voiceName = VOICE_NAME,
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
    if (part.inlineData?.data) {
      return {
        sound: base64ToUint8Array(part.inlineData.data),
        mimeType: normalizeTtsMimeType(part.inlineData.mimeType),
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
  const toolDeclarations = toolSet.map((t) => ({ functionDeclarations: [t.def] }))

  const bufferedTextChunks: string[] = []
  let isDisposed = false
  let processQueue: Promise<void> = Promise.resolve()
  const conversationHistory: Content[] = []

  const executeToolCalls = async (functionCalls: FunctionCall[]) => {
    const functionResponses: FunctionResponse[] = []

    for (const { id, args, name, willContinue } of functionCalls) {
      if (willContinue || !id || !args) continue
      const tool = toolSet.find((t) => t.def.name === name)
      if (!tool) continue
      const response = await tool.call(args as Record<string, unknown>)
      functionResponses.push({ id, name, response })
    }

    return functionResponses
  }

  const emitAudio = async (text: string) => {
    if (!text) return
    const tts = await synthesizeSpeech({
      apiKey: apiKey!,
      cfGatewayConfig,
      text,
      voiceName: VOICE_NAME,
    })
    events.emit(
      "audioChunk",
      uint8ArrayToBase64(tts.sound),
      tts.mimeType ?? DEFAULT_RESPONSE_MIME_TYPE,
      text,
    )
  }

  const callAppendMarkdown = async (content: Content | undefined) => {
    const appendTool = toolSet.find((t) => t.def.name === "append_markdown")
    if (!appendTool) return
    for (const part of content?.parts ?? []) {
      if (part.text) await appendTool.call({ content: part.text })
    }
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
      const generateConfig = {
        model: TEXT_MODEL,
        contents: conversationHistory,
        config: { tools: toolDeclarations, systemInstruction },
      }

      const replyResponse = await ai.models.generateContent(generateConfig)
      const res = replyResponse.candidates?.[0]?.content
      if (!res) {
        events.emit("requestComplete")
        return
      }

      conversationHistory.push(res)

      const functionCalls: FunctionCall[] =
        res.parts?.flatMap((p) => (p.functionCall ? [p.functionCall] : [])) ?? []

      let responseContent: Content | undefined = res
      let responseText = replyResponse.text?.trim() ?? ""

      if (functionCalls.length > 0) {
        const functionResponses = await executeToolCalls(functionCalls)
        if (functionResponses.length > 0) {
          conversationHistory.push({
            parts: functionResponses.map((fr) => ({ functionResponse: fr })),
          })

          const finalResponse = await ai.models.generateContent(generateConfig)
          const finalContent = finalResponse.candidates?.[0]?.content
          if (finalContent) conversationHistory.push(finalContent)

          responseContent = finalContent
          responseText = finalResponse.text?.trim() ?? ""
        }
      }

      await emitAudio(responseText)
      await callAppendMarkdown(responseContent)
      events.emit("requestComplete")
    } catch (error) {
      console.error(error)
      events.emit("error", error)
    }
  }

  const session = {
    sendTextInput: ({ text, isFinished }: { text: string; isFinished: boolean }) => {
      if (!text) return
      bufferedTextChunks.push(text)

      if (isFinished) {
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
