import { useCallback, useEffect, useRef, useState } from "react"
import { match } from "ts-pattern"
import { sendMessage as sendLiveRequest } from "../../shared/live-request"
import { handleResponse as handleLiveResponse } from "../../shared/live-response"
import { decodeBase64, encodeBase64 } from "../audio/base64"
import { getAudioContextCtor } from "../audio/audio-context"
import { PLAYBACK_SAMPLE_RATE, RECORDING_SAMPLE_RATE } from "../audio/constants"
import { convertFloat32ToInt16 } from "../audio/pcm"

interface UseLiveGatewayResult {
  isConnecting: boolean
  isConnected: boolean
  isRecording: boolean
  isPlayingAudio: boolean
  isProcessing: boolean
  voiceInterruptEnabled: boolean
  voiceInterruptThreshold: number
  audioLevel: number
  silenceThreshold: number
  setSilenceThreshold: (threshold: number) => void
  setVoiceInterruptEnabled: (enabled: boolean) => void
  setVoiceInterruptThreshold: (threshold: number) => void
  errorMessage: string | null
  transcript: string
  document: string
  currentView: "transcript" | "document"
  setCurrentView: (view: "transcript" | "document") => void
  connect: () => Promise<void>
  disconnect: () => void
  submitRecording: () => void
  interruptSpeech: () => void
  cancelProcessing: () => void
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
  const isPlayingAudioRef = useRef(false)
  const isProcessingRef = useRef(false)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAudioLevelRef = useRef(0)
  const silenceThresholdRef = useRef(15)
  const voiceInterruptEnabledRef = useRef(true)
  const voiceInterruptThresholdRef = useRef(35)
  const interruptSpeechRef = useRef<(() => void) | null>(null)
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([])

  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [voiceInterruptEnabled, setVoiceInterruptEnabled] = useState(true)
  const [voiceInterruptThreshold, setVoiceInterruptThreshold] = useState(35)
  const [audioLevel, setAudioLevel] = useState(0)
  const [silenceThreshold, setSilenceThreshold] = useState(15)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string>("")
  const [document, setDocument] = useState<string>("")
  const [currentView, setCurrentView] = useState<"transcript" | "document">(
    "document",
  )

  useEffect(() => {
    isPlayingAudioRef.current = isPlayingAudio
  }, [isPlayingAudio])

  useEffect(() => {
    isProcessingRef.current = isProcessing
  }, [isProcessing])

  useEffect(() => {
    silenceThresholdRef.current = silenceThreshold
  }, [silenceThreshold])

  useEffect(() => {
    voiceInterruptEnabledRef.current = voiceInterruptEnabled
  }, [voiceInterruptEnabled])

  useEffect(() => {
    voiceInterruptThresholdRef.current = voiceInterruptThreshold
  }, [voiceInterruptThreshold])

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
      if (playbackContext.state === "suspended") {
        await playbackContext.resume()
      }

      const pcmData = new Int16Array(arrayBuffer)
      const audioBuffer = playbackContext.createBuffer(
        1,
        pcmData.length,
        PLAYBACK_SAMPLE_RATE,
      )
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

      setIsPlayingAudio(true)
      isPlayingAudioRef.current = true
      playbackSourcesRef.current.push(source)

      source.addEventListener("ended", () => {
        playbackSourcesRef.current = playbackSourcesRef.current.filter(
          (s) => s !== source,
        )
        if (playbackSourcesRef.current.length === 0) {
          isPlayingAudioRef.current = false
          setIsPlayingAudio(false)
        }
      })

      source.start(nextPlaybackStartRef.current)
      nextPlaybackStartRef.current += audioBuffer.duration
    },
    [ensurePlaybackContext],
  )

  const updateVisualizer = useCallback(() => {
    const tick = () => {
      if (
        !analyserRef.current ||
        (!isRecordingRef.current && !isPlayingAudioRef.current)
      ) {
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
      lastAudioLevelRef.current = level

      if (isPlayingAudioRef.current) {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = null
        }
        if (
          voiceInterruptEnabledRef.current &&
          level >= voiceInterruptThresholdRef.current
        ) {
          interruptSpeechRef.current?.()
        }
      } else if (!isProcessingRef.current) {
        // Auto-submit if below threshold for 1 second while the user is speaking.
        if (level < silenceThresholdRef.current) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              const ws = wsRef.current
              if (
                ws &&
                ws.readyState === WebSocket.OPEN &&
                isRecordingRef.current &&
                !isProcessingRef.current &&
                !isPlayingAudioRef.current
              ) {
                setIsProcessing(true)
                sendLiveRequest(ws, { type: "submitRequest" })
              }
              silenceTimerRef.current = null
            }, 1000)
          }
        } else {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        }
      } else if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }

      animationFrameRef.current = requestAnimationFrame(tick)
    }

    tick()
  }, [])

  const handleWorkletMessage = useCallback(
    (event: MessageEvent<Float32Array>) => {
      const ws = wsRef.current
      // Don't record while processing or not recording
      if (
        !isRecordingRef.current ||
        !ws ||
        ws.readyState !== WebSocket.OPEN ||
        isProcessingRef.current ||
        isPlayingAudioRef.current
      ) {
        return
      }

      const pcmInt16 = convertFloat32ToInt16(event.data)
      sendLiveRequest(ws, {
        type: "audioInputChunk",
        audioBase64: encodeBase64(new Uint8Array(pcmInt16.buffer)),
        mimeType: "audio/pcm;rate=16000",
      })
    },
    [],
  )

  const stopRecording = useCallback(async () => {
    isRecordingRef.current = false
    isPlayingAudioRef.current = false
    isProcessingRef.current = false
    setIsRecording(false)
    setIsPlayingAudio(false)
    setIsProcessing(false)

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

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
    setIsProcessing(false)
    isProcessingRef.current = false
  }, [])

  const startRecording = useCallback(async () => {
    // Don't start recording while processing
    if (isRecordingRef.current || isProcessingRef.current) {
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage(
        "Microphone access is not available. Please use HTTPS or check browser permissions.",
      )
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

      await recordingContext.audioWorklet.addModule("/audio-processor.js")

      const source = recordingContext.createMediaStreamSource(micStream)
      const analyser = recordingContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8

      const workletNode = new AudioWorkletNode(
        recordingContext,
        "microphone-stream-processor",
      )
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
      console.error("Failed to start recording:", error)
    }
  }, [handleWorkletMessage, updateVisualizer, isProcessing])

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

    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
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
    if (playbackContext.state === "suspended") {
      await playbackContext.resume()
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.addEventListener("open", () => {
      setIsConnecting(false)
      setIsConnected(true)
      void startRecording().catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Failed to start recording."
        setErrorMessage(message)
        ws.close()
      })
    })

  const cleanupResponseHandler = handleLiveResponse(ws, (response) => {
      void match(response)
        .with({ type: "audioOutputChunk" }, async (audioResponse) => {
          await playAudio(decodeBase64(audioResponse.audioBase64))
          if (audioResponse.transcript) {
            setTranscript((prev) =>
              prev
                ? prev + "\n\n" + audioResponse.transcript
                : audioResponse.transcript!,
            )
          }
        })
        .with({ type: "markdownChunk" }, ({ content }) => {
          setDocument((prev) => prev + content)
        })
        .with({ type: "requestComplete" }, () => {
          isProcessingRef.current = false
          setIsProcessing(false)
        })
        .with({ type: "error" }, ({ message, statusCode }) => {
          isProcessingRef.current = false
          setIsProcessing(false)
          const errorDisplay = statusCode
            ? `[${statusCode}] ${message}`
            : message
          setErrorMessage(errorDisplay)
        })
        .exhaustive()
    })

    ws.addEventListener("error", () => {
      setErrorMessage("WebSocket connection failed.")
    })

    ws.addEventListener("close", () => {
      cleanupResponseHandler()
      cleanupConnection()
    })
  }, [
    cleanupConnection,
    ensurePlaybackContext,
    isConnecting,
    playAudio,
    startRecording,
    wsUrl,
  ])

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
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    isProcessingRef.current = true
    setIsProcessing(true)
    sendLiveRequest(ws, {
      type: "submitRequest",
    })
  }, [])

  const interruptSpeech = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    playbackSourcesRef.current.forEach((source) => {
      source.stop()
    })
    playbackSourcesRef.current = []
    isPlayingAudioRef.current = false
    setIsPlayingAudio(false)
    nextPlaybackStartRef.current = 0
  }, [])

  useEffect(() => {
    interruptSpeechRef.current = interruptSpeech
  }, [interruptSpeech])

  const cancelProcessing = useCallback(() => {
    isProcessingRef.current = false
    setIsProcessing(false)
  }, [])

  return {
    isConnecting,
    isConnected,
    isRecording,
    isPlayingAudio,
    isProcessing,
    voiceInterruptEnabled,
    voiceInterruptThreshold,
    audioLevel,
    silenceThreshold,
    setSilenceThreshold,
    setVoiceInterruptEnabled,
    setVoiceInterruptThreshold,
    errorMessage,
    transcript,
    document,
    currentView,
    setCurrentView,
    connect,
    disconnect,
    submitRecording,
    interruptSpeech,
    cancelProcessing,
  }
}
