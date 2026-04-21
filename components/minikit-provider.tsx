'use client'

import { MiniKit } from '@worldcoin/minikit-js'
import { useEffect } from 'react'

export function MiniKitProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // MiniKit.install() — no appId param in v1.x (configured in Developer Portal)
    MiniKit.install()
  }, [])

  return <>{children}</>
}
