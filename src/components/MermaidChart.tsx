import mermaid from "mermaid"
import { useEffect, useId, useRef, useState } from "react"

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
})

interface MermaidChartProps {
  chart: string
}

export function MermaidChart({ chart }: MermaidChartProps) {
  const id = useId().replace(/:/g, "")
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    setError(null)

    let cancelled = false

    mermaid
      .render(`mermaid-${id}`, chart)
      .then(({ svg }) => {
        if (!cancelled && ref.current) ref.current.innerHTML = svg
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Mermaid render error")
      })

    return () => {
      cancelled = true
      node.innerHTML = ""
    }
  }, [chart, id])

  if (error) {
    return <pre className="mermaid-error">{error}</pre>
  }

  return <div className="mermaid-chart" ref={ref} />
}
