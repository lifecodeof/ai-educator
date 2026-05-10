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
  } = useLiveGateway(wsUrl)
  const { statusClassName, statusText } = useConnectionStatus({
    errorMessage,
    isRecording,
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

            {isRecording && !isProcessing && !isPlayingAudio && (
              <div className="threshold-control">
                <label htmlFor="threshold-slider">
                  Auto-submit silence threshold:{" "}
                  <strong>{silenceThreshold}%</strong>
                </label>
                <input
                  id="threshold-slider"
                  type="range"
                  min="1"
                  max="90"
                  value={silenceThreshold}
                  onChange={(e) => setSilenceThreshold(Number(e.target.value))}
                  className="threshold-slider"
                />
                <span className="threshold-hint">
                  Auto-submits after 1s of silence below this level
                </span>
              </div>
            )}

            <div className="threshold-control voice-control">
              <label htmlFor="voice-interrupt-enabled">
                <input
                  id="voice-interrupt-enabled"
                  type="checkbox"
                  checked={voiceInterruptEnabled}
                  onChange={(e) => setVoiceInterruptEnabled(e.target.checked)}
                />{" "}
                Voice interruption
              </label>
              <input
                id="voice-interrupt-threshold"
                type="range"
                min="1"
                max="90"
                value={voiceInterruptThreshold}
                onChange={(e) =>
                  setVoiceInterruptThreshold(Number(e.target.value))
                }
                className="threshold-slider"
                disabled={!voiceInterruptEnabled}
              />
              <span className="threshold-hint">
                Interrupts the model immediately when your voice exceeds this
                level
              </span>
            </div>

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
              {isRecording && !isPlayingAudio && !isProcessing && (
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
                    {transcript &&
                      `(${transcript.split("\n\n").length} responses)`}
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
