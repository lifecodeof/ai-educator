import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { match } from 'ts-pattern'
import {
  createAudioInputChunkRequestEnvelope,
} from '../shared/live-request-envelope'
import {
  LIVE_RESPONSE_ENVELOPE_TYPE,
  parseLiveResponseEnvelope,
} from '../shared/live-response-envelope'
import './App.css'

type LegacyWindow = Window & { webkitAudioContext?: typeof AudioContext }

const RECORDING_SAMPLE_RATE = 16_000
const PLAYBACK_SAMPLE_RATE = 24_000
const VISUALIZER_ACTIVE_THRESHOLD = 15

function encodeBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += 1) {
    raw += String.fromCharCode(bytes[i])
  }
  return btoa(raw)
}

function decodeBase64(value: string): ArrayBuffer {
  const raw = atob(value)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return buffer
}

function convertFloat32ToInt16(floatSamples: Float32Array): Int16Array {
  const int16Buffer = new Int16Array(floatSamples.length)
  for (let i = 0; i < floatSamples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[i]))
    int16Buffer[i] = (sample < 0 ? sample * 0x8000 : sample * 0x7fff) | 0
  }
  return int16Buffer
}

function getAudioContextCtor() {
  const audioContextCtor = window.AudioContext ?? (window as LegacyWindow).webkitAudioContext
  if (!audioContextCtor) {
    throw new Error('Web Audio API is not supported in this browser.')
  }
  return audioContextCtor
}

function App() {
  const wsRef = useRef<WebSocket | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const recordingContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const playbackContextRef = useRef<AudioContext | null>(null)
  const nextPlaybackStartRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const isRecordingRef = useRef(false)

  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const wsUrl = useMemo(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}/api/live`
  }, [])

  const ensurePlaybackContext = useCallback(() => {
    if (!playbackContextRef.current) {
      const AudioContextCtor = getAudioContextCtor()
      playbackContextRef.current = new AudioContextCtor({
        sampleRate: PLAYBACK_SAMPLE_RATE,
      })
    }
    return playbackContextRef.current
  }, [])

  const playAudio = useCallback(
    async (arrayBuffer: ArrayBuffer) => {
      const playbackContext = ensurePlaybackContext()
      if (playbackContext.state === 'suspended') {
        await playbackContext.resume()
      }

      const pcmData = new Int16Array(arrayBuffer)
      const audioBuffer = playbackContext.createBuffer(1, pcmData.length, PLAYBACK_SAMPLE_RATE)
      const channelData = audioBuffer.getChannelData(0)

      for (let i = 0; i < pcmData.length; i += 1) {
        channelData[i] = pcmData[i] / 32768
      }

      const source = playbackContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(playbackContext.destination)

      const currentTime = playbackContext.currentTime
      if (nextPlaybackStartRef.current < currentTime) {
        nextPlaybackStartRef.current = currentTime
      }

      source.start(nextPlaybackStartRef.current)
      nextPlaybackStartRef.current += audioBuffer.duration
    },
    [ensurePlaybackContext],
  )

  const updateVisualizer = useCallback(() => {
    const tick = () => {
      if (!isRecordingRef.current || !analyserRef.current) {
        setAudioLevel(0)
        animationFrameRef.current = null
        return
      }

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteTimeDomainData(dataArray)

      let sum = 0
      for (let i = 0; i < dataArray.length; i += 1) {
        const normalized = (dataArray[i] - 128) / 128
        sum += normalized * normalized
      }

      const rms = Math.sqrt(sum / dataArray.length)
      const db = 20 * Math.log10(rms + 0.0001)
      const level = Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
      setAudioLevel(level)

      animationFrameRef.current = requestAnimationFrame(tick)
    }

    tick()
  }, [])

  const handleWorkletMessage = useCallback((event: MessageEvent<Float32Array>) => {
    const ws = wsRef.current
    if (!isRecordingRef.current || !ws || ws.readyState !== WebSocket.OPEN) {
      return
    }

    const pcmInt16 = convertFloat32ToInt16(event.data)
    const requestEnvelope = createAudioInputChunkRequestEnvelope(encodeBase64(new Uint8Array(pcmInt16.buffer)))
    ws.send(JSON.stringify(requestEnvelope))
  }, [])

  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false
    setIsRecording(false)

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect()
      analyserRef.current = null
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop())
      micStreamRef.current = null
    }

    if (recordingContextRef.current) {
      await recordingContextRef.current.close()
      recordingContextRef.current = null
    }

    setAudioLevel(0)
  }, [])

  const startRecording = useCallback(async () => {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: RECORDING_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })

    const AudioContextCtor = getAudioContextCtor()
    const recordingContext = new AudioContextCtor({
      sampleRate: RECORDING_SAMPLE_RATE,
    })

    await recordingContext.audioWorklet.addModule('/audio-processor.js')

    const source = recordingContext.createMediaStreamSource(micStream)
    const analyser = recordingContext.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8

    const workletNode = new AudioWorkletNode(recordingContext, 'microphone-stream-processor')
    workletNode.port.onmessage = handleWorkletMessage
    workletNode.port.start()

    source.connect(analyser)
    analyser.connect(workletNode)
    workletNode.connect(recordingContext.destination)

    micStreamRef.current = micStream
    recordingContextRef.current = recordingContext
    analyserRef.current = analyser
    workletNodeRef.current = workletNode

    isRecordingRef.current = true
    setIsRecording(true)
    updateVisualizer()
  }, [handleWorkletMessage, updateVisualizer])

  const cleanupConnection = useCallback(() => {
    wsRef.current = null
    setIsConnecting(false)
    setIsConnected(false)
    void stopRecording()
  }, [stopRecording])

  const disconnect = useCallback(() => {
    const ws = wsRef.current
    if (!ws) {
      cleanupConnection()
      return
    }

    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
      return
    }

    cleanupConnection()
  }, [cleanupConnection])

  const connect = useCallback(async () => {
    if (wsRef.current || isConnecting) {
      return
    }

    setErrorMessage(null)
    setIsConnecting(true)

    const playbackContext = ensurePlaybackContext()
    if (playbackContext.state === 'suspended') {
      await playbackContext.resume()
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      setIsConnecting(false)
      setIsConnected(true)
      void startRecording().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to start recording.'
        setErrorMessage(message)
        ws.close()
      })
    })

    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        console.warn('Ignored websocket message: expected response envelope text.')
        return
      }

      const responseEnvelope = parseLiveResponseEnvelope(event.data)
      if (!responseEnvelope) {
        console.warn('Ignored websocket message: invalid response envelope.')
        return
      }

      void match(responseEnvelope)
        .with({ type: LIVE_RESPONSE_ENVELOPE_TYPE.AudioOutputChunk }, async (audioEnvelope) => {
          await playAudio(decodeBase64(audioEnvelope.audioBase64))
        })
        .exhaustive()
    })

    ws.addEventListener('error', () => {
      setErrorMessage('WebSocket connection failed.')
    })

    ws.addEventListener('close', () => {
      cleanupConnection()
    })
  }, [cleanupConnection, ensurePlaybackContext, isConnecting, playAudio, startRecording, wsUrl])

  useEffect(() => {
    return () => {
      disconnect()
      if (playbackContextRef.current) {
        void playbackContextRef.current.close()
        playbackContextRef.current = null
      }
    }
  }, [disconnect])

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

  return (
    <main className="app">
      <section className="panel">
        <header className="header">
          <h1>Gemini Live Gateway</h1>
          <p>WebSocket live audio bridge</p>
        </header>

        <div className={`status ${statusClassName}`}>{statusText}</div>

        <div className="audio-visualizer" aria-hidden="true">
          <div
            className={`visualizer-bar ${audioLevel >= VISUALIZER_ACTIVE_THRESHOLD ? 'active' : ''}`}
            style={{ width: `${audioLevel}%` }}
          />
        </div>

        <div className="controls">
          <button type="button" className="btn-primary" onClick={() => void connect()} disabled={isConnecting || isConnected}>
            Connect
          </button>
          <button type="button" className="btn-danger" onClick={disconnect} disabled={!isConnected && !isConnecting}>
            Disconnect
          </button>
        </div>

        <dl className="meta">
          <div>
            <dt>WebSocket endpoint</dt>
            <dd>{wsUrl}</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}

export default App
