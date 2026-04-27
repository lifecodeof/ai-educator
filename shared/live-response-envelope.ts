export const LIVE_RESPONSE_ENVELOPE_TYPE = {
  AudioOutputChunk: 'response.audio.chunk',
} as const

export type LiveResponseEnvelope = AudioOutputChunkResponseEnvelope

export type AudioOutputChunkResponseEnvelope = {
  type: typeof LIVE_RESPONSE_ENVELOPE_TYPE.AudioOutputChunk
  audioBase64: string
  mimeType: string
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

export function createAudioOutputChunkResponseEnvelope(
  audioBase64: string,
  mimeType: string,
): AudioOutputChunkResponseEnvelope {
  return {
    type: LIVE_RESPONSE_ENVELOPE_TYPE.AudioOutputChunk,
    audioBase64,
    mimeType,
  }
}

export function parseLiveResponseEnvelope(raw: string): LiveResponseEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isJsonRecord(parsed)) {
    return null
  }

  if (parsed.type !== LIVE_RESPONSE_ENVELOPE_TYPE.AudioOutputChunk) {
    return null
  }

  if (typeof parsed.audioBase64 !== 'string' || typeof parsed.mimeType !== 'string') {
    return null
  }

  return {
    type: LIVE_RESPONSE_ENVELOPE_TYPE.AudioOutputChunk,
    audioBase64: parsed.audioBase64,
    mimeType: parsed.mimeType,
  }
}
