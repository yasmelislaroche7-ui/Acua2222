'use client'

import { MiniKit } from '@worldcoin/minikit-js'
import { useEffect } from 'react'

// appId configured in Worldcoin Developer Portal (also available as env var)
const WORLD_APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID ?? 'app_60f2dc429532dcfa014c16d52ddc00fe'

export function MiniKitProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      MiniKit.install(WORLD_APP_ID)
      if (typeof window !== 'undefined' && (window as any).WorldApp) {
        console.log('[MiniKit] instalado correctamente — appId=%s isInstalled=%s walletAddress=%s',
          WORLD_APP_ID, MiniKit.isInstalled(), MiniKit.walletAddress)
      }
    } catch (err) {
      console.error('[MiniKit] error al instalar:', err)
    }
  }, [])

  return <>{children}</>
}
