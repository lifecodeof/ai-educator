interface UseConnectionStatusOptions {
  errorMessage: string | null
  isRecording: boolean
  isPlayingAudio: boolean
  isConnected: boolean
  isConnecting: boolean
}

interface UseConnectionStatusResult {
  statusClassName: string
  statusText: string
}

export function useConnectionStatus({
  errorMessage,
  isRecording,
  isPlayingAudio,
  isConnected,
  isConnecting,
}: UseConnectionStatusOptions): UseConnectionStatusResult {
  const statusClassName = errorMessage
    ? "error"
    : isRecording
      ? "recording"
      : isPlayingAudio
        ? "speaking"
      : isConnected
        ? "connected"
        : isConnecting
          ? "connecting"
          : "ready"

  const statusText = errorMessage
    ? errorMessage
    : isRecording
      ? "Recording"
      : isPlayingAudio
        ? "Speaking"
      : isConnected
        ? "Connected"
        : isConnecting
          ? "Connecting"
          : "Ready to connect"

  return { statusClassName, statusText }
}
