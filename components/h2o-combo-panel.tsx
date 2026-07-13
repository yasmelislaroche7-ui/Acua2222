'use client'

import { useState } from 'react'
import { Droplets } from 'lucide-react'
import { StakePanel }  from '@/components/stake-panel'
import { NewH2OPanel } from '@/components/new-h2o-panel'
import { type WalletMode } from '@/lib/tx-signer'
import { cn } from '@/lib/utils'

interface Props {
  userAddress: string
  walletMode?: WalletMode | null
  importedSigner?: any
}

const TABS = [
  { id: 'h2o',  label: 'H2O',    sub: '12% APY', color: 'text-cyan-400' },
  { id: 'h2o2', label: 'H2O 2.0', sub: 'NUEVO',  color: 'text-blue-400' },
] as const
type SubTab = typeof TABS[number]['id']

export function H2OComboPanel({ userAddress, walletMode, importedSigner }: Props) {
  const [sub, setSub] = useState<SubTab>('h2o')

  return (
    <div className="space-y-3">
      <div className="flex gap-1 p-1 rounded-xl bg-muted/10 border border-border/30">
        {TABS.map(t => (
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
            <Droplets className="w-3 h-3" />
            <span>{t.label}</span>
            <span className={cn('text-[9px] font-mono', sub === t.id ? 'text-white/70' : t.color)}>
              {t.sub}
            </span>
          </button>
        ))}
      </div>

      {sub === 'h2o'  && <StakePanel userAddress={userAddress} />}
      {sub === 'h2o2' && (
        <NewH2OPanel
          userAddress={userAddress}
          walletMode={walletMode}
          importedSigner={importedSigner}
        />
      )}
    </div>
  )
}
