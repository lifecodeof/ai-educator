import { useCallback, useEffect, useRef, useState } from 'react'
import { match } from 'ts-pattern'
import { sendMessage as sendLiveRequest } from '../../shared/live-request'
import { handleResponse as handleLiveResponse } from '../../shared/live-response'
import { decodeBase64, encodeBase64 } from '../audio/base64'
import { getAudioContextCtor } from '../audio/audio-context'
import { PLAYBACK_SAMPLE_RATE, RECORDING_SAMPLE_RATE } from '../audio/constants'
import { convertFloat32ToInt16 } from '../audio/pcm'

interface UseLiveGatewayResult {
  isConnecting: boolean
  isConnected: boolean
  isRecording: boolean
  isProcessing: boolean
  audioLevel: number
  errorMessage: string | null
  markdown: string
  connect: () => Promise<void>
  disconnect: () => void
  submitRecording: () => void
}

export function useLiveGateway(wsUrl: string): UseLiveGatewayResult {
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
  const [isProcessing, setIsProcessing] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState<string>('')

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
    sendLiveRequest(ws, {
      type: 'audioInputChunk',
      audioBase64: encodeBase64(new Uint8Array(pcmInt16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    })
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
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Microphone access is not available. Please use HTTPS or check browser permissions.')
      return
    }

    try {
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
    } catch (error) {
      const err = error as Error
      setErrorMessage(`Microphone error: ${err.message}`)
      console.error('Failed to start recording:', error)
    }
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

    const cleanupResponseHandler = handleLiveResponse(ws, (response) => {
      void match(response)
        .with({ type: 'audioOutputChunk' }, async (audioResponse) => {
          await playAudio(decodeBase64(audioResponse.audioBase64))
        })
        .with({ type: 'markdownChunk' }, ({ content }) => {
          setMarkdown((prev) => prev + content)
        })
        .with({ type: 'requestComplete' }, () => {
          setIsProcessing(false)
        })
        .exhaustive()
    })

    ws.addEventListener('error', () => {
      setErrorMessage('WebSocket connection failed.')
    })

    ws.addEventListener('close', () => {
      cleanupResponseHandler()
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

  const submitRecording = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return
    }
    setIsProcessing(true)
    sendLiveRequest(ws, {
      type: 'submitRequest',
    })
  }, [])

  return {
    isConnecting,
    isConnected,
    isRecording,
    isProcessing,
    audioLevel,
    errorMessage,
    markdown,
    connect,
    disconnect,
    submitRecording,
  }
}
