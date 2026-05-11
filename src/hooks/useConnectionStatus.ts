interface UseConnectionStatusOptions {
  errorMessage: string | null
  isListening: boolean
  isPlayingAudio: boolean
  isProcessing: boolean
  isConnected: boolean
  isConnecting: boolean
}

interface UseConnectionStatusResult {
  statusClassName: string
  statusText: string
}

export function useConnectionStatus({
  errorMessage,
  isListening,
  isPlayingAudio,
  isProcessing,
  isConnected,
  isConnecting,
}: UseConnectionStatusOptions): UseConnectionStatusResult {
  const statusClassName = errorMessage
    ? "error"
    : isPlayingAudio
      ? "speaking"
      : isProcessing
        ? "processing"
        : isListening
          ? "listening"
          : isConnected
            ? "connected"
            : isConnecting
              ? "connecting"
              : "ready"

  const statusText = errorMessage
    ? errorMessage
    : isPlayingAudio
      ? "Speaking"
      : isProcessing
        ? "Processing"
        : isListening
          ? "Listening"
          : isConnected
            ? "Connected"
          : isConnecting
            ? "Connecting"
            : "Ready to connect"

  return { statusClassName, statusText }
}
