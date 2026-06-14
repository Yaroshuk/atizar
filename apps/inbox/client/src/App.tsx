import { useEffect, useState } from 'react'
import { BoardApp } from './BoardApp/BoardApp'
import { workflowsConfig } from './workflows'

type Config = { demo: boolean; workflows: string[] }

export const App = () => {
  const [config, setConfig] = useState<Config | null>(null)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c: Config) => setConfig(c))
      .catch(() =>
        setConfig({ demo: false, workflows: workflowsConfig.workflows.map((w) => w.id) })
      )
  }, [])

  if (!config) return null // brief load before config resolves (acceptable for the demo)

  const enabled = new Set(config.workflows)
  const filtered = {
    ...workflowsConfig,
    workflows: workflowsConfig.workflows.filter((w) => enabled.has(w.id)),
  }
  return <BoardApp config={filtered} demo={config.demo} />
}
