import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { TraceSpike } from './spike/TraceSpike.js'
import './styles.css'

const spike = new URLSearchParams(window.location.search).get('spike') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{spike ? <TraceSpike /> : <App />}</StrictMode>
)
