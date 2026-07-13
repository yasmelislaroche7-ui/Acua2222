'use client'

import { useState } from 'react'
import { Pickaxe, Star } from 'lucide-react'
import { MiningUTH2Panel } from '@/components/mining-uth2-panel'
import { MiningWLDPanel }  from '@/components/mining-wld-panel'
import { type WalletMode } from '@/lib/tx-signer'
import { cn } from '@/lib/utils'

interface Props {
  userAddress: string
  walletMode?: WalletMode | null
  importedSigner?: any
}

const TABS = [
  { id: 'uth2', label: 'UTH₂ → H2O',    sub: 'Permanente', icon: Pickaxe, color: 'text-orange-400' },
  { id: 'wld',  label: 'WLD → 7 tokens', sub: 'Simultáneo', icon: Star,    color: 'text-yellow-400' },
] as const
type SubTab = typeof TABS[number]['id']

export function MiningComboPanel({ userAddress, walletMode, importedSigner }: Props) {
  const [sub, setSub] = useState<SubTab>('uth2')

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl bg-muted/10 border border-border/30">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all',
                sub === t.id
                  ? 'bg-[oklch(0.65_0.22_255)] text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3 h-3" />
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.id === 'uth2' ? 'UTH₂' : 'WLD'}</span>
              <span className={cn('text-[9px] font-mono hidden sm:inline', sub === t.id ? 'text-white/70' : t.color)}>
                {t.sub}
              </span>
            </button>
          )
        })}
      </div>

      {sub === 'uth2' && (
        <MiningUTH2Panel
          userAddress={userAddress}
          walletMode={(walletMode ?? 'minikit') as WalletMode}
          importedSigner={importedSigner}
        />
      )}
      {sub === 'wld' && (
        <MiningWLDPanel
          userAddress={userAddress}
          walletMode={(walletMode ?? 'minikit') as WalletMode}
          importedSigner={importedSigner}
        />
      )}
    </div>
  )
}
