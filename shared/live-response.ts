export type LiveResponse = AudioOutputChunkLiveResponse

export type AudioOutputChunkLiveResponse = {
  type: 'audioOutputChunk'
  audioBase64: string
  mimeType: string
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

export function sendMessage(ws: Websocket, response: LiveResponse): void {
  ws.send(JSON.stringify(response))
}

export function handleResponse(
  ws: Websocket,
  handler: (response: LiveResponse) => void,
): () => void {
  const listener = (event: MessageEvent<string>) => {
    handler(JSON.parse(event.data) as LiveResponse)
  }

  ws.addEventListener?.('message', listener)

  return () => {
    ws.removeEventListener?.('message', listener)
  }
}
