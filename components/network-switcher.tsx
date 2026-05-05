'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { ChevronDown, Loader2, Trash2, AlertTriangle, Check, X } from 'lucide-react'
import { NETWORKS, NetworkId, getNativeBalance, formatNative } from '@/lib/networks'
import { shortenAddress } from '@/lib/contract'
import { cn } from '@/lib/utils'
import { WalletManager } from '@/components/wallet-manager'

interface NetworkSwitcherProps {
  address: string
  activeNetwork: NetworkId
  onSwitch: (n: NetworkId) => void
  bnbAddress: string | null
  onBnbAddressChange?: (addr: string | null) => void
  onBnbKeyChange?: (key: string | null) => void
}

interface NetBalance { loading: boolean; value: bigint | null }

export function NetworkSwitcher({
  address, activeNetwork, onSwitch, bnbAddress, onBnbAddressChange, onBnbKeyChange,
}: NetworkSwitcherProps) {
  const [open, setOpen]             = useState(false)
  const [balances, setBalances]     = useState<Record<NetworkId, NetBalance>>({
    wld: { loading: false, value: null },
    bnb: { loading: false, value: null },
    polygon: { loading: false, value: null },
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteToast, setDeleteToast]     = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirmDelete(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open || !address) return
    const ids: NetworkId[] = ['wld', 'bnb', 'polygon']
    ids.forEach(id => {
      setBalances(b => ({ ...b, [id]: { loading: true, value: null } }))
      getNativeBalance(address, id)
        .then(val => setBalances(b => ({ ...b, [id]: { loading: false, value: val } })))
        .catch(() => setBalances(b => ({ ...b, [id]: { loading: false, value: null } })))
    })
  }, [open, address])

  const showToast = (msg: string) => {
    setDeleteToast(msg)
    setTimeout(() => setDeleteToast(null), 2800)
  }

  const handleDeleteImported = () => {
    onBnbAddressChange?.(null)
    onBnbKeyChange?.(null)
    setConfirmDelete(false)
    setOpen(false)
    showToast('✓ Wallet importada eliminada')
  }

  const handleUseWorldWallet = () => {
    onBnbAddressChange?.(null)
    setOpen(false)
    showToast('✓ Usando World Wallet en BNB')
  }

  const active = NETWORKS[activeNetwork]

  // Effective BNB address: imported wallet or World Wallet (same EVM address)
  const effectiveBnbAddr = bnbAddress ?? address

  return (
    <>
      {/* Delete toast */}
      {deleteToast && (
        <div
          className="fixed z-[200] bottom-20 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-[11px] font-bold text-white shadow-xl"
          style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 4px 24px rgba(16,185,129,0.5)' }}
        >
          {deleteToast}
        </div>
      )}

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
          <div className="w-4 h-4 rounded-full overflow-hidden shrink-0 border border-white/10">
            <Image src={active.logoUrl} alt={active.shortName} width={16} height={16} className="w-full h-full object-cover" unoptimized />
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-[#00c076] animate-pulse shrink-0" />
          <span className="text-[10px] text-foreground font-mono">{shortenAddress(address)}</span>
          <ChevronDown className={cn('w-3 h-3 text-[oklch(0.45_0.01_230)] transition-transform', open && 'rotate-180')} />
        </button>

        {/* Panel */}
        {open && (
          <div className="absolute top-full right-0 mt-1.5 w-76 rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.09_0.018_245)] shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-50 overflow-hidden max-h-[88dvh] overflow-y-auto" style={{ width: 300 }}>

            {/* ── World Wallet (always connected) ── */}
            <div className="px-4 py-3 border-b border-[oklch(0.18_0.02_245)] bg-[oklch(0.11_0.02_245)]">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-[#00c076] animate-pulse shrink-0" />
                <p className="text-[9px] font-bold text-[#00c076] uppercase tracking-wider">World Wallet · Conectada</p>
              </div>
              <p className="text-[10px] font-mono text-foreground break-all">{address}</p>
              <p className="text-[8px] text-[oklch(0.40_0.01_230)] mt-0.5">Válida en World Chain y BNB Chain (misma dirección EVM)</p>
            </div>

            {/* ── Networks ── */}
            <div className="p-2 space-y-1">
              <p className="text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase tracking-wider px-2 pt-1 pb-0.5">
                Redes disponibles
              </p>
              {(Object.keys(NETWORKS) as NetworkId[]).map(id => {
                const net         = NETWORKS[id]
                const bal         = balances[id]
                const isCurrent   = id === activeNetwork
                const isComingSoon = id === 'polygon'

                return (
                  <button
                    key={id}
                    onClick={() => { onSwitch(id); setOpen(false); setConfirmDelete(false) }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all',
                      isCurrent
                        ? 'bg-[oklch(0.65_0.22_255)]/10 border border-[oklch(0.65_0.22_255)]/30'
                        : 'hover:bg-white/5 border border-transparent',
                    )}
                  >
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border-2" style={{ borderColor: `${net.color}60` }}>
                      <Image src={net.logoUrl} alt={net.name} width={32} height={32} className="w-full h-full object-cover" unoptimized />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-foreground">{net.name}</span>
                        {isComingSoon && (
                          <span className="text-[7px] font-bold px-1 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">PRONTO</span>
                        )}
                        {!isComingSoon && id === 'bnb' && (
                          <span className="text-[7px] font-bold px-1 py-0.5 rounded-full bg-[#f0b90b]/20 text-[#f0b90b] border border-[#f0b90b]/30">LIVE</span>
                        )}
                        {isCurrent && (
                          <span className="text-[7px] font-bold px-1 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">ACTIVA</span>
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
                    {isCurrent && <div className="w-2 h-2 rounded-full bg-[#00c076] animate-pulse shrink-0" />}
                  </button>
                )
              })}
            </div>

            {/* ── BNB Wallet Management ── */}
            <div className="px-3 pb-3 border-t border-[oklch(0.18_0.02_245)] pt-3">
              <p className="text-[9px] font-bold text-[oklch(0.40_0.01_230)] uppercase tracking-wider px-1 mb-2">
                Wallet activa en BNB
              </p>

              {/* World Wallet option */}
              <div
                className={cn(
                  'rounded-xl border px-3 py-2.5 mb-2 flex items-center gap-2',
                  !bnbAddress
                    ? 'border-[#f0b90b]/40 bg-[#f0b90b]/8'
                    : 'border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)]',
                )}
              >
                <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-[#f0b90b]/30">
                  <Image
                    src="https://worldcoin.org/icons/logo-small.svg"
                    alt="WLD"
                    width={28} height={28}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-foreground">World Wallet</p>
                  <p className="text-[8px] font-mono text-[oklch(0.45_0.01_230)] truncate">{address.slice(0,10)}…{address.slice(-4)}</p>
                </div>
                {!bnbAddress ? (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#f0b90b]/20 text-[#f0b90b] border border-[#f0b90b]/30">EN USO</span>
                ) : (
                  <button
                    onClick={handleUseWorldWallet}
                    className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[oklch(0.65_0.22_255)]/20 text-[oklch(0.65_0.22_255)] border border-[oklch(0.65_0.22_255)]/30 hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors"
                  >
                    Usar esta
                  </button>
                )}
              </div>

              {/* Imported wallet (if any) */}
              {bnbAddress && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 border border-emerald-500/30 bg-[oklch(0.12_0.02_245)] flex items-center justify-center">
                      <span className="text-sm">🔑</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-emerald-400">Wallet importada</p>
                      <p className="text-[8px] font-mono text-[oklch(0.45_0.01_230)] truncate">{bnbAddress.slice(0,10)}…{bnbAddress.slice(-4)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">EN USO</span>
                      {!confirmDelete ? (
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="flex items-center gap-0.5 text-[7px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          <Trash2 className="w-2.5 h-2.5" /> Eliminar
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Inline delete confirmation */}
                  {confirmDelete && (
                    <div className="mt-2.5 rounded-xl border border-red-500/30 bg-red-500/8 p-2.5 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                        <p className="text-[9px] font-bold text-red-400">¿Eliminar wallet importada?</p>
                      </div>
                      <p className="text-[8px] text-[oklch(0.50_0.012_230)]">
                        Se eliminará de la sesión. Para operar en BNB se usará tu World Wallet. Tu clave privada no se almacena en ACUA.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleDeleteImported}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-[9px] font-bold text-red-400 hover:bg-red-500/30 transition-colors"
                        >
                          <Check className="w-2.5 h-2.5" /> Confirmar
                        </button>
                        <button
                          onClick={() => setConfirmDelete(false)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-[oklch(0.12_0.02_245)] border border-[oklch(0.22_0.025_245)] text-[9px] font-bold text-[oklch(0.50_0.012_230)] hover:bg-white/5 transition-colors"
                        >
                          <X className="w-2.5 h-2.5" /> Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Import / manage wallet */}
              <WalletManager
                onImport={(addr, key) => {
                  onBnbAddressChange?.(addr)
                  onBnbKeyChange?.(key)
                  setOpen(false)
                  onSwitch('bnb')
                  showToast(`✓ Wallet importada: ${addr.slice(0,8)}…${addr.slice(-4)}`)
                }}
              />
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-[oklch(0.18_0.02_245)] bg-[oklch(0.08_0.015_245)]">
              <p className="text-[9px] text-[oklch(0.35_0.01_230)] text-center font-mono">
                {active.name} · {active.nativeSymbol} · ACUA 2026
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
