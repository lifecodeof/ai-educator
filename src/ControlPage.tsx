import { useCallback, useEffect, useMemo, useState } from "react"
import "./App.css"

type ControlAction = "start" | "stop"

const getApiBaseUrl = () => window.location.origin

export default function ControlPage() {
  const apiBaseUrl = useMemo(getApiBaseUrl, [])
  const [isRunning, setIsRunning] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setErrorMessage(null)
    const response = await fetch(`${apiBaseUrl}/api/control/status`)
    if (!response.ok) {
      throw new Error("Unable to load control state.")
    }

    const payload = (await response.json()) as { isRunning: boolean }
    setIsRunning(payload.isRunning)
  }, [apiBaseUrl])

  useEffect(() => {
    void fetchStatus().catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Unable to load control state."
      setErrorMessage(message)
    })
  }, [fetchStatus])

  const updateControl = useCallback(
    async (action: ControlAction) => {
      setIsLoading(true)
      setErrorMessage(null)
      try {
        const response = await fetch(`${apiBaseUrl}/api/control/${action}`, {
          method: "POST",
        })
        if (!response.ok) {
          throw new Error(`Unable to ${action} live API.`)
        }

        const payload = (await response.json()) as { isRunning: boolean }
        setIsRunning(payload.isRunning)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Control action failed."
        setErrorMessage(message)
      } finally {
        setIsLoading(false)
      }
    },
    [apiBaseUrl],
  )

  return (
    <main className="app">
      <section className="panel control-panel">
        <header className="header">
          <h1>Live API Control</h1>
          <p>Durable object state management</p>
        </header>

        <div
          className={`status ${
            isRunning === null ? "connecting" : isRunning ? "connected" : "error"
          }`}
        >
          {isRunning === null
            ? "Loading state..."
            : isRunning
              ? "Running"
              : "Stopped"}
        </div>

        <div className="controls control-buttons">
          <button
            type="button"
            className="btn-primary"
            disabled={isLoading || isRunning === true}
            onClick={() => void updateControl("start")}
          >
            Start
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={isLoading || isRunning === false}
            onClick={() => void updateControl("stop")}
          >
            Stop
          </button>
        </div>

        <div className="controls control-buttons">
          <a className="control-link" href="/">
            Open educator page
          </a>
          <button
            type="button"
            className="btn-primary"
            disabled={isLoading}
            onClick={() => void fetchStatus()}
          >
            Refresh
          </button>
        </div>

        {errorMessage && <p className="error-text">{errorMessage}</p>}
      </section>
    </main>
  )
}
