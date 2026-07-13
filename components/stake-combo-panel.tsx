'use client'

import { useState } from 'react'
import { Layers, Wind } from 'lucide-react'
import { MultiStakingPanel } from '@/components/multi-staking-panel'
import { StakeV2Panel }      from '@/components/stake-v2-panel'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

const TABS = [
  { id: 'plus', label: 'Stake+',   sub: '8 tokens', icon: Layers, color: 'text-emerald-400' },
  { id: 'v2',   label: 'Stake V2', sub: 'MULTI',    icon: Wind,   color: 'text-violet-400'  },
] as const
type SubTab = typeof TABS[number]['id']

export function StakeComboPanel({ userAddress }: Props) {
  const [sub, setSub] = useState<SubTab>('plus')

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
              <span>{t.label}</span>
              <span className={cn('text-[9px] font-mono', sub === t.id ? 'text-white/70' : t.color)}>
                {t.sub}
              </span>
            </button>
          )
        })}
      </div>

      {sub === 'plus' && <MultiStakingPanel userAddress={userAddress} />}
      {sub === 'v2'   && <StakeV2Panel     userAddress={userAddress} />}
    </div>
  )
}
