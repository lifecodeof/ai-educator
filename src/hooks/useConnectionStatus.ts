interface UseConnectionStatusOptions {
  errorMessage: string | null
  isRecording: boolean
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
  isRecording,
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
        : isRecording
          ? "recording"
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
        : isRecording
          ? "Recording"
          : isConnected
            ? "Connected"
          : isConnecting
            ? "Connecting"
            : "Ready to connect"

  return { statusClassName, statusText }
}
