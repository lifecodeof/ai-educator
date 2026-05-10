export function encodeBase64(bytes: Uint8Array): string {
  let raw = ""
  for (let i = 0; i < bytes.length; i += 1) {
    raw += String.fromCharCode(bytes[i])
  }
  return btoa(raw)
}

export function decodeBase64(value: string): ArrayBuffer {
  const raw = atob(value)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return buffer
}
