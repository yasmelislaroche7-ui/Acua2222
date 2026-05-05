'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { ethers } from 'ethers'
import {
  ArrowLeftRight, Clock, CheckCircle2, Loader2,
  Info, ExternalLink, Shield, ArrowRight, Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLang } from '@/context/lang-context'
import { t } from '@/lib/i18n'
import { BNB_RPC } from '@/lib/sushibnb-abi'
import { getProvider, TOKENS } from '@/lib/new-contracts'

// Bridge contract addresses (PLACEHOLDER — deploy needed)
export const BRIDGE_WLD_ADDRESS = '0x0000000000000000000000000000000000000001'
export const BRIDGE_BNB_ADDRESS = '0x0000000000000000000000000000000000000002'

const SUSHI_WLD = TOKENS.SUSHI  // 0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38
const SUSHI_BNB = '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38'
const FEE_BPS   = 200 // 2%

const ERC20_BAL_ABI = ['function balanceOf(address) view returns (uint256)']

interface BridgeRequest {
  id: string
  from: 'wld' | 'bnb'
  to: 'wld' | 'bnb'
  amount: string   // bigint as string
  fee: string
  net: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  requestedAt: number
  srcAddress: string
  destAddress: string
  txHash?: string
}

interface BridgePanelProps {
  wldAddress: string | null
  bnbAddress: string | null   // null = use World Wallet (same addr as wldAddress)
  isOwner?: boolean
}

function FeeInfo({ amount, fee, net }: { amount: string; fee: string; net: string }) {
  return (
    <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-3 space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[oklch(0.45_0.01_230)]">Monto</span>
        <span className="font-mono text-foreground">{amount} SUSHI</span>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[oklch(0.45_0.01_230)]">Comisión (2%)</span>
        <span className="font-mono text-red-400">-{fee} SUSHI</span>
      </div>
      <div className="border-t border-[oklch(0.18_0.02_245)] pt-1.5 flex items-center justify-between text-[11px]">
        <span className="font-bold text-foreground">Recibirás</span>
        <span className="font-mono font-bold text-emerald-400">{net} SUSHI</span>
      </div>
    </div>
  )
}

export function BNBBridgePanel({ wldAddress, bnbAddress, isOwner }: BridgePanelProps) {
  const { lang } = useLang()
  const [direction, setDirection] = useState<'wld-to-bnb' | 'bnb-to-wld'>('wld-to-bnb')
  const [amount, setAmount]       = useState('')
  const [sushiWLDBal, setSushiWLDBal] = useState(0n)
  const [sushiBNBBal, setSushiBNBBal] = useState(0n)
  const [loading, setLoading]     = useState(false)
  const [txPending, setTxPending] = useState(false)
  const [requests, setRequests]   = useState<BridgeRequest[]>([])
  const [txStatus, setTxStatus]   = useState<string | null>(null)
  const [tab, setTab]             = useState<'bridge' | 'requests' | 'owner'>('bridge')

  // Effective addresses:
  // BNB ops: imported wallet first, fallback to World Wallet (same EVM addr)
  const effectiveBnbAddr = bnbAddress ?? wldAddress
  const effectiveWldAddr = wldAddress

  // Direction helpers
  const fromAddr = direction === 'wld-to-bnb' ? effectiveWldAddr : effectiveBnbAddr
  const toAddr   = direction === 'wld-to-bnb' ? effectiveBnbAddr : effectiveWldAddr
  const fromBal  = direction === 'wld-to-bnb' ? sushiWLDBal : sushiBNBBal
  const fromNet  = direction === 'wld-to-bnb' ? 'World Chain' : 'BNB Chain'
  const toNet    = direction === 'wld-to-bnb' ? 'BNB Chain' : 'World Chain'
  const fromLogo = direction === 'wld-to-bnb'
    ? 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg'
    : 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png'
  const toLogo = direction === 'wld-to-bnb'
    ? 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png'
    : 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg'

  // Load SUSHI balances on both chains
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const wldProv = getProvider()
        const bnbProv = new ethers.JsonRpcProvider(BNB_RPC)
        const pms: Promise<bigint>[] = []

        const wldCheck = effectiveWldAddr
        const bnbCheck = effectiveBnbAddr

        if (wldCheck) {
          pms.push(
            new ethers.Contract(SUSHI_WLD, ERC20_BAL_ABI, wldProv)
              .balanceOf(wldCheck)
              .then((v: bigint) => BigInt(v.toString()))
              .catch(() => 0n)
          )
        } else pms.push(Promise.resolve(0n))

        if (bnbCheck) {
          pms.push(
            new ethers.Contract(SUSHI_BNB, ERC20_BAL_ABI, bnbProv)
              .balanceOf(bnbCheck)
              .then((v: bigint) => BigInt(v.toString()))
              .catch(() => 0n)
          )
        } else pms.push(Promise.resolve(0n))

        const [wb, bb] = await Promise.all(pms)
        setSushiWLDBal(wb)
        setSushiBNBBal(bb)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [effectiveWldAddr, effectiveBnbAddr])

  // Load stored requests
  useEffect(() => {
    const stored = localStorage.getItem('acua_bridge_requests')
    if (stored) {
      try { setRequests(JSON.parse(stored)) } catch { /**/ }
    }
  }, [])

  const saveRequests = (reqs: BridgeRequest[]) => {
    setRequests(reqs)
    localStorage.setItem('acua_bridge_requests', JSON.stringify(reqs))
  }

  const amtBig = amount ? ethers.parseEther(amount.replace(',', '.')) : 0n
  const feeBig = amtBig > 0n ? (amtBig * BigInt(FEE_BPS)) / 10000n : 0n
  const netBig = amtBig > feeBig ? amtBig - feeBig : 0n
  const amtFmt = (v: bigint) => parseFloat(ethers.formatEther(v)).toFixed(6)

  const submitBridge = () => {
    if (!fromAddr || !toAddr || amtBig === 0n) return
    const req: BridgeRequest = {
      id:           `BR-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      from:         direction === 'wld-to-bnb' ? 'wld' : 'bnb',
      to:           direction === 'wld-to-bnb' ? 'bnb' : 'wld',
      amount:       amtBig.toString(),
      fee:          feeBig.toString(),
      net:          netBig.toString(),
      status:       'pending',
      requestedAt:  Date.now(),
      srcAddress:   fromAddr,
      destAddress:  toAddr,
    }
    saveRequests([...requests, req])
    setTxStatus(`✓ Solicitud registrada: ${req.id}. Recibirás ${amtFmt(netBig)} SUSHI en ${toAddr.slice(0,8)}…${toAddr.slice(-4)} (${toNet})`)
    setAmount('')
  }

  const processRequest = (id: string) => {
    saveRequests(requests.map(r => r.id === id ? { ...r, status: 'processing' as const } : r))
  }

  const markDone = (id: string, txHash: string) => {
    saveRequests(requests.map(r => r.id === id ? { ...r, status: 'done' as const, txHash } : r))
  }

  const fmtTime = (ts: number) => new Date(ts).toLocaleString()

  const bnbTag = bnbAddress
    ? `Importada: ${bnbAddress.slice(0,8)}…${bnbAddress.slice(-4)}`
    : `World Wallet: ${(wldAddress ?? '').slice(0,8)}…${(wldAddress ?? '').slice(-4)}`

  return (
    <div className="space-y-4 pb-24">

      {/* Header */}
      <div className="relative rounded-2xl overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e, #0a0a14)' }}>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[oklch(0.22_0.025_245)]">
              <Image src="https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg" alt="WLD" width={40} height={40} className="w-full h-full object-cover" unoptimized />
            </div>
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[oklch(0.22_0.025_245)]">
              <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={40} height={40} className="w-full h-full object-cover" unoptimized />
            </div>
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Bridge SUSHI</p>
            <h2 className="text-lg font-black text-foreground">World Chain ↔ BNB</h2>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold text-amber-400">1:1 Exchange</p>
            <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Comisión 2%</p>
          </div>
        </div>

        {/* Balances */}
        <div className="mt-3 flex gap-2">
          <div className="flex-1 rounded-xl bg-black/30 border border-white/5 px-2 py-1.5 text-center">
            <p className="text-[8px] text-[oklch(0.40_0.01_230)]">SUSHI (WLD)</p>
            <p className="text-xs font-bold font-mono text-blue-400">
              {loading ? '…' : amtFmt(sushiWLDBal)}
            </p>
          </div>
          <div className="flex-1 rounded-xl bg-black/30 border border-white/5 px-2 py-1.5 text-center">
            <p className="text-[8px] text-[oklch(0.40_0.01_230)]">SUSHI (BNB)</p>
            <p className="text-xs font-bold font-mono text-amber-400">
              {loading ? '…' : amtFmt(sushiBNBBal)}
            </p>
          </div>
        </div>

        {/* Active BNB wallet indicator */}
        <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-[#f0b90b]/8 border border-[#f0b90b]/20">
          <Wallet className="w-3 h-3 text-[#f0b90b] shrink-0" />
          <p className="text-[8px] text-[oklch(0.50_0.012_230)]">
            Wallet BNB: <span className="text-[#f0b90b] font-bold">{bnbTag}</span>
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-1">
        {[
          { id: 'bridge',   label: '🌉 Bridge' },
          { id: 'requests', label: '📋 Solicitudes' },
          ...(isOwner ? [{ id: 'owner', label: '⚙️ Admin' }] : []),
        ].map(tb => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id as any)}
            className={cn(
              'flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors',
              tab === tb.id
                ? 'bg-[oklch(0.65_0.22_255)] text-white'
                : 'text-[oklch(0.50_0.012_230)] hover:text-foreground'
            )}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Status */}
      {txStatus && (
        <div className={cn(
          'px-3 py-2.5 rounded-xl text-[10px] font-medium border leading-relaxed',
          txStatus.startsWith('✓')
            ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-400'
            : 'border-red-500/30 bg-red-500/8 text-red-400'
        )}>
          {txStatus}
        </div>
      )}

      {/* ─── BRIDGE TAB ─── */}
      {tab === 'bridge' && (
        <div className="space-y-3">

          {/* Direction selector */}
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-3 text-center">
              <Image src={fromLogo} alt="from" width={28} height={28} className="w-7 h-7 rounded-full mx-auto mb-1 object-cover" unoptimized />
              <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)]">DESDE</p>
              <p className="text-[10px] font-bold text-foreground">{fromNet}</p>
            </div>
            <button
              onClick={() => setDirection(d => d === 'wld-to-bnb' ? 'bnb-to-wld' : 'wld-to-bnb')}
              className="w-10 h-10 rounded-full bg-[oklch(0.65_0.22_255)]/20 border border-[oklch(0.65_0.22_255)]/40 flex items-center justify-center hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors shrink-0"
            >
              <ArrowLeftRight className="w-4 h-4 text-[oklch(0.65_0.22_255)]" />
            </button>
            <div className="flex-1 rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-3 text-center">
              <Image src={toLogo} alt="to" width={28} height={28} className="w-7 h-7 rounded-full mx-auto mb-1 object-cover" unoptimized />
              <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)]">HASTA</p>
              <p className="text-[10px] font-bold text-foreground">{toNet}</p>
            </div>
          </div>

          {/* Amount input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Cantidad SUSHI</p>
              <p className="text-[9px] font-mono text-[oklch(0.45_0.01_230)]">
                Balance: {amtFmt(fromBal)} SUSHI
              </p>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-3 text-sm font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50 placeholder:text-[oklch(0.35_0.01_230)]"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <button
                  onClick={() => setAmount(amtFmt(fromBal))}
                  className="text-[9px] font-bold text-[oklch(0.65_0.22_255)] hover:text-blue-300"
                >
                  MAX
                </button>
                <div className="flex items-center gap-1 rounded-lg bg-[oklch(0.14_0.02_245)] px-2 py-1 border border-[oklch(0.22_0.025_245)]">
                  <span className="text-[10px] font-bold text-foreground">SUSHI</span>
                </div>
              </div>
            </div>
          </div>

          {/* Fee breakdown */}
          {amtBig > 0n && <FeeInfo amount={amtFmt(amtBig)} fee={amtFmt(feeBig)} net={amtFmt(netBig)} />}

          {/* Wallet route display */}
          <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-3 space-y-2">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Ruta de wallets</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[8px] text-[oklch(0.45_0.01_230)]">ORIGEN ({fromNet})</p>
                <p className="text-[9px] font-mono text-blue-400 truncate">
                  {fromAddr ? `${fromAddr.slice(0,10)}…${fromAddr.slice(-4)}` : '—'}
                </p>
              </div>
              <ArrowRight className="w-3 h-3 text-[oklch(0.35_0.01_230)] shrink-0" />
              <div className="flex-1 min-w-0 text-right">
                <p className="text-[8px] text-[oklch(0.45_0.01_230)]">DESTINO ({toNet})</p>
                <p className="text-[9px] font-mono text-emerald-400 truncate">
                  {toAddr ? `${toAddr.slice(0,10)}…${toAddr.slice(-4)}` : '—'}
                </p>
              </div>
            </div>
            {!bnbAddress && (
              <p className="text-[8px] text-[#f0b90b]">
                💡 Usando World Wallet en BNB. Para una wallet BNB diferente, impórtala desde el selector de red.
              </p>
            )}
          </div>

          {/* Info notices */}
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-500/8 border border-blue-500/20">
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-[9px] text-[oklch(0.50_0.012_230)]">
              Mínimo: 0.1 SUSHI. Procesado por el owner. El SUSHI llega a tu wallet conectada en la red destino.
              Contratos AcuaBridgeWLD / AcuaBridgeBNB pendientes de deploy.
            </p>
          </div>

          {/* Submit */}
          <button
            onClick={submitBridge}
            disabled={txPending || !fromAddr || !toAddr || amtBig === 0n || amtBig > fromBal}
            className="w-full py-3.5 rounded-2xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
            style={{ background: 'linear-gradient(135deg, #1d4ed8, #2563eb)', color: 'white', boxShadow: '0 0 20px rgba(37,99,235,0.4)' }}
          >
            {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            SOLICITAR BRIDGE
          </button>
        </div>
      )}

      {/* ─── REQUESTS TAB ─── */}
      {tab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 ? (
            <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-6 text-center">
              <ArrowLeftRight className="w-8 h-8 mx-auto text-[oklch(0.35_0.01_230)] mb-2" />
              <p className="text-xs text-[oklch(0.45_0.01_230)]">No hay solicitudes de bridge</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...requests].reverse().map(req => {
                const sc = req.status === 'done' ? '#22c55e' : req.status === 'pending' ? '#f59e0b' : req.status === 'processing' ? '#3b82f6' : '#ef4444'
                const sl = { pending: '⏳ Pendiente', processing: '⚙️ Procesando', done: '✓ Completado', failed: '✗ Fallido' }[req.status]
                return (
                  <div key={req.id} className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono font-bold text-[oklch(0.45_0.01_230)]">{req.id}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border" style={{ color: sc, borderColor: `${sc}50`, background: `${sc}15` }}>{sl}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-foreground font-bold">{req.from.toUpperCase()}</span>
                      <ArrowRight className="w-3 h-3 text-[oklch(0.45_0.01_230)]" />
                      <span className="text-foreground font-bold">{req.to.toUpperCase()}</span>
                      <span className="ml-auto font-mono text-foreground">{amtFmt(BigInt(req.amount))} SUSHI</span>
                    </div>
                    {req.destAddress && (
                      <p className="text-[8px] text-[oklch(0.40_0.01_230)] font-mono">
                        → {req.destAddress.slice(0,10)}…{req.destAddress.slice(-4)}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[8px] text-[oklch(0.40_0.01_230)]">
                      <span>{fmtTime(req.requestedAt)}</span>
                      {req.txHash && (
                        <a href={`https://bscscan.com/tx/${req.txHash}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-blue-400 hover:text-blue-300">
                          <ExternalLink className="w-2.5 h-2.5" /> TX
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── OWNER/ADMIN TAB — solo visible para owners ─── */}
      {tab === 'owner' && isOwner && (
        <div className="space-y-3">
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-violet-400" />
            <div>
              <p className="text-[10px] font-bold text-violet-400">Panel Owner — Bridge SUSHI</p>
              <p className="text-[8px] text-[oklch(0.45_0.01_230)]">Solo visible para owners registrados</p>
            </div>
          </div>

          {/* Pending requests */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Solicitudes Pendientes</p>
            {requests.filter(r => r.status === 'pending' || r.status === 'processing').length === 0 ? (
              <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-4 text-center">
                <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-400/40 mb-1" />
                <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Sin solicitudes pendientes</p>
              </div>
            ) : requests.filter(r => r.status === 'pending' || r.status === 'processing').map(req => (
              <div key={req.id} className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3 space-y-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono font-bold text-[oklch(0.50_0.012_230)]">{req.id}</span>
                  <span className="font-bold text-amber-400">
                    {req.from.toUpperCase()} → {req.to.toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] space-y-0.5">
                  <p className="text-[oklch(0.45_0.01_230)]">
                    Desde: <span className="font-mono text-foreground">{(req.srcAddress ?? '').slice(0,10)}…{(req.srcAddress ?? '').slice(-4)}</span>
                  </p>
                  <p className="text-[oklch(0.45_0.01_230)]">
                    Destino: <span className="font-mono text-emerald-400">{(req.destAddress ?? '').slice(0,10)}…{(req.destAddress ?? '').slice(-4)}</span>
                  </p>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-foreground font-bold">{amtFmt(BigInt(req.amount))} SUSHI</span>
                  <span className="text-emerald-400 font-bold">→ {amtFmt(BigInt(req.net))} neto</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => processRequest(req.id)}
                    className="flex-1 py-1.5 rounded-lg text-[9px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/30 transition-colors"
                  >
                    ⚙️ En proceso
                  </button>
                  <button
                    onClick={() => {
                      const hash = prompt('TX Hash del envío:')
                      if (hash) markDone(req.id, hash)
                    }}
                    className="flex-1 py-1.5 rounded-lg text-[9px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                  >
                    ✓ Completado
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3 space-y-2">
            <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Estadísticas Bridge</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                { label: 'Total solicitudes', val: requests.length },
                { label: 'Completadas',        val: requests.filter(r => r.status === 'done').length },
                { label: 'Pendientes',         val: requests.filter(r => r.status === 'pending').length },
                { label: 'En proceso',         val: requests.filter(r => r.status === 'processing').length },
              ].map(s => (
                <div key={s.label} className="rounded-lg bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] px-2 py-2">
                  <p className="text-[8px] text-[oklch(0.40_0.01_230)]">{s.label}</p>
                  <p className="text-sm font-black text-foreground">{s.val}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 p-3">
            <p className="text-[10px] font-bold text-amber-400 mb-1">⚠️ Contratos pendientes de deploy</p>
            <p className="text-[9px] text-[oklch(0.50_0.012_230)]">
              AcuaBridgeWLD (World Chain) y AcuaBridgeBNB (BNB) están compilados con multi-owner
              y optimización de gas. Ambos soportan owner + owner2 (0x5474…e52).
              El bridge es manual hasta el deploy.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
