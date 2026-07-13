'use client'

import { useState } from 'react'
import { Zap, Gem } from 'lucide-react'
import { StakeV4Panel } from '@/components/stake-v4-panel'
import { StakeV5Panel } from '@/components/stake-v5-panel'
import { type WalletMode } from '@/lib/tx-signer'
import { cn } from '@/lib/utils'

interface Props {
  userAddress: string
  walletMode?: WalletMode | null
  importedSigner?: any
  isAdmin?: boolean
}

const TABS = [
  { id: 'v4', label: 'Stake V4', sub: 'Solo retiro', icon: Zap,  color: 'text-purple-400',  border: 'border-purple-500/50', bg: 'bg-purple-500/15' },
  { id: 'v5', label: 'Stake V5', sub: '5% Fee',      icon: Gem,  color: 'text-fuchsia-400', border: 'border-fuchsia-500/50', bg: 'bg-fuchsia-500/15' },
]

export function StakeV45ComboPanel({ userAddress, walletMode, importedSigner, isAdmin = false }: Props) {
  const [sub, setSub] = useState<'v4' | 'v5'>('v4')
  const wm = (walletMode ?? 'minikit') as WalletMode

  return (
    <div className="space-y-4 pb-2">
      <div className="flex gap-2">
        {TABS.map(t => {
          const Icon = t.icon
          const active = sub === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id as 'v4' | 'v5')}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border transition-all',
                active ? cn(t.bg, t.border) : 'border-border/30 bg-white/3 hover:bg-white/5',
              )}
            >
              <Icon className={cn('w-4 h-4', active ? t.color : 'text-muted-foreground')} />
              <span className={cn('text-[11px] font-bold leading-none', active ? t.color : 'text-muted-foreground')}>{t.label}</span>
              <span className="text-[9px] text-muted-foreground/60">{t.sub}</span>
            </button>
          )
        })}
      </div>

      {sub === 'v4' && (
        <StakeV4Panel
          userAddress={userAddress}
          walletMode={wm}
          importedSigner={importedSigner}
          isAdmin={isAdmin}
        />
      )}
      {sub === 'v5' && (
        <StakeV5Panel
          userAddress={userAddress}
          walletMode={wm}
          importedSigner={importedSigner}
          isAdmin={isAdmin}
        />
      )}
    </div>
  )
}
