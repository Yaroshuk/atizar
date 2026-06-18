import { useEffect, useRef } from 'react'

// A warp starfield: points stream from the center outward (flying forward through space),
// leaving short trails as they accelerate past the camera. Warm-tinted to sit under the ember
// brand. Pure canvas + requestAnimationFrame; respects prefers-reduced-motion (renders a still
// field, no motion). Decorative only — aria-hidden.
type Star = { x: number; y: number; z: number; pz: number }

const STAR_COUNT = 520
const SPEED = 0.018 // fraction of depth per frame

export const Starfield = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
    let w = 0
    let h = 0
    let dpr = 1
    const stars: Star[] = []

    const spawn = (): Star => ({
      x: (Math.random() * 2 - 1) * 1000,
      y: (Math.random() * 2 - 1) * 1000,
      z: Math.random() * 1000,
      pz: 0,
    })
    for (let i = 0; i < STAR_COUNT; i++) {
      const st = spawn()
      st.pz = st.z
      stars.push(st)
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    const draw = (move: boolean) => {
      ctx.fillStyle = '#120d0a'
      ctx.fillRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      for (const st of stars) {
        if (move) {
          st.z -= SPEED * 1000
          if (st.z < 1) {
            Object.assign(st, spawn())
            st.z = 1000
            st.pz = st.z
          }
        }
        const sx = cx + (st.x / st.z) * cx
        const sy = cy + (st.y / st.z) * cy
        const px = cx + (st.x / st.pz) * cx
        const py = cy + (st.y / st.pz) * cy
        st.pz = st.z
        const depth = 1 - st.z / 1000
        const r = Math.max(0.4, depth * 2.0)
        // warm star: cream core drifting to ember as it nears
        const g = Math.round(210 - depth * 40)
        const b = Math.round(180 - depth * 110)
        ctx.strokeStyle = `rgba(245, ${g}, ${b}, ${0.25 + depth * 0.6})`
        ctx.lineWidth = r
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(sx, sy)
        ctx.stroke()
      }
    }

    if (reduced) {
      draw(false) // single still frame
      return () => window.removeEventListener('resize', resize)
    }

    const loop = () => {
      draw(true)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className='atz-starfield' aria-hidden='true' />
}
