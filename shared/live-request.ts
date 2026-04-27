export type LiveRequest = AudioInputChunkLiveRequest

export type AudioInputChunkLiveRequest = {
  type: 'audioInputChunk'
  audioBase64: string
  mimeType: 'audio/pcm;rate=16000'
}

export type Websocket = {
  send(data: string): void
  addEventListener?(
    type: 'message',
    listener: (event: MessageEvent<string>) => void,
  ): void
  removeEventListener?(
    type: 'message',
    listener: (event: MessageEvent<string>) => void,
  ): void
}

export function sendMessage(ws: Websocket, request: LiveRequest): void {
  ws.send(JSON.stringify(request))
}

export function handleResponse(
  ws: Websocket,
  handler: (request: LiveRequest) => void,
): () => void {
  const listener = (event: MessageEvent<string>) => {
    handler(JSON.parse(event.data) as LiveRequest)
  }

  ws.addEventListener?.('message', listener)

  return () => {
    ws.removeEventListener?.('message', listener)
  }
}
