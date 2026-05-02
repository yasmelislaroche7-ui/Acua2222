'use client'

import { useState, useEffect, useCallback } from 'react'

export interface CountdownState {
  ready:     boolean   // true when targetTs <= now
  totalSecs: number    // seconds remaining (0 if ready)
  hh:        number
  mm:        number
  ss:        number
  label:     string    // "02h 14m 07s" or "Disponible"
  progress:  number    // 0–1, fraction of delay elapsed
}

/**
 * Returns a live countdown toward `targetTs` (unix seconds or ms bigint/number).
 * If `totalDelaySecs` provided, also exposes a 0-1 progress fraction.
 */
export function useCountdown(
  targetTs: number | bigint | null | undefined,
  totalDelaySecs = 0,
): CountdownState {
  const getState = useCallback((): CountdownState => {
    if (targetTs == null) {
      return { ready: true, totalSecs: 0, hh: 0, mm: 0, ss: 0, label: 'Disponible', progress: 1 }
    }
    const ts = typeof targetTs === 'bigint' ? Number(targetTs) : targetTs
    // auto-detect ms vs seconds
    const targetSec = ts > 1e12 ? ts / 1000 : ts
    const nowSec    = Date.now() / 1000
    const remaining = Math.max(0, Math.ceil(targetSec - nowSec))

    if (remaining === 0) {
      return { ready: true, totalSecs: 0, hh: 0, mm: 0, ss: 0, label: 'Disponible', progress: 1 }
    }

    const hh = Math.floor(remaining / 3600)
    const mm = Math.floor((remaining % 3600) / 60)
    const ss = remaining % 60

    let label: string
    if (hh > 0)       label = `${hh}h ${mm.toString().padStart(2,'0')}m`
    else if (mm > 0)  label = `${mm}m ${ss.toString().padStart(2,'0')}s`
    else              label = `${ss}s`

    const progress = totalDelaySecs > 0
      ? Math.min(1, 1 - remaining / totalDelaySecs)
      : 0

    return { ready: false, totalSecs: remaining, hh, mm, ss, label, progress }
  }, [targetTs, totalDelaySecs])

  const [state, setState] = useState<CountdownState>(getState)

  useEffect(() => {
    setState(getState())
    if (state.ready) return
    const iv = setInterval(() => {
      const next = getState()
      setState(next)
      if (next.ready) clearInterval(iv)
    }, 1000)
    return () => clearInterval(iv)
  }, [targetTs, totalDelaySecs]) // eslint-disable-line

  return state
}

/** Compute target unlock timestamp given lastAction (unix seconds) + delay (seconds) */
export function unlockAt(lastActionSec: number | bigint, delaySec: number): number {
  const last = typeof lastActionSec === 'bigint' ? Number(lastActionSec) : lastActionSec
  return last + delaySec
}
