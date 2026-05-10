import { memo } from "react"
import type React from "react"
import ReactMarkdown from "react-markdown"
import { MermaidChart } from "./components/MermaidChart"
import { VISUALIZER_ACTIVE_THRESHOLD } from "./audio/constants"
import { useConnectionStatus } from "./hooks/useConnectionStatus"
import { useLiveGateway } from "./hooks/useLiveGateway"
import { useWebSocketUrl } from "./hooks/useWebSocketUrl"
import "./App.css"

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
    <div className="markdown-output">
      <ReactMarkdown components={markdownComponents}>{markdown}</ReactMarkdown>
    </div>
  )
})

function App() {
  const wsUrl = useWebSocketUrl()
  const {
    isConnecting,
    isConnected,
    isRecording,
    isPlayingAudio,
    isProcessing,
    audioLevel,
    silenceThreshold,
    setSilenceThreshold,
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
  } = useLiveGateway(wsUrl)
  const { statusClassName, statusText } = useConnectionStatus({
    errorMessage,
    isRecording,
    isConnected,
    isConnecting,
  })

  return (
    <main className="app">
      <section className="panel">
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

        <div className="audio-visualizer" aria-hidden="true">
          <div
            className={`visualizer-bar ${audioLevel >= VISUALIZER_ACTIVE_THRESHOLD ? "active" : ""}`}
            style={{ width: `${audioLevel}%` }}
          />
          {isRecording && (
            <div
              className="threshold-line"
              style={{ left: `${silenceThreshold}%` }}
              title={`Silence threshold: ${silenceThreshold}%`}
            />
          )}
        </div>

        {isRecording && (
          <div className="threshold-control">
            <label htmlFor="threshold-slider">
              Auto-submit silence threshold:{" "}
              <strong>{silenceThreshold}%</strong>
            </label>
            <input
              id="threshold-slider"
              type="range"
              min="5"
              max="50"
              value={silenceThreshold}
              onChange={(e) => setSilenceThreshold(Number(e.target.value))}
              className="threshold-slider"
            />
            <span className="threshold-hint">
              Auto-submits after 2s of silence below this level
            </span>
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
          {isRecording && !isPlayingAudio && (
            <button
              type="button"
              className={`btn-primary ${isProcessing ? "processing" : ""}`}
              onClick={submitRecording}
              disabled={isProcessing}
            >
              {isProcessing ? "Processing..." : "Submit Recording"}
            </button>
          )}
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

        {(document || transcript) && (
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
                {transcript && `(${transcript.split("\n\n").length} responses)`}
              </button>
            </div>

            {currentView === "document" && document && (
              <MarkdownOutput markdown={document} />
            )}
            {currentView === "transcript" && transcript && (
              <div className="transcript-output">
                <div className="transcript-content">{transcript}</div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}

export default App
