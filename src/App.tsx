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
    isProcessing,
    audioLevel,
    errorMessage,
    markdown,
    connect,
    disconnect,
    submitRecording,
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
          {isRecording && (
            <button
              type="button"
              className={`btn-primary ${isProcessing ? 'processing' : ''}`}
              onClick={submitRecording}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Submit Recording'}
            </button>
          )}
        </div>

        {markdown && <MarkdownOutput markdown={markdown} />}
      </section>
    </main>
  )
}

export default App
