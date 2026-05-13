import { useCallback, useEffect, useRef, useState } from "react"
import { match } from "ts-pattern"
import { sendMessage as sendLiveRequest } from "../../shared/live-request"
import { handleResponse as handleLiveResponse } from "../../shared/live-response"
import { decodeBase64 } from "../audio/base64"
import { getAudioContextCtor } from "../audio/audio-context"
import { PLAYBACK_SAMPLE_RATE } from "../audio/constants"

interface UseLiveGatewayResult {
  isConnecting: boolean
  isConnected: boolean
  isListening: boolean
  isPlayingAudio: boolean
  isProcessing: boolean
  draftTranscript: string
  triggerWord: string
  setTriggerWord: (word: string) => void
  errorMessage: string | null
  transcript: string
  document: string
  currentView: "transcript" | "document"
  setCurrentView: (view: "transcript" | "document") => void
  connect: () => Promise<void>
  disconnect: () => void
  interruptSpeech: () => void
  cancelProcessing: () => void
}

const getSpeechRecognitionCtor = () =>
  window.SpeechRecognition ?? window.webkitSpeechRecognition

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const MIN_LISTEN_DURATION_MS = 5000

export function useLiveGateway(wsUrl: string): UseLiveGatewayResult {
  const wsRef = useRef<WebSocket | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const keepListeningRef = useRef(false)
  const isListeningRef = useRef(false)
  const isPlayingAudioRef = useRef(false)
  const isProcessingRef = useRef(false)
  const listenStartedAtRef = useRef(0)
  const lastSubmittedTranscriptRef = useRef("")
  const playbackContextRef = useRef<AudioContext | null>(null)
  const nextPlaybackStartRef = useRef(0)
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([])

  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [draftTranscript, setDraftTranscript] = useState("")
  const [triggerWord, setTriggerWord] = useState("soru")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string>("")
  const [document, setDocument] = useState<string>("")
  const [currentView, setCurrentView] = useState<"transcript" | "document">(
    "document",
  )

  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  useEffect(() => {
    isPlayingAudioRef.current = isPlayingAudio
  }, [isPlayingAudio])

  useEffect(() => {
    isProcessingRef.current = isProcessing
  }, [isProcessing])

  const ensurePlaybackContext = useCallback(() => {
    if (!playbackContextRef.current) {
      const AudioContextCtor = getAudioContextCtor()
      playbackContextRef.current = new AudioContextCtor({
        sampleRate: PLAYBACK_SAMPLE_RATE,
      })
    }
    return playbackContextRef.current
  }, [])

  const appendTranscriptEntry = useCallback((entry: string) => {
    setTranscript((prev) => (prev ? `${prev}\n\n${entry}` : entry))
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
          (candidate) => candidate !== source,
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

  const submitRecognizedText = useCallback(
    (text: string) => {
      const normalizedText = text.trim()
      const ws = wsRef.current

      if (!normalizedText) {
        return
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setErrorMessage("WebSocket connection is not open.")
        return
      }

      isProcessingRef.current = true
      setIsProcessing(true)
      lastSubmittedTranscriptRef.current = normalizedText
      appendTranscriptEntry(`You: ${normalizedText}`)
      setDraftTranscript("")

      sendLiveRequest(ws, {
        type: "textInputChunk",
        text: normalizedText,
        isFinished: true,
      })
    },
    [appendTranscriptEntry],
  )

  const wireRecognitionHandlers = useCallback(
    (recognition: SpeechRecognition, currentTriggerWord: string) => {
      recognition.onstart = () => {
        listenStartedAtRef.current = Date.now()
        isListeningRef.current = true
        setIsListening(true)
        setErrorMessage(null)
      }

      recognition.onresult = (event) => {
        const changedResults = Array.from(event.results).slice(
          event.resultIndex,
        )
        const currentTranscript = changedResults
          .map((result) => result[0]?.transcript?.trim() ?? "")
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()

        setDraftTranscript(currentTranscript)

        const hasFinalResult = changedResults.some((result) => result.isFinal)
        if (
          !hasFinalResult ||
          Date.now() - listenStartedAtRef.current < MIN_LISTEN_DURATION_MS
        ) {
          return
        }

        const normalizedTrigger = currentTriggerWord.trim().toLowerCase()
        if (normalizedTrigger) {
          const triggerPattern = new RegExp(
            `\\b${escapeRegExp(normalizedTrigger)}\\b`,
            "i",
          )
          if (!triggerPattern.test(currentTranscript)) {
            return
          }
        }

        if (
          !currentTranscript ||
          currentTranscript === lastSubmittedTranscriptRef.current
        ) {
          return
        }

        submitRecognizedText(currentTranscript)
      }

      recognition.onerror = (event) => {
        const message = event.message || event.error
        setErrorMessage(`Speech recognition error: ${message}`)
        setIsListening(false)
        isListeningRef.current = false
        if (event.error !== "no-speech" && event.error !== "aborted") {
          keepListeningRef.current = false
        }
      }

      recognition.onend = () => {
        listenStartedAtRef.current = 0
        setIsListening(false)
        isListeningRef.current = false

        if (
          keepListeningRef.current &&
          wsRef.current?.readyState === WebSocket.OPEN
        ) {
          window.setTimeout(() => {
            try {
              recognition.start()
            } catch {
              // Ignore restart races when the browser has already torn down the session.
            }
          }, 200)
        }
      }
    },
    [submitRecognizedText],
  )

  useEffect(() => {
    const recognition = recognitionRef.current
    if (recognition) {
      wireRecognitionHandlers(recognition, triggerWord)
    }
  }, [triggerWord, wireRecognitionHandlers])

  const startRecognition = useCallback(() => {
    const RecognitionCtor = getSpeechRecognitionCtor()
    if (!RecognitionCtor) {
      setErrorMessage("SpeechRecognition is not supported in this browser.")
      return false
    }

    const recognition = new RecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = "tr-TR"

    recognitionRef.current = recognition
    keepListeningRef.current = true
    wireRecognitionHandlers(recognition, triggerWord)

    try {
      recognition.start()
      return true
    } catch (error) {
      recognitionRef.current = null
      keepListeningRef.current = false
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start speech recognition."
      setErrorMessage(message)
      return false
    }
  }, [triggerWord, wireRecognitionHandlers])

  const stopRecognition = useCallback(() => {
    keepListeningRef.current = false
    listenStartedAtRef.current = 0
    const recognition = recognitionRef.current
    recognitionRef.current = null

    if (!recognition) {
      setIsListening(false)
      isListeningRef.current = false
      setDraftTranscript("")
      return
    }

    recognition.onstart = null
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.abort()

    setIsListening(false)
    isListeningRef.current = false
    setDraftTranscript("")
  }, [])

  const cleanupConnection = useCallback(() => {
    wsRef.current = null
    setIsConnecting(false)
    setIsConnected(false)
    stopRecognition()
  }, [stopRecognition])

  const interruptSpeech = useCallback(() => {
    if (playbackSourcesRef.current.length > 0) {
      playbackSourcesRef.current.forEach((source) => {
        source.stop()
      })
      playbackSourcesRef.current = []
    }
    isPlayingAudioRef.current = false
    setIsPlayingAudio(false)
    nextPlaybackStartRef.current = 0
  }, [])

  const disconnect = useCallback(() => {
    keepListeningRef.current = false
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

    const cleanupResponseHandler = handleLiveResponse(ws, (response) => {
      void match(response)
        .with({ type: "audioOutputChunk" }, async (audioResponse) => {
          await playAudio(decodeBase64(audioResponse.audioBase64))
          if (audioResponse.transcript) {
            appendTranscriptEntry(`Assistant: ${audioResponse.transcript}`)
          }
        })
        .with({ type: "markdownChunk" }, ({ content }) => {
          setDocument((prev) => prev + content)
        })
        .with({ type: "requestComplete" }, () => {
          isProcessingRef.current = false
          setIsProcessing(false)
          lastSubmittedTranscriptRef.current = ""
        })
        .with({ type: "error" }, ({ message, statusCode }) => {
          isProcessingRef.current = false
          setIsProcessing(false)
          lastSubmittedTranscriptRef.current = ""
          const errorDisplay = statusCode
            ? `[${statusCode}] ${message}`
            : message
          setErrorMessage(errorDisplay)
        })
        .exhaustive()
    })

    ws.addEventListener("open", () => {
      setIsConnecting(false)
      setIsConnected(true)
      if (!startRecognition()) {
        ws.close()
      }
    })

    ws.addEventListener("error", () => {
      setErrorMessage("WebSocket connection failed.")
    })

    ws.addEventListener("close", () => {
      cleanupResponseHandler()
      cleanupConnection()
    })
  }, [
    appendTranscriptEntry,
    cleanupConnection,
    ensurePlaybackContext,
    isConnecting,
    playAudio,
    startRecognition,
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

  const cancelProcessing = useCallback(() => {
    isProcessingRef.current = false
    setIsProcessing(false)
  }, [])

  return {
    isConnecting,
    isConnected,
    isListening,
    isPlayingAudio,
    isProcessing,
    draftTranscript,
    triggerWord,
    setTriggerWord,
    errorMessage,
    transcript,
    document,
    currentView,
    setCurrentView,
    connect,
    disconnect,
    interruptSpeech,
    cancelProcessing,
  }
}
