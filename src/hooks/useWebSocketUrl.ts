import { useMemo } from 'react'

export function useWebSocketUrl(): string {
  return useMemo(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}/api/live`
  }, [])
}
