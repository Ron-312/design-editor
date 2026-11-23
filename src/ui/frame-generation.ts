import { createContext, useContext, useEffect, useState } from 'react'
import type { ProbeClient } from './probe-client'

/**
 * Counts the probe's `ready` messages. A structural edit reloads the frame before the new index
 * arrives, so a panel that reads the artboard per index also reads again on each new generation.
 */
export const FrameGeneration = createContext(0)

export function useFrameGeneration(): number {
  return useContext(FrameGeneration)
}

export function useProbeReadyCount(probe: ProbeClient | null): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!probe) return
    return probe.onMessage((message) => {
      if (message.type === 'ready') setCount((current) => current + 1)
    })
  }, [probe])
  return count
}
