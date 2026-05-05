'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { ethers } from 'ethers'
import {
  ArrowLeftRight, Clock, CheckCircle2, Loader2, Info, ExternalLink,
  Shield, ArrowRight, Wallet, RefreshCw, AlertCircle, Settings,
  TrendingUp, Lock, Unlock, ChevronDown, ChevronUp, Copy, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BNB_RPC } from '@/lib/sushibnb-abi'
import { getProvider, TOKENS } from '@/lib/new-contracts'

// ─── Contract addresses (placeholder hasta deploy) ────────────────────────────
export const BRIDGE_WLD_ADDRESS = '0x0000000000000000000000000000000000000001'
export const BRIDGE_BNB_ADDRESS = '0x0000000000000000000000000000000000000002'
const DEPLOYED = false // cambia a true cuando los contratos estén desplegados

const SUSHI_WLD = TOKENS.SUSHI  // 0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38
const SUSHI_BNB = '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38'

// ─── Config (se sincroniza con el contrato en modo live) ──────────────────────
const DEFAULT_FLAT_FEE   = ethers.parseEther('1000')   // 1 000 SUSHI
const DEFAULT_MIN_AMOUNT = ethers.parseEther('10000')  // 10 000 SUSHI
const DEFAULT_SPLIT_AT   = ethers.parseEther('100000') // 100 000 SUSHI
const DEFAULT_CHUNK      = ethers.parseEther('10000')  // 10 000 SUSHI

// ─── Owners ───────────────────────────────────────────────────────────────────
const OWNER1  = '0x5474c309e985c6b4fc623acf01ade604da781e52'
const OWNER2  = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const BRIDGE_ABI = [
  'function deposit(tuple(tuple(address token, uint256 amount) permitted, address spender, uint256 nonce, uint256 deadline) permit, bytes signature, uint256 amount, address destAddress) returns (uint256)',
  'function fulfill(uint256 id, string bnbTxHash)',
  'function fulfillBatch(uint256[] ids, string bnbTxHash)',
  'function cancel(uint256 id)',
  'function releaseFromFund(address user, uint256 amount)',
  'function releaseFromUsers(address user, uint256 amount, uint256[] wldToBnbIds, string bnbTxHash)',
  'function releaseBatch(address[] users, uint256[] amounts)',
  'function fund(tuple(tuple(address token, uint256 amount) permitted, address spender, uint256 nonce, uint256 deadline) permit, bytes signature, uint256 amount)',
  'function withdraw(uint256 amount, address to)',
  'function withdrawAll(address to)',
  'function withdrawFees(address to)',
  'function setFlatFee(uint256 _fee)',
  'function setMinAmount(uint256 _min)',
  'function setSplitThreshold(uint256 _threshold)',
  'function setChunkSize(uint256 _chunk)',
  'function setMembershipFeeBps(uint256 _bps)',
  'function setPaused(bool _paused)',
  'function setOwner2(address _owner2)',
  'function isOwner(address addr) view returns (bool)',
  'function contractBalance() view returns (uint256)',
  'function waitingCount() view returns (uint256)',
  'function getWaitingList() view returns (uint256[])',
  'function getWaitingRequests(uint256 offset, uint256 limit) view returns (tuple(address user, address destAddress, uint256 amount, uint256 fee, uint256 net, uint256 createdAt, bool fulfilled, bool cancelled, uint256 parentId)[], uint256[])',
  'function getRequest(uint256 id) view returns (tuple(address user, address destAddress, uint256 amount, uint256 fee, uint256 net, uint256 createdAt, bool fulfilled, bool cancelled, uint256 parentId))',
  'function getStats() view returns (uint256 _totalRequests, uint256 _waitingCount, uint256 _fundPool, uint256 _userPool, uint256 _feePool, uint256 _totalBridged, uint256 _totalVolume, uint256 _totalFeesCollected, uint256 _flatFee, uint256 _minAmount, bool _paused)',
  'function totalBridged() view returns (uint256)',
  'function paused() view returns (bool)',
]

const BRIDGE_BNB_DEPOSIT_ABI = [
  'function deposit(uint256 amount, address destAddress) returns (uint256)',
  'function getStats() view returns (uint256 _totalRequests, uint256 _waitingCount, uint256 _fundPool, uint256 _userPool, uint256 _feePool, uint256 _totalBridged, uint256 _totalVolume, uint256 _totalFeesCollected, uint256 _flatFee, uint256 _minAmount, bool _paused)',
  'function getWaitingRequests(uint256 offset, uint256 limit) view returns (tuple(address user, address destAddress, uint256 amount, uint256 fee, uint256 net, uint256 createdAt, bool fulfilled, bool cancelled, uint256 parentId)[], uint256[])',
  'function waitingCount() view returns (uint256)',
  'function totalBridged() view returns (uint256)',
  'function contractBalance() view returns (uint256)',
  'function isOwner(address addr) view returns (bool)',
  'function fund(uint256 amount)',
  'function withdraw(uint256 amount, address to)',
  'function withdrawAll(address to)',
  'function withdrawFees(address to)',
  'function fulfill(uint256 id, string wldTxHash)',
  'function fulfillBatch(uint256[] ids, string wldTxHash)',
  'function cancel(uint256 id)',
  'function releaseFromFund(address user, uint256 amount)',
  'function releaseFromUsers(address user, uint256 amount, uint256[] bnbToWldIds, string wldTxHash)',
  'function setFlatFee(uint256 _fee)',
  'function setMinAmount(uint256 _min)',
  'function setPaused(bool _paused)',
  'function setMembershipFeeBps(uint256 _bps)',
  'function paused() view returns (bool)',
]

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]

// ─── Types ────────────────────────────────────────────────────────────────────
interface BridgeRequestRaw {
  user:        string
  destAddress: string
  amount:      bigint
  fee:         bigint
  net:         bigint
  createdAt:   bigint
  fulfilled:   boolean
  cancelled:   boolean
  parentId:    bigint
}
interface BridgeRequest extends BridgeRequestRaw { id: number; chain: 'wld' | 'bnb' }

interface ContractStats {
  totalRequests:      bigint
  waitingCount:       bigint
  fundPool:           bigint
  userPool:           bigint
  feePool:            bigint
  totalBridged:       bigint
  totalVolume:        bigint
  totalFeesCollected: bigint
  flatFee:            bigint
  minAmount:          bigint
  paused:             boolean
}

interface BridgePanelProps {
  wldAddress: string | null
  bnbAddress: string | null
  isOwner?:   boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (v: bigint, d = 2) => parseFloat(ethers.formatEther(v)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtS  = (v: bigint)        => parseFloat(ethers.formatEther(v)).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const fmtTs = (ts: bigint)       => new Date(Number(ts) * 1000).toLocaleString()
const shortAddr = (a: string)    => `${a.slice(0,8)}…${a.slice(-4)}`

function StatusBadge({ r }: { r: BridgeRequest }) {
  if (r.cancelled) return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 border border-red-500/30 text-red-400">Cancelado</span>
  if (r.fulfilled) return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">Completado</span>
  return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400">⏳ Pendiente</span>
}

function TabBtn({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-colors whitespace-nowrap px-1',
        active ? 'bg-[oklch(0.65_0.22_255)] text-white' : 'text-[oklch(0.50_0.012_230)] hover:text-foreground'
      )}
    >
      {label}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">{children}</p>
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3', className)}>
      {children}
    </div>
  )
}

// ─── Pre-deploy banner ────────────────────────────────────────────────────────
function PreDeployBanner() {
  return (
    <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 p-3 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="text-[10px] font-bold text-amber-400">Contratos pendientes de deploy</p>
        <p className="text-[9px] text-[oklch(0.50_0.012_230)] leading-relaxed">
          AcuaBridgeWLD (World Chain 480) y AcuaBridgeBNB (BNB Chain 56) están compilados y listos.
          Las solicitudes se registran en modo demo hasta el deploy. Scripts disponibles en
          <code className="mx-1 text-amber-300">contracts-hh/scripts/</code>
        </p>
      </div>
    </div>
  )
}

// ─── Request card ─────────────────────────────────────────────────────────────
function RequestCard({
  req, isOwner, onFulfill, onCancel,
}: {
  req:       BridgeRequest
  isOwner:   boolean
  onFulfill: (id: number) => void
  onCancel:  (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const splits = Number(req.amount) > Number(DEFAULT_SPLIT_AT)

  return (
    <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono text-[oklch(0.45_0.01_230)]">
          #{req.id} {splits && <span className="text-blue-400">· chunk</span>}
        </span>
        <StatusBadge r={req} />
      </div>

      <div className="flex items-center gap-2 text-[10px]">
        <span className="font-mono text-foreground font-bold">{fmtS(req.amount)} SUSHI</span>
        <ArrowRight className="w-3 h-3 text-[oklch(0.40_0.01_230)]" />
        <span className="text-emerald-400 font-bold font-mono">{fmtS(req.net)} neto</span>
        <span className="ml-auto text-red-400 font-mono text-[9px]">-{fmtS(req.fee)} fee</span>
      </div>

      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[8px] text-[oklch(0.40_0.01_230)] hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {open ? 'Ocultar' : 'Ver detalles'}
      </button>

      {open && (
        <div className="space-y-1 border-t border-[oklch(0.18_0.02_245)] pt-2 text-[9px]">
          <div className="flex justify-between">
            <span className="text-[oklch(0.45_0.01_230)]">Remitente</span>
            <span className="font-mono text-foreground">{shortAddr(req.user)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[oklch(0.45_0.01_230)]">Destino</span>
            <span className="font-mono text-emerald-400">{shortAddr(req.destAddress)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[oklch(0.45_0.01_230)]">Creado</span>
            <span className="text-foreground">{fmtTs(req.createdAt)}</span>
          </div>
          {req.parentId > 0n && (
            <div className="flex justify-between">
              <span className="text-[oklch(0.45_0.01_230)]">Parent ID</span>
              <span className="font-mono text-blue-400">#{Number(req.parentId)}</span>
            </div>
          )}
        </div>
      )}

      {isOwner && !req.fulfilled && !req.cancelled && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onFulfill(req.id)}
            className="flex-1 py-1.5 rounded-lg text-[9px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
          >
            ✓ Marcar completado
          </button>
          <button
            onClick={() => onCancel(req.id)}
            className="flex-1 py-1.5 rounded-lg text-[9px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            ✗ Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════════════════════
export function BNBBridgePanel({ wldAddress, bnbAddress, isOwner: isOwnerProp }: BridgePanelProps) {
  const [tab, setTab]           = useState<'bridge' | 'wld-list' | 'bnb-list' | 'admin'>('bridge')
  const [direction, setDir]     = useState<'wld-to-bnb' | 'bnb-to-wld'>('wld-to-bnb')
  const [amount, setAmount]     = useState('')
  const [destAddr, setDestAddr] = useState('')
  const [loading, setLoading]   = useState(false)
  const [refreshing, setRefresh] = useState(false)
  const [txStatus, setTxStatus] = useState<string | null>(null)

  // Balances
  const [sushiWLDBal, setSushiWLDBal] = useState(0n)
  const [sushiBNBBal, setSushiBNBBal] = useState(0n)

  // Contract stats
  const [wldStats, setWldStats] = useState<ContractStats | null>(null)
  const [bnbStats, setBnbStats] = useState<ContractStats | null>(null)
  const [wldContractBal, setWldContractBal] = useState(0n)
  const [bnbContractBal, setBnbContractBal] = useState(0n)
  const [totalBridgedCombined, setTotalBridgedCombined] = useState(0n)

  // Waiting lists
  const [wldWaiting, setWldWaiting] = useState<BridgeRequest[]>([])
  const [bnbWaiting, setBnbWaiting] = useState<BridgeRequest[]>([])

  // Local demo requests (pre-deploy fallback)
  const [demoRequests, setDemoRequests] = useState<BridgeRequest[]>([])
  const [isOwnerLocal, setIsOwnerLocal] = useState(false)

  // Admin state
  const [adminAction, setAdminAction] = useState<string | null>(null)
  const [adminAmt, setAdminAmt]       = useState('')
  const [adminAddr, setAdminAddr]     = useState('')
  const [adminTxHash, setAdminTxHash] = useState('')
  const [adminSelectedIds, setAdminSelectedIds] = useState<Set<number>>(new Set())
  const [showConfig, setShowConfig]   = useState(false)
  const [cfgFee, setCfgFee]           = useState('1000')
  const [cfgMin, setCfgMin]           = useState('10000')
  const [cfgMemBps, setCfgMemBps]     = useState('1000')
  const [copied, setCopied]           = useState(false)

  const effectiveBnb = bnbAddress ?? wldAddress
  const effectiveWld = wldAddress

  const amtBig  = amount ? (() => { try { return ethers.parseEther(amount.replace(',', '.')) } catch { return 0n } })() : 0n
  const feeBig  = amtBig > 0n ? DEFAULT_FLAT_FEE : 0n
  const netBig  = amtBig > feeBig ? amtBig - feeBig : 0n
  const minOk   = amtBig >= DEFAULT_MIN_AMOUNT
  const isSplit = amtBig > DEFAULT_SPLIT_AT
  const chunks  = isSplit ? Math.ceil(Number(ethers.formatEther(amtBig)) / 10000) : 1

  // Check owner
  useEffect(() => {
    const addr = (wldAddress ?? '').toLowerCase()
    setIsOwnerLocal(addr === OWNER1 || addr === OWNER2 || !!isOwnerProp)
  }, [wldAddress, isOwnerProp])

  // Load demo requests
  useEffect(() => {
    const stored = localStorage.getItem('acua_bridge_requests_v2')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setDemoRequests(parsed.map((r: any) => ({
          ...r,
          amount:    BigInt(r.amount),
          fee:       BigInt(r.fee),
          net:       BigInt(r.net),
          createdAt: BigInt(r.createdAt),
          parentId:  BigInt(r.parentId ?? 0),
        })))
      } catch { /**/ }
    }
  }, [])

  const saveDemoRequests = (reqs: BridgeRequest[]) => {
    setDemoRequests(reqs)
    localStorage.setItem('acua_bridge_requests_v2', JSON.stringify(
      reqs.map(r => ({ ...r, amount: r.amount.toString(), fee: r.fee.toString(), net: r.net.toString(), createdAt: r.createdAt.toString(), parentId: r.parentId.toString() }))
    ))
  }

  // Load data
  const loadData = useCallback(async () => {
    if (refreshing) return
    setRefresh(true)
    try {
      const wldProv = getProvider()
      const bnbProv = new ethers.JsonRpcProvider(BNB_RPC)

      // Balances
      const sushiWLD = new ethers.Contract(SUSHI_WLD, ERC20_ABI, wldProv)
      const sushiBNB = new ethers.Contract(SUSHI_BNB, ERC20_ABI, bnbProv)
      const pms: Promise<bigint>[] = []

      pms.push(effectiveWld ? sushiWLD.balanceOf(effectiveWld).catch(() => 0n) : Promise.resolve(0n))
      pms.push(effectiveBnb ? sushiBNB.balanceOf(effectiveBnb).catch(() => 0n) : Promise.resolve(0n))

      if (DEPLOYED) {
        // Live mode: read from contracts
        const wldBridge = new ethers.Contract(BRIDGE_WLD_ADDRESS, BRIDGE_ABI, wldProv)
        const bnbBridge = new ethers.Contract(BRIDGE_BNB_ADDRESS, BRIDGE_BNB_DEPOSIT_ABI, bnbProv)

        const [wb, bb, wStats, bStats, wBal, bBal] = await Promise.all([
          ...pms,
          wldBridge.getStats().catch(() => null),
          bnbBridge.getStats().catch(() => null),
          isOwnerLocal ? wldBridge.contractBalance().catch(() => 0n) : Promise.resolve(0n),
          isOwnerLocal ? bnbBridge.contractBalance().catch(() => 0n) : Promise.resolve(0n),
        ])
        setSushiWLDBal(wb)
        setSushiBNBBal(bb)
        if (wStats) setWldStats({ totalRequests: wStats[0], waitingCount: wStats[1], fundPool: wStats[2], userPool: wStats[3], feePool: wStats[4], totalBridged: wStats[5], totalVolume: wStats[6], totalFeesCollected: wStats[7], flatFee: wStats[8], minAmount: wStats[9], paused: wStats[10] })
        if (bStats) setBnbStats({ totalRequests: bStats[0], waitingCount: bStats[1], fundPool: bStats[2], userPool: bStats[3], feePool: bStats[4], totalBridged: bStats[5], totalVolume: bStats[6], totalFeesCollected: bStats[7], flatFee: bStats[8], minAmount: bStats[9], paused: bStats[10] })
        setWldContractBal(wBal)
        setBnbContractBal(bBal)
        setTotalBridgedCombined((wStats ? wStats[5] : 0n) + (bStats ? bStats[5] : 0n))

        // Waiting lists
        if (isOwnerLocal) {
          const [wWait, bWait] = await Promise.all([
            wldBridge.getWaitingRequests(0, 50).catch(() => [[], []]),
            bnbBridge.getWaitingRequests(0, 50).catch(() => [[], []]),
          ])
          const mapReqs = (reqs: any[], ids: any[], chain: 'wld' | 'bnb') =>
            reqs.map((r: any, i: number) => ({
              id: Number(ids[i]), chain,
              user: r[0], destAddress: r[1],
              amount: BigInt(r[2]), fee: BigInt(r[3]), net: BigInt(r[4]),
              createdAt: BigInt(r[5]), fulfilled: r[6], cancelled: r[7], parentId: BigInt(r[8]),
            }))
          setWldWaiting(mapReqs(wWait[0], wWait[1], 'wld'))
          setBnbWaiting(mapReqs(bWait[0], bWait[1], 'bnb'))
        }
      } else {
        // Demo mode: just load balances
        const [wb, bb] = await Promise.all(pms)
        setSushiWLDBal(wb)
        setSushiBNBBal(bb)
        const demoTotal = demoRequests.filter(r => r.fulfilled).reduce((a, r) => a + r.net, 0n)
        setTotalBridgedCombined(demoTotal)
      }
    } catch (e) {
      console.error('loadData error', e)
    } finally {
      setRefresh(false)
    }
  }, [effectiveWld, effectiveBnb, isOwnerLocal, demoRequests])

  useEffect(() => { loadData() }, [effectiveWld, effectiveBnb, isOwnerLocal])

  // Submit bridge (demo mode)
  const handleSubmitDemo = () => {
    if (!effectiveWld || amtBig === 0n || !minOk) return
    const dest = destAddr || (direction === 'wld-to-bnb' ? effectiveBnb : effectiveWld) || ''
    if (!dest) { setTxStatus('✗ Necesitas una wallet destino'); return }

    const now   = BigInt(Math.floor(Date.now() / 1000))
    const newId = demoRequests.length

    const makeReq = (chunk: bigint, id: number, parentId: number): BridgeRequest => ({
      id, chain: direction === 'wld-to-bnb' ? 'wld' : 'bnb',
      user: effectiveWld!, destAddress: dest,
      amount: chunk, fee: DEFAULT_FLAT_FEE, net: chunk - DEFAULT_FLAT_FEE,
      createdAt: now, fulfilled: false, cancelled: false, parentId: BigInt(parentId),
    })

    let newReqs: BridgeRequest[] = []
    if (isSplit) {
      let rem = amtBig
      let idx = newId
      let pid = newId
      while (rem >= DEFAULT_MIN_AMOUNT) {
        const chunk = rem > DEFAULT_CHUNK ? DEFAULT_CHUNK : rem
        newReqs.push(makeReq(chunk, idx, idx === newId ? 0 : pid))
        rem -= chunk; idx++
      }
    } else {
      newReqs.push(makeReq(amtBig, newId, 0))
    }

    saveDemoRequests([...demoRequests, ...newReqs])
    const total = fmtS(amtBig)
    const net   = fmtS(amtBig - DEFAULT_FLAT_FEE * BigInt(newReqs.length))
    setTxStatus(`✓ ${newReqs.length > 1 ? `Solicitud dividida en ${newReqs.length} chunks` : 'Solicitud registrada'} · ${total} SUSHI → ${shortAddr(dest)} · Neto ≈ ${net} SUSHI`)
    setAmount('')
    setDestAddr('')
  }

  // Owner demo actions
  const handleDemoFulfill = (id: number) => {
    const hash = prompt('TX Hash del envío en la red destino:')
    if (!hash) return
    saveDemoRequests(demoRequests.map(r => r.id === id ? { ...r, fulfilled: true } : r))
    setTxStatus(`✓ Solicitud #${id} marcada como completada`)
  }

  const handleDemoCancel = (id: number) => {
    if (!confirm(`¿Cancelar solicitud #${id} y devolver SUSHI al usuario?`)) return
    saveDemoRequests(demoRequests.map(r => r.id === id ? { ...r, cancelled: true } : r))
    setTxStatus(`✓ Solicitud #${id} cancelada`)
  }

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const pendingWLD = demoRequests.filter(r => r.chain === 'wld' && !r.fulfilled && !r.cancelled)
  const pendingBNB = demoRequests.filter(r => r.chain === 'bnb' && !r.fulfilled && !r.cancelled)

  const fromBal  = direction === 'wld-to-bnb' ? sushiWLDBal : sushiBNBBal
  const fromNet  = direction === 'wld-to-bnb' ? 'World Chain' : 'BNB Chain'
  const toNet    = direction === 'wld-to-bnb' ? 'BNB Chain'  : 'World Chain'

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-28">

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #0a0a18, #0f1530, #050510)' }}>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[oklch(0.22_0.025_245)] bg-black">
              <Image src="https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg" alt="WLD" width={40} height={40} className="w-full h-full object-cover" unoptimized />
            </div>
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[oklch(0.22_0.025_245)] bg-black">
              <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={40} height={40} className="w-full h-full object-cover" unoptimized />
            </div>
          </div>
          <div className="flex-1">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Bridge Manual</p>
            <h2 className="text-lg font-black text-foreground">🍣 SUSHI Bridge</h2>
            <p className="text-[9px] text-[oklch(0.40_0.01_230)]">World Chain ↔ BNB Chain · Procesado por owner</p>
          </div>
          <button onClick={loadData} disabled={refreshing} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5 text-[oklch(0.50_0.012_230)]', refreshing && 'animate-spin')} />
          </button>
        </div>

        {/* SUSHI balances */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-black/30 border border-white/5 px-3 py-2">
            <p className="text-[8px] text-[oklch(0.40_0.01_230)]">🌐 SUSHI · World Chain</p>
            <p className="text-sm font-bold font-mono text-blue-400">{fmt(sushiWLDBal, 4)}</p>
          </div>
          <div className="rounded-xl bg-black/30 border border-white/5 px-3 py-2">
            <p className="text-[8px] text-[oklch(0.40_0.01_230)]">🟡 SUSHI · BNB Chain</p>
            <p className="text-sm font-bold font-mono text-amber-400">{fmt(sushiBNBBal, 4)}</p>
          </div>
        </div>

        {/* Total bridged — público */}
        <div className="mt-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[9px] font-bold text-emerald-400">Total Bridgeado (global)</span>
          </div>
          <span className="text-sm font-black font-mono text-emerald-400">
            {fmtS(totalBridgedCombined)} SUSHI
          </span>
        </div>

        {/* Wallet BNB */}
        {(effectiveBnb) && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-[#f0b90b]/8 border border-[#f0b90b]/20">
            <Wallet className="w-3 h-3 text-[#f0b90b] shrink-0" />
            <p className="text-[8px] text-[oklch(0.50_0.012_230)]">
              BNB: <span className="text-[#f0b90b] font-bold">{effectiveBnb ? shortAddr(effectiveBnb) : '—'}</span>
              {!bnbAddress && <span className="ml-1 text-[oklch(0.40_0.01_230)]">(usando World Wallet)</span>}
            </p>
          </div>
        )}
      </div>

      {/* ─── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-1">
        <TabBtn id="bridge"   label="🌉 Bridge"     active={tab === 'bridge'}   onClick={() => setTab('bridge')} />
        <TabBtn id="wld-list" label={`📋 WLD (${pendingWLD.length})`} active={tab === 'wld-list'} onClick={() => setTab('wld-list')} />
        <TabBtn id="bnb-list" label={`📋 BNB (${pendingBNB.length})`} active={tab === 'bnb-list'} onClick={() => setTab('bnb-list')} />
        {isOwnerLocal && <TabBtn id="admin" label="⚙️ Admin" active={tab === 'admin'} onClick={() => setTab('admin')} />}
      </div>

      {/* Status message */}
      {txStatus && (
        <div className={cn(
          'px-3 py-2.5 rounded-xl text-[10px] font-medium border leading-relaxed',
          txStatus.startsWith('✓')
            ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-400'
            : 'border-red-500/30 bg-red-500/8 text-red-400'
        )}>
          {txStatus}
          <button onClick={() => setTxStatus(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: BRIDGE
          ═══════════════════════════════════════════════════════════════ */}
      {tab === 'bridge' && (
        <div className="space-y-3">
          {!DEPLOYED && <PreDeployBanner />}

          {/* Direction selector */}
          <Card>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-xl bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-3 text-center">
                <p className="text-[8px] font-bold text-[oklch(0.40_0.01_230)]">DESDE</p>
                <p className="text-[10px] font-black text-foreground mt-0.5">{fromNet}</p>
              </div>
              <button
                onClick={() => setDir(d => d === 'wld-to-bnb' ? 'bnb-to-wld' : 'wld-to-bnb')}
                className="w-10 h-10 rounded-full bg-[oklch(0.65_0.22_255)]/20 border border-[oklch(0.65_0.22_255)]/40 flex items-center justify-center hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors shrink-0"
              >
                <ArrowLeftRight className="w-4 h-4 text-[oklch(0.65_0.22_255)]" />
              </button>
              <div className="flex-1 rounded-xl bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-3 text-center">
                <p className="text-[8px] font-bold text-[oklch(0.40_0.01_230)]">HASTA</p>
                <p className="text-[10px] font-black text-foreground mt-0.5">{toNet}</p>
              </div>
            </div>
          </Card>

          {/* Amount input */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Cantidad SUSHI</p>
              <p className="text-[9px] font-mono text-[oklch(0.45_0.01_230)]">
                Balance: <span className="text-foreground font-bold">{fmt(fromBal, 4)}</span> SUSHI
              </p>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="Mín. 10 000 SUSHI"
                className="w-full bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-3 text-sm font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50 placeholder:text-[oklch(0.30_0.01_230)]"
              />
              <button
                onClick={() => setAmount(ethers.formatEther(fromBal))}
                className="absolute right-12 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[oklch(0.65_0.22_255)] hover:text-blue-300"
              >
                MAX
              </button>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[oklch(0.50_0.012_230)]">SUSHI</div>
            </div>

            {/* Validation */}
            {amtBig > 0n && !minOk && (
              <p className="text-[9px] text-red-400">Mínimo: 10 000 SUSHI por solicitud</p>
            )}
            {isSplit && (
              <div className="rounded-lg bg-blue-500/8 border border-blue-500/25 px-2.5 py-2 flex items-start gap-1.5">
                <Info className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-[9px] text-blue-300">
                  Monto {'>'} 100 000 SUSHI → se dividirá automáticamente en <strong>{chunks} chunks</strong> de 10 000 SUSHI c/u. Comisión: <strong>{chunks} × 1 000 SUSHI</strong>.
                </p>
              </div>
            )}
          </div>

          {/* Destination address */}
          <div className="space-y-1">
            <p className="text-[10px] text-[oklch(0.45_0.01_230)]">
              Wallet destino en {toNet} <span className="text-[oklch(0.35_0.01_230)]">(opcional — usa tu wallet por defecto)</span>
            </p>
            <input
              value={destAddr}
              onChange={e => setDestAddr(e.target.value)}
              placeholder={`0x… en ${toNet}`}
              className="w-full bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2.5 text-[11px] font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50 placeholder:text-[oklch(0.30_0.01_230)]"
            />
          </div>

          {/* Fee breakdown */}
          {amtBig >= DEFAULT_MIN_AMOUNT && (
            <Card className="space-y-1.5">
              <SectionTitle>Desglose de comisión</SectionTitle>
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-[oklch(0.45_0.01_230)]">Monto total</span>
                  <span className="font-mono font-bold text-foreground">{fmtS(amtBig)} SUSHI</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[oklch(0.45_0.01_230)]">Comisión ({chunks > 1 ? `${chunks}×` : ''}1 000 SUSHI flat)</span>
                  <span className="font-mono text-red-400">-{fmtS(DEFAULT_FLAT_FEE * BigInt(chunks))} SUSHI</span>
                </div>
                <div className="flex justify-between border-t border-[oklch(0.18_0.02_245)] pt-1">
                  <span className="font-bold text-foreground">Recibirás en {toNet}</span>
                  <span className="font-mono font-bold text-emerald-400">{fmtS(amtBig - DEFAULT_FLAT_FEE * BigInt(chunks))} SUSHI</span>
                </div>
              </div>
            </Card>
          )}

          {/* Wallet route */}
          <Card>
            <SectionTitle>Ruta de wallets</SectionTitle>
            <div className="mt-2 flex items-center gap-2 text-[9px]">
              <div className="flex-1 min-w-0">
                <p className="text-[oklch(0.40_0.01_230)]">ORIGEN ({fromNet})</p>
                <p className="font-mono text-blue-400 truncate">{effectiveWld ? shortAddr(effectiveWld) : '—'}</p>
              </div>
              <ArrowRight className="w-3 h-3 text-[oklch(0.35_0.01_230)] shrink-0" />
              <div className="flex-1 min-w-0 text-right">
                <p className="text-[oklch(0.40_0.01_230)]">DESTINO ({toNet})</p>
                <p className="font-mono text-emerald-400 truncate">
                  {destAddr || (direction === 'wld-to-bnb' ? effectiveBnb : effectiveWld) ? shortAddr(destAddr || (direction === 'wld-to-bnb' ? effectiveBnb! : effectiveWld!) || '') : '—'}
                </p>
              </div>
            </div>
          </Card>

          <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-blue-500/20 px-3 py-2.5 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-[9px] text-[oklch(0.50_0.012_230)] leading-relaxed">
              Bridge manual — el owner procesa las solicitudes. SUSHI llega a tu wallet en 5-30 min según disponibilidad de fondos.
              Mínimo: <strong className="text-foreground">10 000 SUSHI</strong> · Comisión: <strong className="text-foreground">1 000 SUSHI flat</strong>
            </p>
          </div>

          <button
            onClick={handleSubmitDemo}
            disabled={loading || !effectiveWld || amtBig === 0n || !minOk}
            className="w-full py-3.5 rounded-2xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
            style={{ background: 'linear-gradient(135deg, #1d4ed8, #2563eb)', color: 'white', boxShadow: '0 0 20px rgba(37,99,235,0.3)' }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            SOLICITAR BRIDGE {isSplit && `(${chunks} chunks)`}
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: LISTA WLD (WLD→BNB)
          ═══════════════════════════════════════════════════════════════ */}
      {tab === 'wld-list' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Lista espera · WLD → BNB</SectionTitle>
            <span className="text-[9px] font-bold text-[oklch(0.50_0.012_230)]">
              {DEPLOYED ? (wldStats?.waitingCount.toString() ?? '?') : pendingWLD.length} pendientes
            </span>
          </div>

          {/* Stats summary */}
          {wldStats && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'En espera', val: fmtS(wldStats.userPool), color: 'text-amber-400' },
                { label: 'Fondos owner', val: fmtS(wldStats.fundPool), color: 'text-blue-400' },
                { label: 'Fees acum.', val: fmtS(wldStats.feePool), color: 'text-violet-400' },
              ].map(s => (
                <Card key={s.label} className="text-center py-2">
                  <p className="text-[7px] text-[oklch(0.40_0.01_230)]">{s.label}</p>
                  <p className={cn('text-[10px] font-black font-mono', s.color)}>{s.val}</p>
                </Card>
              ))}
            </div>
          )}

          {/* Requests */}
          {(DEPLOYED ? wldWaiting : demoRequests.filter(r => r.chain === 'wld')).length === 0 ? (
            <Card className="text-center py-8">
              <ArrowLeftRight className="w-8 h-8 mx-auto text-[oklch(0.25_0.01_230)] mb-2" />
              <p className="text-xs text-[oklch(0.40_0.01_230)]">Sin solicitudes WLD→BNB</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {(DEPLOYED ? wldWaiting : demoRequests.filter(r => r.chain === 'wld')).map(req => (
                <RequestCard
                  key={req.id}
                  req={req}
                  isOwner={isOwnerLocal}
                  onFulfill={handleDemoFulfill}
                  onCancel={handleDemoCancel}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: LISTA BNB (BNB→WLD)
          ═══════════════════════════════════════════════════════════════ */}
      {tab === 'bnb-list' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Lista espera · BNB → WLD</SectionTitle>
            <span className="text-[9px] font-bold text-[oklch(0.50_0.012_230)]">
              {DEPLOYED ? (bnbStats?.waitingCount.toString() ?? '?') : pendingBNB.length} pendientes
            </span>
          </div>

          {bnbStats && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'En espera', val: fmtS(bnbStats.userPool), color: 'text-amber-400' },
                { label: 'Fondos owner', val: fmtS(bnbStats.fundPool), color: 'text-blue-400' },
                { label: 'Fees acum.', val: fmtS(bnbStats.feePool), color: 'text-violet-400' },
              ].map(s => (
                <Card key={s.label} className="text-center py-2">
                  <p className="text-[7px] text-[oklch(0.40_0.01_230)]">{s.label}</p>
                  <p className={cn('text-[10px] font-black font-mono', s.color)}>{s.val}</p>
                </Card>
              ))}
            </div>
          )}

          {(DEPLOYED ? bnbWaiting : demoRequests.filter(r => r.chain === 'bnb')).length === 0 ? (
            <Card className="text-center py-8">
              <ArrowLeftRight className="w-8 h-8 mx-auto text-[oklch(0.25_0.01_230)] mb-2" />
              <p className="text-xs text-[oklch(0.40_0.01_230)]">Sin solicitudes BNB→WLD</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {(DEPLOYED ? bnbWaiting : demoRequests.filter(r => r.chain === 'bnb')).map(req => (
                <RequestCard
                  key={req.id}
                  req={req}
                  isOwner={isOwnerLocal}
                  onFulfill={handleDemoFulfill}
                  onCancel={handleDemoCancel}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: ADMIN (solo owners)
          ═══════════════════════════════════════════════════════════════ */}
      {tab === 'admin' && isOwnerLocal && (
        <div className="space-y-4">

          {/* Owner badge */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-violet-500/8 border border-violet-500/25">
            <Shield className="w-4 h-4 text-violet-400" />
            <div>
              <p className="text-[10px] font-bold text-violet-400">Panel Owner · Bridge SUSHI</p>
              <p className="text-[8px] text-[oklch(0.45_0.01_230)]">Solo visible para owners registrados</p>
            </div>
          </div>

          {/* Contract balances (owner only) */}
          <div>
            <SectionTitle>Balance de contratos (owner only)</SectionTitle>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Card>
                <div className="flex items-center gap-1.5 mb-1">
                  <Lock className="w-3 h-3 text-blue-400" />
                  <p className="text-[8px] font-bold text-blue-400">WLD Contract</p>
                </div>
                {DEPLOYED && wldStats ? (
                  <div className="space-y-0.5 text-[9px]">
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Total</span><span className="font-mono text-foreground">{fmtS(wldContractBal)}</span></div>
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Fund</span><span className="font-mono text-blue-400">{fmtS(wldStats.fundPool)}</span></div>
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Usuarios</span><span className="font-mono text-amber-400">{fmtS(wldStats.userPool)}</span></div>
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Fees</span><span className="font-mono text-violet-400">{fmtS(wldStats.feePool)}</span></div>
                  </div>
                ) : (
                  <p className="text-[9px] text-[oklch(0.40_0.01_230)]">{DEPLOYED ? 'Cargando...' : 'Pendiente deploy'}</p>
                )}
              </Card>
              <Card>
                <div className="flex items-center gap-1.5 mb-1">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <p className="text-[8px] font-bold text-amber-400">BNB Contract</p>
                </div>
                {DEPLOYED && bnbStats ? (
                  <div className="space-y-0.5 text-[9px]">
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Total</span><span className="font-mono text-foreground">{fmtS(bnbContractBal)}</span></div>
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Fund</span><span className="font-mono text-blue-400">{fmtS(bnbStats.fundPool)}</span></div>
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Usuarios</span><span className="font-mono text-amber-400">{fmtS(bnbStats.userPool)}</span></div>
                    <div className="flex justify-between"><span className="text-[oklch(0.40_0.01_230)]">Fees</span><span className="font-mono text-violet-400">{fmtS(bnbStats.feePool)}</span></div>
                  </div>
                ) : (
                  <p className="text-[9px] text-[oklch(0.40_0.01_230)]">{DEPLOYED ? 'Cargando...' : 'Pendiente deploy'}</p>
                )}
              </Card>
            </div>
          </div>

          {/* Process buttons */}
          <div>
            <SectionTitle>Procesar solicitudes en espera</SectionTitle>
            <div className="mt-2 space-y-2">

              {/* Process from fund */}
              <Card className="space-y-2">
                <div className="flex items-center gap-2">
                  <Unlock className="w-3.5 h-3.5 text-blue-400" />
                  <p className="text-[10px] font-bold text-blue-400">Procesar con fondos del contrato</p>
                </div>
                <p className="text-[9px] text-[oklch(0.45_0.01_230)]">
                  Usa el saldo pre-fondeado (fundPool) para liberar SUSHI al usuario en la red destino.
                  Llama releaseFromFund() en el contrato de destino.
                </p>
                <div className="space-y-1.5">
                  <input value={adminAddr} onChange={e => setAdminAddr(e.target.value)} placeholder="0x… wallet del usuario destino" className="w-full bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-2 text-[10px] font-mono text-foreground focus:outline-none" />
                  <input value={adminAmt} onChange={e => setAdminAmt(e.target.value)} placeholder="Cantidad SUSHI (ej: 9000)" className="w-full bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-2 text-[10px] font-mono text-foreground focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setTxStatus('📋 Llama releaseFromFund() en AcuaBridgeWLD con los datos del formulario')}
                    className="py-2 rounded-lg text-[9px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/30 transition-colors"
                  >
                    Release en WLD
                  </button>
                  <button
                    onClick={() => setTxStatus('📋 Llama releaseFromFund() en AcuaBridgeBNB con los datos del formulario')}
                    className="py-2 rounded-lg text-[9px] font-bold bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30 transition-colors"
                  >
                    Release en BNB
                  </button>
                </div>
              </Card>

              {/* Process P2P from users */}
              <Card className="space-y-2">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400" />
                  <p className="text-[10px] font-bold text-emerald-400">Procesar P2P (usar fondos de usuarios)</p>
                </div>
                <p className="text-[9px] text-[oklch(0.45_0.01_230)]">
                  Offset entre usuarios de ambas redes. El SUSHI de usuarios WLD→BNB paga a usuarios BNB→WLD y viceversa.
                  Llama releaseFromUsers() en el contrato destino indicando los IDs a compensar.
                </p>
                <div className="grid grid-cols-2 gap-2 text-center text-[9px]">
                  <div className="rounded-lg bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-2">
                    <p className="text-amber-400 font-bold">{pendingWLD.length}</p>
                    <p className="text-[oklch(0.40_0.01_230)]">Pendientes WLD→BNB</p>
                  </div>
                  <div className="rounded-lg bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-2">
                    <p className="text-blue-400 font-bold">{pendingBNB.length}</p>
                    <p className="text-[oklch(0.40_0.01_230)]">Pendientes BNB→WLD</p>
                  </div>
                </div>
                <button
                  onClick={() => setTxStatus('📋 Para P2P: selecciona IDs WLD→BNB y llama releaseFromUsers() en AcuaBridgeBNB. Luego selecciona IDs BNB→WLD y llama releaseFromUsers() en AcuaBridgeWLD.')}
                  className="w-full py-2 rounded-lg text-[9px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                >
                  Ver instrucciones P2P
                </button>
              </Card>
            </div>
          </div>

          {/* Fulfill requests */}
          <div>
            <SectionTitle>Marcar solicitudes como completadas</SectionTitle>
            <Card className="mt-2 space-y-2">
              <p className="text-[9px] text-[oklch(0.45_0.01_230)]">
                Después de enviar SUSHI en la red destino, marca la solicitud como completada.
              </p>
              <input value={adminTxHash} onChange={e => setAdminTxHash(e.target.value)} placeholder="TX Hash del envío (ej: 0x...)" className="w-full bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-2 text-[10px] font-mono text-foreground focus:outline-none" />
              <p className="text-[8px] text-[oklch(0.40_0.01_230)]">Selecciona solicitudes de las listas WLD o BNB y usa "Marcar completado" en cada tarjeta.</p>
            </Card>
          </div>

          {/* Fund / Withdraw */}
          <div>
            <SectionTitle>Fondear / Retirar contratos</SectionTitle>
            <Card className="mt-2 space-y-2">
              <div className="space-y-1.5">
                <input value={adminAmt} onChange={e => setAdminAmt(e.target.value)} placeholder="Cantidad SUSHI" className="w-full bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-2 text-[10px] font-mono text-foreground focus:outline-none" />
                <input value={adminAddr} onChange={e => setAdminAddr(e.target.value)} placeholder="0x… wallet destino (para retiro)" className="w-full bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-2 text-[10px] font-mono text-foreground focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setTxStatus('📋 Fondear WLD: aprueba SUSHI con Permit2 y llama fund() en AcuaBridgeWLD')}
                  className="py-2 rounded-lg text-[9px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/30 transition-colors"
                >
                  Fondear WLD
                </button>
                <button
                  onClick={() => setTxStatus('📋 Fondear BNB: aprueba SUSHI en BNB y llama fund(amount) en AcuaBridgeBNB')}
                  className="py-2 rounded-lg text-[9px] font-bold bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30 transition-colors"
                >
                  Fondear BNB
                </button>
                <button
                  onClick={() => setTxStatus('📋 Retirar WLD: llama withdraw(amount, to) en AcuaBridgeWLD')}
                  className="py-2 rounded-lg text-[9px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Retirar WLD
                </button>
                <button
                  onClick={() => setTxStatus('📋 Retirar BNB: llama withdraw(amount, to) en AcuaBridgeBNB')}
                  className="py-2 rounded-lg text-[9px] font-bold bg-orange-500/20 border border-orange-500/30 text-orange-400 hover:bg-orange-500/30 transition-colors"
                >
                  Retirar BNB
                </button>
              </div>
              <button
                onClick={() => setTxStatus('📋 Retirar fees: llama withdrawFees(to) en cualquier contrato. 10% → owner2 automáticamente')}
                className="w-full py-2 rounded-lg text-[9px] font-bold bg-violet-500/20 border border-violet-500/30 text-violet-400 hover:bg-violet-500/30 transition-colors"
              >
                💰 Retirar Fees (10% auto → owner2)
              </button>
            </Card>
          </div>

          {/* Config */}
          <div>
            <button
              onClick={() => setShowConfig(c => !c)}
              className="flex items-center gap-2 w-full"
            >
              <SectionTitle>Configuración de contratos</SectionTitle>
              {showConfig ? <ChevronUp className="w-3 h-3 text-[oklch(0.40_0.01_230)]" /> : <ChevronDown className="w-3 h-3 text-[oklch(0.40_0.01_230)]" />}
            </button>

            {showConfig && (
              <Card className="mt-2 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[9px] text-[oklch(0.45_0.01_230)]">Comisión flat (SUSHI por request)</label>
                  <div className="flex gap-2">
                    <input value={cfgFee} onChange={e => setCfgFee(e.target.value)} className="flex-1 bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-foreground focus:outline-none" />
                    <button onClick={() => setTxStatus(`📋 Llama setFlatFee(${ethers.parseEther(cfgFee || '0')}) en ambos contratos`)} className="px-3 py-1.5 rounded-lg text-[9px] font-bold bg-[oklch(0.65_0.22_255)]/20 border border-[oklch(0.65_0.22_255)]/30 text-[oklch(0.65_0.22_255)] hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors">Aplicar</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] text-[oklch(0.45_0.01_230)]">Mínimo bridge (SUSHI)</label>
                  <div className="flex gap-2">
                    <input value={cfgMin} onChange={e => setCfgMin(e.target.value)} className="flex-1 bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-foreground focus:outline-none" />
                    <button onClick={() => setTxStatus(`📋 Llama setMinAmount(${ethers.parseEther(cfgMin || '0')}) en ambos contratos`)} className="px-3 py-1.5 rounded-lg text-[9px] font-bold bg-[oklch(0.65_0.22_255)]/20 border border-[oklch(0.65_0.22_255)]/30 text-[oklch(0.65_0.22_255)] hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors">Aplicar</button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] text-[oklch(0.45_0.01_230)]">% fees → owner2 (bps, 1000 = 10%)</label>
                  <div className="flex gap-2">
                    <input value={cfgMemBps} onChange={e => setCfgMemBps(e.target.value)} className="flex-1 bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-foreground focus:outline-none" />
                    <button onClick={() => setTxStatus(`📋 Llama setMembershipFeeBps(${cfgMemBps}) en ambos contratos`)} className="px-3 py-1.5 rounded-lg text-[9px] font-bold bg-[oklch(0.65_0.22_255)]/20 border border-[oklch(0.65_0.22_255)]/30 text-[oklch(0.65_0.22_255)] hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors">Aplicar</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setTxStatus('📋 Llama setPaused(true) en ambos contratos para pausar el bridge')} className="py-2 rounded-lg text-[9px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors">⏸ Pausar Bridge</button>
                  <button onClick={() => setTxStatus('📋 Llama setPaused(false) en ambos contratos para reanudar el bridge')} className="py-2 rounded-lg text-[9px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors">▶ Reanudar Bridge</button>
                </div>
              </Card>
            )}
          </div>

          {/* Contract addresses */}
          <div>
            <SectionTitle>Direcciones de contratos</SectionTitle>
            <Card className="mt-2 space-y-2">
              {[
                { label: 'AcuaBridgeWLD (World Chain 480)', addr: BRIDGE_WLD_ADDRESS, scan: 'https://worldscan.org/address/' },
                { label: 'AcuaBridgeBNB (BNB Chain 56)', addr: BRIDGE_BNB_ADDRESS, scan: 'https://bscscan.com/address/' },
              ].map(c => (
                <div key={c.label} className="space-y-0.5">
                  <p className="text-[8px] text-[oklch(0.40_0.01_230)]">{c.label}</p>
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-[9px] font-mono text-foreground truncate">
                      {c.addr === '0x0000000000000000000000000000000000000001' || c.addr === '0x0000000000000000000000000000000000000002'
                        ? <span className="text-amber-400">Pendiente deploy</span>
                        : c.addr
                      }
                    </p>
                    {c.addr.length > 10 && (
                      <>
                        <button onClick={() => copyAddr(c.addr)} className="text-[oklch(0.40_0.01_230)] hover:text-foreground transition-colors">
                          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <a href={`${c.scan}${c.addr}`} target="_blank" rel="noopener noreferrer" className="text-[oklch(0.40_0.01_230)] hover:text-blue-400 transition-colors">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          </div>

          {/* Deploy cost estimate */}
          <div>
            <SectionTitle>Estimado de costos — Deploy BNB Chain</SectionTitle>
            <Card className="mt-2 space-y-2.5">
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                {[
                  { label: 'Gas deploy',    val: '~1 950 000',  sub: 'gas total' },
                  { label: 'Precio gas',    val: '3–5 gwei',    sub: 'BNB Chain' },
                  { label: 'Costo @ 3gwei', val: '0.006 BNB',   sub: '≈ $3.50' },
                  { label: 'Costo @ 5gwei', val: '0.010 BNB',   sub: '≈ $6.00' },
                ].map(s => (
                  <div key={s.label} className="rounded-lg bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-2 text-center">
                    <p className="text-[oklch(0.40_0.01_230)]">{s.label}</p>
                    <p className="font-bold text-foreground">{s.val}</p>
                    <p className="text-[7px] text-[oklch(0.35_0.01_230)]">{s.sub}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 p-2.5">
                <p className="text-[9px] font-bold text-emerald-400 mb-0.5">Recomendación</p>
                <p className="text-[9px] text-[oklch(0.50_0.012_230)] leading-relaxed">
                  Tener <strong className="text-foreground">0.05 BNB</strong> en la wallet del deployer antes de empezar.
                  Cubre deploy + config inicial + transacciones de prueba (approve, fund, etc.).<br />
                  A precio actual (~$600/BNB) = <strong className="text-foreground">~$30 USD</strong>.
                </p>
              </div>
              <div className="space-y-0.5 text-[9px]">
                <p className="font-bold text-[oklch(0.45_0.01_230)]">Scripts disponibles:</p>
                <p className="font-mono text-blue-400">contracts-hh/scripts/deploy-bridge-bnb.js</p>
                <p className="font-mono text-blue-400">contracts-hh/scripts/deploy-bridge-wld.js</p>
                <p className="text-[oklch(0.40_0.01_230)]">Ejecutar con: PRIVATE_KEY=0x... npx hardhat run scripts/deploy-bridge-bnb.js --network bnbchain</p>
              </div>
            </Card>
          </div>

          {/* Global stats */}
          <div>
            <SectionTitle>Estadísticas globales bridge</SectionTitle>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center text-[9px]">
              {[
                { label: 'Total bridgeado', val: fmtS(totalBridgedCombined) + ' SUSHI', color: 'text-emerald-400' },
                { label: 'Solicitudes WLD', val: (DEPLOYED ? wldStats?.totalRequests.toString() : demoRequests.filter(r => r.chain === 'wld').length) ?? '?', color: 'text-blue-400' },
                { label: 'Solicitudes BNB', val: (DEPLOYED ? bnbStats?.totalRequests.toString() : demoRequests.filter(r => r.chain === 'bnb').length) ?? '?', color: 'text-amber-400' },
                { label: 'Completadas', val: demoRequests.filter(r => r.fulfilled).length, color: 'text-emerald-400' },
              ].map(s => (
                <Card key={s.label} className="py-2">
                  <p className="text-[oklch(0.40_0.01_230)]">{s.label}</p>
                  <p className={cn('font-black font-mono', s.color)}>{s.val}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
