import { useCallback, useEffect, useRef, useState } from 'react'

// Play a brief EXIT animation before a modal unmounts, mirroring its open animation. `dismiss()`
// flips `closing` to true (the modal adds a `closing` class that runs the reverse keyframes), then
// fires the real `onClose` after `ms` so the parent unmounts once the animation has played. Without
// this a modal vanishes in one frame; with it, close feels symmetric to open. The pending timer is
// cleared on unmount so a late fire can't call into a gone tree.
export function useDismiss(
  onClose: () => void,
  ms = 190
): { closing: boolean; dismiss: () => void } {
  const [closing, setClosing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const dismiss = useCallback(() => {
    setClosing(true)
    timer.current = setTimeout(onClose, ms)
  }, [onClose, ms])
  return { closing, dismiss }
}
