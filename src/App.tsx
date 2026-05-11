import { memo, useEffect } from "react"
import type React from "react"
import ReactMarkdown from "react-markdown"
import { MermaidChart } from "./components/MermaidChart"
import { useConnectionStatus } from "./hooks/useConnectionStatus"
import { useLiveGateway } from "./hooks/useLiveGateway"
import { useWebSocketUrl } from "./hooks/useWebSocketUrl"
import "./App.css"
import greetingUrl from "../greeting.mp3"

const markdownComponents = {
  code({
    className,
    children,
  }: {
    className?: string
    children?: React.ReactNode
  }) {
    const lang = /language-(\w+)/.exec(className ?? "")?.[1]
    if (lang === "mermaid") {
      return <MermaidChart chart={String(children).trim()} />
    }
    return <code className={className}>{children}</code>
  },
}

const MarkdownOutput = memo(function MarkdownOutput({
  markdown,
}: {
  markdown: string
}) {
  return (
    <div className="markdown-output markdown-two-page">
      <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
    </div>
  )
})

function App() {
  const wsUrl = useWebSocketUrl()
  const {
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
  } = useLiveGateway(wsUrl)
  useEffect(() => {
    try {
      const audio = new Audio(greetingUrl)
      // Attempt autoplay; ignore failures (browser may block autoplay)
      void audio.play().catch(() => {})
      return () => {
        try {
          audio.pause()
          audio.src = ""
        } catch {
          // ignore cleanup errors
        }
      }
    } catch (err) {
      // ignore
    }
  }, [])
  const { statusClassName, statusText } = useConnectionStatus({
    errorMessage,
    isListening,
    isPlayingAudio,
    isProcessing,
    isConnected,
    isConnecting,
  })

  return (
    <main className="app">
      <section className="panel">
        <div className="panel-layout">
          <div className="control-pane">
            <header className="header">
              <h1>AI Educator</h1>
            </header>

            <div className={`status ${statusClassName}`}>{statusText}</div>

            {isProcessing && (
              <div className="processing-indicator">
                <div className="spinner" />
                <span>Processing response...</span>
              </div>
            )}

            <div className="speech-control">
              <label htmlFor="trigger-word">Trigger word</label>
              <input
                id="trigger-word"
                type="text"
                value={triggerWord}
                onChange={(e) => setTriggerWord(e.target.value)}
                className="text-input"
                placeholder="soru"
                spellCheck={false}
              />
              <span className="speech-control-hint">
                SpeechRecognition submits final text once it hears this word.
              </span>
            </div>

            {isListening && draftTranscript && (
              <div className="draft-transcript">
                <span className="draft-transcript-label">Live transcript</span>
                <div className="draft-transcript-text">{draftTranscript}</div>
              </div>
            )}

            <div className="controls">
              <button
                type="button"
                className="btn-primary"
                onClick={() => void connect()}
                disabled={isConnecting || isConnected}
              >
                Connect
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={disconnect}
                disabled={!isConnected && !isConnecting}
              >
                Disconnect
              </button>
              {isPlayingAudio && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={interruptSpeech}
                >
                  Interrupt
                </button>
              )}
              {isProcessing && !isPlayingAudio && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={cancelProcessing}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="content-pane">
            {document || transcript ? (
              <>
                <div className="view-toggle">
                  <button
                    type="button"
                    className={`view-btn ${currentView === "document" ? "active" : ""}`}
                    onClick={() => setCurrentView("document")}
                  >
                    Document {document && `(${document.length})`}
                  </button>
                  <button
                    type="button"
                    className={`view-btn ${currentView === "transcript" ? "active" : ""}`}
                    onClick={() => setCurrentView("transcript")}
                  >
                    Transcript{" "}
                    {transcript && `(${transcript.split("\n\n").length} entries)`}
                  </button>
                </div>

                <div className="output-pane">
                  {currentView === "document" && document && (
                    <MarkdownOutput markdown={document} />
                  )}
                  {currentView === "transcript" && transcript && (
                    <div className="transcript-output">
                      <div className="transcript-content">{transcript}</div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-output">
                Connect and speak to generate document markdown and transcript.
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

export default App
