'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { ChevronDown, RefreshCw, ExternalLink, Loader2 } from 'lucide-react'
import { NETWORKS, NetworkId, getNativeBalance, formatNative } from '@/lib/networks'
import { shortenAddress } from '@/lib/contract'
import { cn } from '@/lib/utils'

interface NetworkSwitcherProps {
  address: string
  activeNetwork: NetworkId
  onSwitch: (n: NetworkId) => void
}

interface NetBalance { loading: boolean; value: bigint | null }

export function NetworkSwitcher({ address, activeNetwork, onSwitch }: NetworkSwitcherProps) {
  const [open, setOpen]       = useState(false)
  const [balances, setBalances] = useState<Record<NetworkId, NetBalance>>({
    wld:     { loading: false, value: null },
    bnb:     { loading: false, value: null },
    polygon: { loading: false, value: null },
  })
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Fetch balances when opened
  useEffect(() => {
    if (!open || !address) return
    const ids: NetworkId[] = ['wld', 'bnb', 'polygon']
    ids.forEach(id => {
      setBalances(b => ({ ...b, [id]: { loading: true, value: null } }))
      getNativeBalance(address, id)
        .then(val => setBalances(b => ({ ...b, [id]: { loading: false, value: val } })))
        .catch(()  => setBalances(b => ({ ...b, [id]: { loading: false, value: null } })))
    })
  }, [open, address])

  const active = NETWORKS[activeNetwork]

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger badge */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-all',
          open
            ? 'border-[oklch(0.65_0.22_255)]/60 bg-[oklch(0.65_0.22_255)]/10'
            : 'border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] hover:border-[oklch(0.30_0.025_245)]',
        )}
      >
        {/* Network logo */}
        <div className="w-4 h-4 rounded-full overflow-hidden shrink-0 border border-white/10">
          <Image
            src={active.logoUrl}
            alt={active.shortName}
            width={16} height={16}
            className="w-full h-full object-cover"
            unoptimized
          />
        </div>
        {/* Live dot */}
        <div className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse shrink-0" />
        {/* Address */}
        <span className="text-[10px] text-foreground font-mono">{shortenAddress(address)}</span>
        <ChevronDown className={cn('w-3 h-3 text-[oklch(0.45_0.01_230)] transition-transform', open && 'rotate-180')} />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute top-full right-0 mt-1.5 w-64 rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.09_0.018_245)] shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-50 overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 border-b border-[oklch(0.18_0.02_245)] bg-[oklch(0.11_0.02_245)]">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider mb-0.5">Wallet conectada</p>
            <p className="text-[11px] font-mono text-foreground break-all">{address}</p>
          </div>

          {/* Networks */}
          <div className="p-2 space-y-1">
            <p className="text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase tracking-wider px-2 pt-1 pb-0.5">
              Redes disponibles
            </p>

            {(Object.keys(NETWORKS) as NetworkId[]).map(id => {
              const net = NETWORKS[id]
              const bal = balances[id]
              const isCurrent = id === activeNetwork
              const isComingSoon = id !== 'wld'

              return (
                <button
                  key={id}
                  onClick={() => { onSwitch(id); setOpen(false) }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all',
                    isCurrent
                      ? 'bg-[oklch(0.65_0.22_255)]/10 border border-[oklch(0.65_0.22_255)]/30'
                      : 'hover:bg-white/5 border border-transparent',
                  )}
                >
                  {/* Logo */}
                  <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border-2" style={{ borderColor: `${net.color}60` }}>
                    <Image
                      src={net.logoUrl}
                      alt={net.name}
                      width={32} height={32}
                      className="w-full h-full object-cover"
                      unoptimized
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-foreground">{net.name}</span>
                      {isComingSoon && (
                        <span className="text-[7px] font-bold px-1 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          PRONTO
                        </span>
                      )}
                      {isCurrent && (
                        <span className="text-[7px] font-bold px-1 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          ACTIVA
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[9px] text-[oklch(0.45_0.01_230)] font-mono">ID {net.chainId}</span>
                      <span className="text-[oklch(0.28_0.02_245)]">·</span>
                      {bal.loading ? (
                        <Loader2 className="w-2.5 h-2.5 text-[oklch(0.45_0.01_230)] animate-spin" />
                      ) : bal.value !== null ? (
                        <span className="text-[9px] font-mono font-bold" style={{ color: net.color }}>
                          {formatNative(bal.value, net.nativeDecimals, 4)} {net.nativeSymbol}
                        </span>
                      ) : (
                        <span className="text-[9px] text-[oklch(0.35_0.01_230)]">···</span>
                      )}
                    </div>
                  </div>

                  {/* Active indicator */}
                  {isCurrent && (
                    <div className="w-2 h-2 rounded-full bg-[#00c076] animate-pulse shrink-0" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-[oklch(0.18_0.02_245)] bg-[oklch(0.08_0.015_245)]">
            <p className="text-[9px] text-[oklch(0.35_0.01_230)] text-center font-mono">
              {active.name} · {active.nativeSymbol} · ACUA 2026
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
