export const LIVE_REQUEST_ENVELOPE_TYPE = {
  AudioInputChunk: 'request.audio.chunk',
} as const

export type LiveRequestEnvelope = AudioInputChunkRequestEnvelope

export type AudioInputChunkRequestEnvelope = {
  type: typeof LIVE_REQUEST_ENVELOPE_TYPE.AudioInputChunk
  audioBase64: string
  mimeType: 'audio/pcm;rate=16000'
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

export function createAudioInputChunkRequestEnvelope(audioBase64: string): AudioInputChunkRequestEnvelope {
  return {
    type: LIVE_REQUEST_ENVELOPE_TYPE.AudioInputChunk,
    audioBase64,
    mimeType: 'audio/pcm;rate=16000',
  }
}

export function parseLiveRequestEnvelope(raw: string): LiveRequestEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isJsonRecord(parsed)) {
    return null
  }

  if (parsed.type !== LIVE_REQUEST_ENVELOPE_TYPE.AudioInputChunk) {
    return null
  }

  if (typeof parsed.audioBase64 !== 'string' || parsed.mimeType !== 'audio/pcm;rate=16000') {
    return null
  }

  return {
    type: LIVE_REQUEST_ENVELOPE_TYPE.AudioInputChunk,
    audioBase64: parsed.audioBase64,
    mimeType: parsed.mimeType,
  }
}
