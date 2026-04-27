import ReactMarkdown from 'react-markdown'
import { MermaidChart } from './components/MermaidChart'
import { VISUALIZER_ACTIVE_THRESHOLD } from './audio/constants'
import { useConnectionStatus } from './hooks/useConnectionStatus'
import { useLiveGateway } from './hooks/useLiveGateway'
import { useWebSocketUrl } from './hooks/useWebSocketUrl'
import './App.css'

function App() {
  const wsUrl = useWebSocketUrl()
  const { isConnecting, isConnected, isRecording, audioLevel, errorMessage, markdown, connect, disconnect } = useLiveGateway(wsUrl)
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

        {markdown && (
          <div className="markdown-output">
            <ReactMarkdown
              components={{
                code({ className, children }) {
                  const lang = /language-(\w+)/.exec(className ?? '')?.[1]
                  if (lang === 'mermaid') {
                    return <MermaidChart chart={String(children).trim()} />
                  }
                  return <code className={className}>{children}</code>
                },
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        )}

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
