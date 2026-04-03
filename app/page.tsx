'use client'

import dynamic from 'next/dynamic'

// MiniKit and World App APIs require browser globals (window, etc.).
// ssr: false prevents Next.js from evaluating these during build / SSR.
const MiniKitProvider = dynamic(
  () => import('@/components/minikit-provider').then(m => ({ default: m.MiniKitProvider })),
  { ssr: false },
)

const AcuaApp = dynamic(
  () => import('@/components/acua-app'),
  { ssr: false },
)

export default function Page() {
  return (
    <MiniKitProvider>
      <AcuaApp />
    </MiniKitProvider>
  )
}
