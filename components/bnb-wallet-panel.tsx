'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { ethers } from 'ethers'
import { Wallet, RefreshCw, Copy, Check, ExternalLink, Loader2 } from 'lucide-react'
import { BNB_TOKENS, BNB_RPC, ERC20_ABI } from '@/lib/sushibnb-abi'
import { useLang } from '@/context/lang-context'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface TokenBalance {
  symbol: string
  name: string
  address: string
  decimals: number
  logoUrl: string
  color: string
  balance: bigint
  loading: boolean
}

interface BNBWalletPanelProps {
  bnbAddress: string | null
}

export function BNBWalletPanel({ bnbAddress }: BNBWalletPanelProps) {
  const { lang } = useLang()
  const [balances, setBalances] = useState<TokenBalance[]>(
    BNB_TOKENS.map(tk => ({ ...tk, balance: 0n, loading: false }))
  )
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = async (addr: string) => {
    setLoading(true)
    setBalances(prev => prev.map(b => ({ ...b, loading: true })))
    try {
      const provider = new ethers.JsonRpcProvider(BNB_RPC)
      const updated = await Promise.all(
        BNB_TOKENS.map(async tk => {
          try {
            let bal: bigint
            if (tk.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
              bal = await provider.getBalance(addr)
            } else {
              const c = new ethers.Contract(tk.address, ERC20_ABI, provider)
              bal = await c.balanceOf(addr)
            }
            return { ...tk, balance: bal, loading: false }
          } catch {
            return { ...tk, balance: 0n, loading: false }
          }
        })
      )
      setBalances(updated)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (bnbAddress) load(bnbAddress)
  }, [bnbAddress]) // eslint-disable-line

  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fmt = (val: bigint, dec: number) => {
    const n = parseFloat(ethers.formatUnits(val, dec))
    if (n === 0) return '0.00'
    if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (n >= 0.01) return n.toFixed(4)
    return n.toFixed(6)
  }

  if (!bnbAddress) {
    return (
      <div className="space-y-4 pb-24">
        <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-6 text-center space-y-3">
          <Wallet className="w-10 h-10 text-[#f0b90b] mx-auto opacity-60" />
          <p className="text-sm font-bold text-foreground">Wallet BNB no conectada</p>
          <p className="text-[10px] text-[oklch(0.50_0.012_230)]">
            Importa una wallet en la sección de redes para ver tus balances en BNB Chain.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="rounded-2xl border border-[#f0b90b]/30 bg-[#f0b90b]/5 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-[#f0b90b]/40 shrink-0">
            <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={40} height={40} className="w-full h-full object-cover" unoptimized />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-[#f0b90b]/80 uppercase tracking-wider">Wallet BNB Chain</p>
            <p className="text-[11px] font-mono text-foreground truncate">{bnbAddress}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => copy(bnbAddress)} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]" />}
            </button>
            <a href={`https://bscscan.com/address/${bnbAddress}`} target="_blank" rel="noopener noreferrer"
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10">
              <ExternalLink className="w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]" />
            </a>
            <button onClick={() => load(bnbAddress)} disabled={loading}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50">
              <RefreshCw className={cn('w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
      </div>

      {/* Token balances */}
      <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[oklch(0.18_0.02_245)]">
          <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Tokens BNB Chain</p>
        </div>
        <div className="divide-y divide-[oklch(0.15_0.02_245)]">
          {balances.map(tk => (
            <div key={tk.address} className="flex items-center gap-3 px-4 py-3">
              <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border-2" style={{ borderColor: `${tk.color}40` }}>
                <Image src={tk.logoUrl} alt={tk.symbol} width={36} height={36} className="w-full h-full object-cover" unoptimized />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground">{tk.symbol}</p>
                <p className="text-[9px] text-[oklch(0.45_0.01_230)]">{tk.name}</p>
              </div>
              <div className="text-right">
                {tk.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[oklch(0.45_0.01_230)]" />
                ) : (
                  <p className="text-sm font-bold font-mono" style={{ color: tk.color }}>
                    {fmt(tk.balance, tk.decimals)}
                  </p>
                )}
                <p className="text-[8px] text-[oklch(0.40_0.01_230)]">{tk.symbol}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* BSCScan link */}
      <div className="flex justify-center">
        <a href={`https://bscscan.com/address/${bnbAddress}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[10px] text-[oklch(0.45_0.01_230)] hover:text-[#f0b90b] transition-colors">
          <ExternalLink className="w-3 h-3" />
          Ver en BSCScan
        </a>
      </div>
    </div>
  )
}
