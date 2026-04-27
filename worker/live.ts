import {
  GoogleGenAI,
  MediaResolution,
  Modality,
  type FunctionCall,
  type FunctionDeclaration,
  type FunctionResponse,
  type LiveServerMessage,
  type Session,
} from '@google/genai'
import { createNanoEvents } from 'nanoevents'

const TUNA_TOOL_NAME = 'yapyap'

const TUNA_TOOL_DECLARATION: FunctionDeclaration = {
  name: TUNA_TOOL_NAME,
  description: 'Logs the input number and returns a fixed Turkish response.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      number: {
        type: 'number',
        description: 'Input number to be logged.',
      },
    },
    required: ['number'],
    additionalProperties: false,
  },
}

export const LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025'

function createTunaToolResponse(functionCall: FunctionCall): FunctionResponse {
  const numberInput = functionCall.args?.number
  console.log('log_input_number input:', numberInput)

  return {
    id: functionCall.id,
    name: TUNA_TOOL_NAME,
    response: {
      output: 'Merhaba arkadaşlar ben tuna tavus',
    },
  }
}

export async function createLiveSession(apiKey: string) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.')
  }

  const ai = new GoogleGenAI({ apiKey })
  const events = createNanoEvents<{
    message: (message: LiveServerMessage) => void
    error: (event: unknown) => void
    close: (event: CloseEvent) => void
  }>()

  const session: Session = await ai.live.connect({
    model: LIVE_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Charon',
          },
        },
      },
      contextWindowCompression: {
        triggerTokens: '25600',
        slidingWindow: { targetTokens: '12800' },
      },
      systemInstruction: `\
**Rol:** Sen kıdemli bir yazılım eğitmenisin. Görevin, kullanıcının belirlediği yazılım konularını yalnızca **sesli etkileşime** uygun şekilde öğretmektir.

**Operasyonel Kurallar:**
1. **Ses Odaklı Anlatım:** Karmaşık kod bloklarını uzun uzun okumak yerine, kodun mantığını, hiyerarşisini ve işleyişini sözel olarak açıkla. Syntax detaylarını (parantezler, iki noktalar vb.) sadece kritik noktalarda belirt.
2. **Kısa ve Net:** Sesli dinlemede takibi zorlaştıracak uzun cümlelerden kaçın. Bilgiyi küçük parçalar (chunking) halinde ver.
3. **İnteraktif Süreç:** Her açıklamadan sonra öğrencinin anladığını teyit et veya küçük bir sözlü egzersiz yaptır.
4. **Teknik Kesinlik:** Gereksiz övgü, dolaylı anlatım veya "harika bir soru" gibi dolgu ifadeleri kullanma. Hata varsa doğrudan düzelt, doğruysa onayla ve devam et.
5. **Bağlam:** Öğrenci bir konu başlığı verdiğinde, önce o konunun "ne" olduğunu, sonra "neden" kullanıldığını, en son ise "nasıl" uygulandığını anlat.

**Çıktı Formatı:** Yanıtların bir sesli asistan tarafından okunacağını varsayarak doğal, akıcı ve teknik derinliği koruyan bir Türkçe kullan.`,
      tools: [{ functionDeclarations: [TUNA_TOOL_DECLARATION] }],
    },
    callbacks: {
      onmessage: (message) => {
        const functionCalls = message.toolCall?.functionCalls
        if (functionCalls?.length) {
          if (!session) {
            console.error('Received tool call before live session was initialized.')
          } else {
            const functionResponses = functionCalls.map((functionCall) => {
              if (functionCall.name !== TUNA_TOOL_NAME) {
                return {
                  id: functionCall.id,
                  name: functionCall.name,
                  response: {
                    error: `Unsupported tool: ${functionCall.name ?? 'unknown'}`,
                  },
                } satisfies FunctionResponse
              }
              return createTunaToolResponse(functionCall)
            })
            session.sendToolResponse({ functionResponses })
          }
        }

        events.emit('message', message)
      },
      onerror: (event) => {
        console.error('Live session error:', event)
        events.emit('error', event)
      },
      onclose: (event) => {
        console.log('Live session closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        })
        events.emit('close', event)
      },
    },
  })

  return {
    events,
    session,
    [Symbol.dispose]() {
      session.close()
    },
  }
}
