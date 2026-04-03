'use client'

import { useEffect } from 'react'

export function ErudaProvider() {
  useEffect(() => {
    // Load eruda from CDN, then init — runs only once on mount
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/eruda'
    script.onload = () => {
      ;(window as any).eruda.init()
      console.log('[eruda] initialized')
    }
    document.head.appendChild(script)
    return () => {
      try { ;(window as any).eruda?.destroy() } catch {}
      script.remove()
    }
  }, [])

  return null
}
