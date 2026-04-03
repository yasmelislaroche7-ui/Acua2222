'use client'

import { MiniKit } from '@worldcoin/minikit-js'
import { useEffect, useState } from 'react'

export function MiniKitProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    console.log('[v0] MiniKitProvider: calling MiniKit.install()')
    MiniKit.install()
    const installed = MiniKit.isInstalled()
    console.log('[v0] MiniKitProvider: isInstalled after install() =', installed)
    console.log('[v0] MiniKitProvider: MiniKit.walletAddress =', MiniKit.walletAddress)
    console.log('[v0] MiniKitProvider: window.WorldApp =', typeof window !== 'undefined' ? (window as any).WorldApp : 'N/A')
    setReady(true)
  }, [])

  // Render children immediately so there is no flash,
  // but consumers must check isInstalled inside their own effects (after mount).
  return <>{children}</>
}
