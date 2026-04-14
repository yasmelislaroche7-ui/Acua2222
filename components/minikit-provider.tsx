'use client'

import { MiniKit } from '@worldcoin/minikit-js'
import { useEffect, useState } from 'react'

export function MiniKitProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).WorldApp) {
      console.log('[v0] MiniKitProvider: World App bridge unavailable in this environment')
      setReady(true)
      return
    }

    console.log('[v0] MiniKitProvider: calling MiniKit.install()')
    MiniKit.install(process.env.NEXT_PUBLIC_WORLD_APP_ID)
    const installed = Boolean((window as any).MiniKit)
    console.log('[v0] MiniKitProvider: isInstalled after install() =', installed)
    console.log('[v0] MiniKitProvider: MiniKit.walletAddress =', MiniKit.walletAddress)
    console.log('[v0] MiniKitProvider: window.WorldApp =', typeof window !== 'undefined' ? (window as any).WorldApp : 'N/A')
    setReady(true)
  }, [])

  // Render children immediately so there is no flash,
  // but consumers must check isInstalled inside their own effects (after mount).
  return <>{children}</>
}
