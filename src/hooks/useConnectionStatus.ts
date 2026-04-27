interface UseConnectionStatusOptions {
  errorMessage: string | null
  isRecording: boolean
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
  isConnected,
  isConnecting,
}: UseConnectionStatusOptions): UseConnectionStatusResult {
  const statusClassName = errorMessage
    ? 'error'
    : isRecording
      ? 'recording'
      : isConnected
        ? 'connected'
        : isConnecting
          ? 'connecting'
          : 'ready'

  const statusText = errorMessage
    ? errorMessage
    : isRecording
      ? 'Recording'
      : isConnected
        ? 'Connected'
        : isConnecting
          ? 'Connecting'
          : 'Ready to connect'

  return { statusClassName, statusText }
}
