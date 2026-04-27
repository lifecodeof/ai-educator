export type LiveRequestEnvelope = AudioInputChunkRequestEnvelope

export type AudioInputChunkRequestEnvelope = {
  type: 'audioInputChunk'
  audioBase64: string
  mimeType: 'audio/pcm;rate=16000'
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null
}

export function createAudioInputChunkRequestEnvelope(audioBase64: string): AudioInputChunkRequestEnvelope {
  return {
    type: 'audioInputChunk',
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

  if (parsed.type !== 'audioInputChunk') {
    return null
  }

  if (typeof parsed.audioBase64 !== 'string' || parsed.mimeType !== 'audio/pcm;rate=16000') {
    return null
  }

  return {
    type: 'audioInputChunk',
    audioBase64: parsed.audioBase64,
    mimeType: parsed.mimeType,
  }
}
