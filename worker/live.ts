import {
  FunctionResponse,
  GoogleGenAI,
  Modality,
  type FunctionCall,
} from "@google/genai"
import { createNanoEvents, type Emitter } from "nanoevents"
import { liveConfig, systemInstruction } from "./live-config"

type GatewayConfig = {
  gatewayId: string
  accountId: string
  token: string
}

type LiveSession = {
  events: Emitter<{
    audioChunk: (chunk: string, mimeType: string, transcript?: string) => void // Encoded as base64
    error: (event: unknown) => void
    close: (event: CloseEvent) => void
    requestComplete: () => void
  }>
  session: {
    sendRealtimeInput: (params: {
      audio?: { data: string; mimeType?: string }
    }) => void
    submitRequest: () => void
  }
  [Symbol.dispose](): void
}

const DEFAULT_RESPONSE_MIME_TYPE = "audio/pcm;rate=24000"

const TEXT_MODEL = "gemini-3.1-flash-lite-preview"
const TTS_MODEL = "gemini-2.5-flash-preview-tts"

const concatUint8Arrays = (chunks: Uint8Array[]) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

const parsePcmSampleRate = (mimeType: string | undefined) => {
  if (!mimeType) return 16000
  const rateMatch = mimeType.match(/(?:rate|samplerate)=(\d+)/i)
  const parsedRate = rateMatch ? Number(rateMatch[1]) : Number.NaN
  return Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 16000
}

const pcm16ToWav = (pcmBytes: Uint8Array, sampleRate: number) => {
  const dataSize = pcmBytes.byteLength
  const wavBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(wavBuffer)

  const writeAscii = (view: DataView, offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataSize, true)

  new Uint8Array(wavBuffer, 44).set(pcmBytes)
  return new Uint8Array(wavBuffer)
}

const prepareTranscriptionAudio = (
  bytes: Uint8Array,
  mimeType: string | undefined,
) => {
  if (!mimeType) return { bytes, mimeType: "audio/wav" }
  if (!mimeType.toLowerCase().startsWith("audio/pcm")) {
    return { bytes, mimeType }
  }

  const sampleRate = parsePcmSampleRate(mimeType)
  return {
    bytes: pcm16ToWav(bytes, sampleRate),
    mimeType: "audio/wav",
  }
}

const base64ToUint8Array = (b64: string) => {
  // atob/btoa are available in Cloudflare Workers
  const binary =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary")
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const uint8ArrayToBase64 = (u8: Uint8Array) => {
  if (typeof btoa === "function") {
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < u8.length; i += chunkSize) {
      const chunk = u8.subarray(i, i + chunkSize)
      let chunkStr = ""
      for (let j = 0; j < chunk.length; j++)
        chunkStr += String.fromCharCode(chunk[j])
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
    def: any
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

  const bufferedAudioChunks: Uint8Array[] = []
  let lastInputAudioMimeType = "audio/pcm;rate=16000"
  let isDisposed = false
  let processQueue: Promise<void> = Promise.resolve()
  let inactivityTimer: any = null

  const conversationHistory: any[] = []

  const executeToolCalls = async (functionCalls: FunctionCall[]) => {
    const functionResponses: FunctionResponse[] = []

    for (const functionCall of functionCalls) {
      const { id, args, name, willContinue } = functionCall
      if (willContinue || !id || !args) continue
      const tool = toolSet.find((t) => t.def.name === name)
      if (!tool) continue
      const response = await tool.call(args as any)
      functionResponses.push({ id, name, response })
    }

    return functionResponses
  }

  const processBufferedAudio = async () => {
    if (isDisposed || bufferedAudioChunks.length === 0) {
      bufferedAudioChunks.length = 0
      return
    }

    const rawAudio = concatUint8Arrays(bufferedAudioChunks)
    bufferedAudioChunks.length = 0

    const audioInput = prepareTranscriptionAudio(
      rawAudio,
      lastInputAudioMimeType,
    )

    conversationHistory.push({
      role: "user",
      parts: [
        {
          inlineData: {
            data: uint8ArrayToBase64(audioInput.bytes),
            mimeType: audioInput.mimeType,
          },
        },
      ],
    })

    try {
      const toolDeclarations = toolSet.map((t) => ({
        functionDeclarations: [t.def],
      }))

      const replyResponse = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: conversationHistory,
        config: {
          tools: toolDeclarations,
          systemInstruction: (liveConfig as any)(
            { onmessage: () => {}, onerror: () => {}, onclose: () => {} },
            [],
          ).config.systemInstruction,
        },
      })

      const res = replyResponse.candidates?.[0]?.content
      if (!res) {
        events.emit("requestComplete")
        return
      }

      conversationHistory.push(res)

      // If the model requested server-side tool calls, execute them and feed back the responses.
      const functionCalls: FunctionCall[] = []
      for (const part of res.parts ?? []) {
        if (part.functionCall) functionCalls.push(part.functionCall)
      }

      if (functionCalls.length > 0) {
        const functionResponses = await executeToolCalls(functionCalls)
        if (functionResponses.length > 0) {
          // Add the function responses back into the conversation and ask for a final answer
          conversationHistory.push({
            parts: functionResponses.map((fr) => ({
              functionResponse: fr as any,
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

          // Use finalResponse.text as reply text
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

          // Also send back any textual parts via the append_markdown tool if present
          for (const part of finalContent?.parts ?? []) {
            if (part.text) {
              const appendTool = toolSet.find(
                (t) => t.def.name === "append_markdown",
              )
              if (appendTool) await appendTool.call({ content: part.text })
            }
          }

          events.emit("requestComplete")
          return
        }
      }

      // No function calls: proceed normally
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

      // Send textual parts to append_markdown if available
      for (const part of res.parts ?? []) {
        if (part.text) {
          const appendTool = toolSet.find(
            (t) => t.def.name === "append_markdown",
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
    sendRealtimeInput: (params: {
      audio?: { data: string; mimeType?: string }
    }) => {
      if (!params?.audio?.data) return
      const chunk = base64ToUint8Array(params.audio.data)
      bufferedAudioChunks.push(chunk)
      lastInputAudioMimeType = params.audio.mimeType ?? lastInputAudioMimeType

      if (inactivityTimer) clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => {
        processQueue = processQueue
          .then(processBufferedAudio)
          .catch((err) => events.emit("error", err))
      }, 700)
    },
    submitRequest: () => {
      if (inactivityTimer) clearTimeout(inactivityTimer)
      processQueue = processQueue
        .then(processBufferedAudio)
        .catch((err) => events.emit("error", err))
    },
  }

  return {
    events,
    session,
    [Symbol.dispose]() {
      isDisposed = true
      bufferedAudioChunks.length = 0
    },
  }
}
