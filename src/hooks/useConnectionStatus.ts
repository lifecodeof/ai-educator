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
  const status = errorMessage
    ? { className: "error", text: errorMessage }
    : isPlayingAudio
      ? { className: "speaking", text: "Speaking" }
      : isProcessing
        ? { className: "processing", text: "Processing" }
        : isListening
          ? { className: "listening", text: "Listening" }
          : isConnected
            ? { className: "connected", text: "Connected" }
            : isConnecting
              ? { className: "connecting", text: "Connecting" }
              : { className: "ready", text: "Ready to connect" }

  return { statusClassName: status.className, statusText: status.text }
}
