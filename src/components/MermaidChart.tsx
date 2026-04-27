import mermaid from 'mermaid'
import { useEffect, useId, useRef, useState } from 'react'

mermaid.initialize({ startOnLoad: false, theme: 'default' })

interface MermaidChartProps {
  chart: string
}

export function MermaidChart({ chart }: MermaidChartProps) {
  const id = useId().replace(/:/g, '')
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ref.current) return
    setError(null)

    mermaid
      .render(`mermaid-${id}`, chart)
      .then(({ svg }) => {
        if (ref.current) ref.current.innerHTML = svg
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Mermaid render error')
      })
  }, [chart, id])

  if (error) {
    return (
      <pre className="mermaid-error">{error}</pre>
    )
  }

  return <div className="mermaid-chart" ref={ref} />
}
