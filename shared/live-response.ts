export type LiveResponse =
  | {
      type: "audioOutputChunk"
      audioBase64: string
      mimeType: string
      transcript?: string
    }
  | {
      type: "markdownChunk"
      content: string
    }
  | {
      type: "requestComplete"
    }
  | {
      type: "error"
      message: string
      statusCode?: number
    }

export type Websocket = {
  send(data: string): void
  addEventListener?(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void
  removeEventListener?(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void
}

export function sendMessage(ws: Websocket, response: LiveResponse): void {
  ws.send(JSON.stringify(response))
}

export function handleResponse(
  ws: Websocket,
  handler: (response: LiveResponse) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    handler(JSON.parse(event.data) as LiveResponse)
  }

  ws.addEventListener?.("message", listener)

  return () => {
    ws.removeEventListener?.("message", listener)
  }
}
