'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { ethers } from 'ethers'
import {
  ArrowLeftRight, Clock, CheckCircle2, Loader2, Info, ExternalLink,
  Shield, ArrowRight, Wallet, RefreshCw, AlertCircle, Settings,
  TrendingUp, Lock, Unlock, ChevronDown, ChevronUp, Copy, Check,
  Zap, XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BNB_RPC } from '@/lib/sushibnb-abi'
import { getProvider, TOKENS } from '@/lib/new-contracts'

// ─── Contract addresses (placeholder hasta deploy) ───────────────────────────
export const BRIDGE_WLD_ADDRESS = '0x0000000000000000000000000000000000000001'
export const BRIDGE_BNB_ADDRESS = '0x0000000000000000000000000000000000000002'
const DEPLOYED = false

const SUSHI_WLD = TOKENS.SUSHI
const SUSHI_BNB = '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38'

const DEFAULT_FLAT_FEE   = ethers.parseEther('1000')
const DEFAULT_MIN_AMOUNT = ethers.parseEther('10000')
const DEFAULT_SPLIT_AT   = ethers.parseEther('100000')
const DEFAULT_CHUNK      = ethers.parseEther('10000')

const OWNER1 = '0x5474c309e985c6b4fc623acf01ade604da781e52'
const OWNER2 = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'

// ─── ABI — v3 (sin txHash, releaseToUser, markFulfilled) ────────────────────
const BRIDGE_ABI = [
  'function deposit(tuple(tuple(address token, uint256 amount) permitted, address spender, uint256 nonce, uint256 deadline) permit, bytes signature, uint256 amount, address destAddress) returns (uint256)',
  'function markFulfilled(uint256 id)',
  'function markFulfilledBatch(uint256[] ids)',
  'function releaseToUser(address dest, uint256 amount)',
  'function releaseToUserBatch(address[] dests, uint256[] amounts)',
  'function processP2P(address dest, uint256 amount, uint256[] wldToBnbIds)',
  'function cancel(uint256 id)',
  'function fund(tuple(tuple(address token, uint256 amount) permitted, address spender, uint256 nonce, uint256 deadline) permit, bytes signature, uint256 amount)',
  'function withdraw(uint256 amount, address to)',
  'function withdrawAll(address to)',
  'function withdrawFees(address to)',
  'function setFlatFee(uint256)',
  'function setMinAmount(uint256)',
  'function setSplitThreshold(uint256)',
  'function setChunkSize(uint256)',
  'function setMembershipFeeBps(uint256)',
  'function setPaused(bool)',
  'function setOwner2(address)',
  'function isOwner(address) view returns (bool)',
  'function contractBalance() view returns (uint256)',
  'function waitingCount() view returns (uint256)',
  'function getWaitingList() view returns (uint256[])',
  'function getWaitingRequests(uint256 offset, uint256 limit) view returns (tuple(address user, address destAddress, uint256 amount, uint256 fee, uint256 net, uint256 createdAt, bool fulfilled, bool cancelled, uint256 parentId)[], uint256[])',
  'function getRequest(uint256 id) view returns (tuple(address user, address destAddress, uint256 amount, uint256 fee, uint256 net, uint256 createdAt, bool fulfilled, bool cancelled, uint256 parentId))',
  'function getStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)',
  'function totalBridged() view returns (uint256)',
  'function paused() view returns (bool)',
]

const BRIDGE_BNB_ABI = [
  'function deposit(uint256 amount, address destAddress) returns (uint256)',
  'function markFulfilled(uint256 id)',
  'function markFulfilledBatch(uint256[] ids)',
  'function releaseToUser(address dest, uint256 amount)',
  'function releaseToUserBatch(address[] dests, uint256[] amounts)',
  'function processP2P(address dest, uint256 amount, uint256[] bnbToWldIds)',
  'function cancel(uint256 id)',
  'function fund(uint256 amount)',
  'function withdraw(uint256 amount, address to)',
  'function withdrawAll(address to)',
  'function withdrawFees(address to)',
  'function setFlatFee(uint256)',
  'function setMinAmount(uint256)',
  'function setPaused(bool)',
  'function setMembershipFeeBps(uint256)',
  'function isOwner(address) view returns (bool)',
  'function contractBalance() view returns (uint256)',
  'function waitingCount() view returns (uint256)',
  'function getWaitingList() view returns (uint256[])',
  'function getWaitingRequests(uint256 offset, uint256 limit) view returns (tuple(address user, address destAddress, uint256 amount, uint256 fee, uint256 net, uint256 createdAt, bool fulfilled, bool cancelled, uint256 parentId)[], uint256[])',
  'function getRequest(uint256 id) view returns (tuple(address user, address destAddress, uint256 amount, uint256 fee, uint256 net, uint256 createdAt, bool fulfilled, bool cancelled, uint256 parentId))',
  'function getStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)',
  'function totalBridged() view returns (uint256)',
  'function paused() view returns (bool)',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
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
  totalRequests: bigint; waitingCount: bigint
  fundPool: bigint; userPool: bigint; feePool: bigint
  totalBridged: bigint; totalVolume: bigint; totalFeesCollected: bigint
  flatFee: bigint; minAmount: bigint; paused: boolean
}

interface BridgePanelProps {
  wldAddress:    string | null
  bnbAddress:    string | null
  bnbPrivateKey?: string | null
  isOwner?:      boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (v: bigint, d = 2) => parseFloat(ethers.formatEther(v)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtS   = (v: bigint)        => parseFloat(ethers.formatEther(v)).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const fmtTs  = (ts: bigint)       => new Date(Number(ts) * 1000).toLocaleString()
const shortAddr = (a: string)     => `${a.slice(0,8)}…${a.slice(-4)}`
const nextId = (() => { let n = Date.now(); return () => n++ })()

function StatusBadge({ r }: { r: BridgeRequest }) {
  if (r.cancelled) return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/15 border border-red-500/30 text-red-400">Cancelado</span>
  if (r.fulfilled) return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">✓ Completado</span>
  return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400">⏳ Pendiente</span>
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-colors whitespace-nowrap px-1', active ? 'bg-[oklch(0.65_0.22_255)] text-white' : 'text-[oklch(0.50_0.012_230)] hover:text-foreground')}>
      {label}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">{children}</p>
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3', className)}>{children}</div>
}

// ─── Pre-deploy banner ───────────────────────────────────────────────────────
function PreDeployBanner() {
  return (
    <div className="rounded-xl bg-amber-500/8 border border-amber-500/25 p-3 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="text-[10px] font-bold text-amber-400">Contratos pendientes de deploy</p>
        <p className="text-[9px] text-[oklch(0.50_0.012_230)] leading-relaxed">
          AcuaBridgeWLD v3 y AcuaBridgeBNB v3 compilados y listos. Solicitudes en modo demo hasta el deploy.
          Scripts: <code className="text-amber-300">contracts-hh/scripts/deploy-bridge-*.js</code>
        </p>
      </div>
    </div>
  )
}

// ─── Request card (con botón Aprobar automático) ──────────────────────────────
function RequestCard({
  req, isOwner, processing, onApprove, onCancel,
}: {
  req: BridgeRequest; isOwner: boolean; processing: boolean
  onApprove: (id: number) => void
  onCancel:  (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const dirLabel = req.chain === 'wld' ? 'WLD → BNB' : 'BNB → WLD'
  const destLabel = req.chain === 'wld' ? 'Destino BNB' : 'Destino WLD'

  return (
    <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
      <div className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[8px] font-mono font-bold text-[oklch(0.65_0.22_255)] bg-[oklch(0.65_0.22_255)]/15 px-1.5 py-0.5 rounded-md">
              #{req.id}
            </span>
            <span className="text-[8px] font-bold text-[oklch(0.45_0.01_230)]">{dirLabel}</span>
          </div>
          <StatusBadge r={req} />
        </div>

        {/* Amounts */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="font-mono text-foreground font-bold">{fmtS(req.amount)} SUSHI</span>
          <ArrowRight className="w-3 h-3 text-[oklch(0.35_0.01_230)] shrink-0" />
          <span className="text-emerald-400 font-bold font-mono">{fmtS(req.net)} neto</span>
          <span className="ml-auto text-red-400/70 font-mono text-[8px]">−{fmtS(req.fee)} fee</span>
        </div>

        {/* Dest address — visible siempre */}
        <div className="rounded-lg bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] px-2 py-1.5">
          <p className="text-[8px] text-[oklch(0.40_0.01_230)] mb-0.5">{destLabel}</p>
          <p className="text-[9px] font-mono text-emerald-300 break-all">{req.destAddress}</p>
        </div>

        {/* Toggle details */}
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-[8px] text-[oklch(0.40_0.01_230)] hover:text-foreground transition-colors">
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {open ? 'Ocultar detalles' : 'Ver más'}
        </button>

        {open && (
          <div className="space-y-1 border-t border-[oklch(0.18_0.02_245)] pt-2 text-[9px]">
            <div className="flex justify-between"><span className="text-[oklch(0.45_0.01_230)]">Remitente</span><span className="font-mono">{shortAddr(req.user)}</span></div>
            <div className="flex justify-between"><span className="text-[oklch(0.45_0.01_230)]">Creado</span><span>{fmtTs(req.createdAt)}</span></div>
            {req.parentId > BigInt(0) && <div className="flex justify-between"><span className="text-[oklch(0.45_0.01_230)]">Chunk de</span><span className="font-mono text-blue-400">#{Number(req.parentId)}</span></div>}
          </div>
        )}
      </div>

      {/* Owner actions */}
      {isOwner && !req.fulfilled && !req.cancelled && (
        <div className="border-t border-[oklch(0.18_0.02_245)] p-2 flex gap-2">
          <button
            onClick={() => onApprove(req.id)}
            disabled={processing}
            className="flex-1 py-2 rounded-lg text-[9px] font-black flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: 'white' }}
          >
            {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            APROBAR (auto)
          </button>
          <button
            onClick={() => onCancel(req.id)}
            disabled={processing}
            className="py-2 px-3 rounded-lg text-[9px] font-bold bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════════════════════
export function BNBBridgePanel({ wldAddress, bnbAddress, bnbPrivateKey, isOwner: isOwnerProp }: BridgePanelProps) {
  const [tab, setTab]           = useState<'bridge' | 'wld-list' | 'bnb-list' | 'admin'>('bridge')
  const [direction, setDir]     = useState<'wld-to-bnb' | 'bnb-to-wld'>('wld-to-bnb')
  const [amount, setAmount]     = useState('')
  const [destAddr, setDestAddr] = useState('')
  const [loading, setLoading]   = useState(false)
  const [refreshing, setRefresh] = useState(false)
  const [txStatus, setTxStatus] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<number | null>(null)

  // Balances
  const [sushiWLDBal, setSushiWLDBal] = useState(BigInt(0))
  const [sushiBNBBal, setSushiBNBBal] = useState(BigInt(0))

  // Contract stats
  const [wldStats, setWldStats]           = useState<ContractStats | null>(null)
  const [bnbStats, setBnbStats]           = useState<ContractStats | null>(null)
  const [wldContractBal, setWldContractBal] = useState(BigInt(0))
  const [bnbContractBal, setBnbContractBal] = useState(BigInt(0))
  const [totalBridgedCombined, setTotalBridgedCombined] = useState(BigInt(0))

  // Waiting lists (live mode)
  const [wldWaiting, setWldWaiting] = useState<BridgeRequest[]>([])
  const [bnbWaiting, setBnbWaiting] = useState<BridgeRequest[]>([])

  // Demo requests (pre-deploy)
  const [demoRequests, setDemoRequests] = useState<BridgeRequest[]>([])
  const [isOwnerLocal, setIsOwnerLocal] = useState(false)

  // Admin state
  const [adminAmt, setAdminAmt]     = useState('')
  const [adminAddr, setAdminAddr]   = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [cfgFee, setCfgFee]         = useState('1000')
  const [cfgMin, setCfgMin]         = useState('10000')
  const [cfgMemBps, setCfgMemBps]   = useState('1000')
  const [copied, setCopied]         = useState(false)

  const effectiveBnb = bnbAddress ?? wldAddress
  const effectiveWld = wldAddress

  const amtBig  = amount ? (() => { try { return ethers.parseEther(amount.replace(',', '.')) } catch { return BigInt(0) } })() : BigInt(0)
  const feeBig  = amtBig > BigInt(0) ? DEFAULT_FLAT_FEE : BigInt(0)
  const netBig  = amtBig > feeBig ? amtBig - feeBig : BigInt(0)
  const minOk   = amtBig >= DEFAULT_MIN_AMOUNT
  const isSplit = amtBig > DEFAULT_SPLIT_AT
  const chunks  = isSplit ? Math.ceil(Number(ethers.formatEther(amtBig)) / 10000) : 1

  useEffect(() => {
    const addr = (wldAddress ?? '').toLowerCase()
    setIsOwnerLocal(addr === OWNER1 || addr === OWNER2 || !!isOwnerProp)
  }, [wldAddress, isOwnerProp])

  // Load demo requests
  useEffect(() => {
    const stored = localStorage.getItem('acua_bridge_requests_v3')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setDemoRequests(parsed.map((r: any) => ({
          ...r,
          amount: BigInt(r.amount), fee: BigInt(r.fee), net: BigInt(r.net),
          createdAt: BigInt(r.createdAt), parentId: BigInt(r.parentId ?? 0),
        })))
      } catch { /**/ }
    }
  }, [])

  const saveDemoRequests = (reqs: BridgeRequest[]) => {
    setDemoRequests(reqs)
    localStorage.setItem('acua_bridge_requests_v3', JSON.stringify(
      reqs.map(r => ({ ...r, amount: r.amount.toString(), fee: r.fee.toString(), net: r.net.toString(), createdAt: r.createdAt.toString(), parentId: r.parentId.toString() }))
    ))
  }

  // Load chain data
  const loadData = useCallback(async () => {
    if (refreshing) return
    setRefresh(true)
    try {
      const wldProv = getProvider()
      const bnbProv = new ethers.JsonRpcProvider(BNB_RPC)
      const sushiWLD = new ethers.Contract(SUSHI_WLD, ERC20_ABI, wldProv)
      const sushiBNB = new ethers.Contract(SUSHI_BNB, ERC20_ABI, bnbProv)

      const [wb, bb] = await Promise.all([
        effectiveWld ? sushiWLD.balanceOf(effectiveWld).catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
        effectiveBnb ? sushiBNB.balanceOf(effectiveBnb).catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
      ])
      setSushiWLDBal(wb)
      setSushiBNBBal(bb)

      if (DEPLOYED) {
        const wldBridge = new ethers.Contract(BRIDGE_WLD_ADDRESS, BRIDGE_ABI, wldProv)
        const bnbBridge = new ethers.Contract(BRIDGE_BNB_ADDRESS, BRIDGE_BNB_ABI, bnbProv)
        const [wStats, bStats, wBal, bBal] = await Promise.all([
          wldBridge.getStats().catch(() => null),
          bnbBridge.getStats().catch(() => null),
          isOwnerLocal ? wldBridge.contractBalance().catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
          isOwnerLocal ? bnbBridge.contractBalance().catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
        ])
        const mapStats = (s: any): ContractStats => ({
          totalRequests: s[0], waitingCount: s[1], fundPool: s[2], userPool: s[3],
          feePool: s[4], totalBridged: s[5], totalVolume: s[6], totalFeesCollected: s[7],
          flatFee: s[8], minAmount: s[9], paused: s[10],
        })
        if (wStats) setWldStats(mapStats(wStats))
        if (bStats) setBnbStats(mapStats(bStats))
        setWldContractBal(wBal)
        setBnbContractBal(bBal)
        setTotalBridgedCombined((wStats?.[5] ?? BigInt(0)) + (bStats?.[5] ?? BigInt(0)))

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
        const demoTotal = demoRequests.filter(r => r.fulfilled).reduce((a, r) => a + r.net, BigInt(0))
        setTotalBridgedCombined(demoTotal)
      }
    } catch (e) {
      console.error('[bridge] loadData error', e)
    } finally {
      setRefresh(false)
    }
  }, [effectiveWld, effectiveBnb, isOwnerLocal, demoRequests])

  useEffect(() => { loadData() }, [effectiveWld, effectiveBnb, isOwnerLocal])

  // ─── Submit (demo mode) ────────────────────────────────────────────────────
  const handleSubmitDemo = () => {
    if (!effectiveWld || amtBig === BigInt(0) || !minOk) return
    const dest = destAddr || (direction === 'wld-to-bnb' ? effectiveBnb : effectiveWld) || ''
    if (!dest) { setTxStatus('✗ Necesitas una wallet destino'); return }

    const now = BigInt(Math.floor(Date.now() / 1000))
    const baseId = nextId()
    const newReqs: BridgeRequest[] = []

    const makeReq = (chunk: bigint, id: number, parentId: number): BridgeRequest => ({
      id, chain: direction === 'wld-to-bnb' ? 'wld' : 'bnb',
      user: effectiveWld!, destAddress: dest,
      amount: chunk, fee: DEFAULT_FLAT_FEE,
      net: chunk > DEFAULT_FLAT_FEE ? chunk - DEFAULT_FLAT_FEE : BigInt(0),
      createdAt: now, fulfilled: false, cancelled: false, parentId: BigInt(parentId),
    })

    if (isSplit) {
      let rem = amtBig; let idx = baseId; let isFirst = true
      while (rem >= DEFAULT_MIN_AMOUNT) {
        const chunk = rem > DEFAULT_CHUNK ? DEFAULT_CHUNK : rem
        newReqs.push(makeReq(chunk, idx, isFirst ? 0 : baseId))
        rem -= chunk; idx++; isFirst = false
      }
    } else {
      newReqs.push(makeReq(amtBig, baseId, 0))
    }

    saveDemoRequests([...demoRequests, ...newReqs])
    const plural = newReqs.length > 1 ? `Solicitud dividida en ${newReqs.length} chunks` : 'Solicitud registrada'
    setTxStatus(`✓ ${plural} · ${fmtS(amtBig)} SUSHI → ${shortAddr(dest)} · Net ≈ ${fmtS(netBig * BigInt(newReqs.length))} SUSHI · En espera de aprobación`)
    setAmount('')
    setDestAddr('')
  }

  // ─── Owner approve — AUTOMÁTICO (demo) ─────────────────────────────────────
  // En modo demo: 2 pasos simulados (Release en destino → Mark fulfilled en origen)
  // En modo live: 2 TXs reales
  const handleApproveRequest = async (id: number) => {
    setProcessingId(id)
    setTxStatus(null)
    try {
      if (!DEPLOYED) {
        const req = demoRequests.find(r => r.id === id)
        if (!req) return

        // Simulación paso 1: Release en red destino
        setTxStatus(`⏳ Paso 1/2 — Enviando ${fmtS(req.net)} SUSHI a ${shortAddr(req.destAddress)} en ${req.chain === 'wld' ? 'BNB Chain' : 'World Chain'}…`)
        await new Promise(r => setTimeout(r, 900))

        // Simulación paso 2: markFulfilled en red origen
        setTxStatus(`⏳ Paso 2/2 — Marcando solicitud #${id} como completada en ${req.chain === 'wld' ? 'World Chain' : 'BNB Chain'}…`)
        await new Promise(r => setTimeout(r, 700))

        // SUSHI del usuario queda en contrato como fundPool (liquidez reversa)
        saveDemoRequests(demoRequests.map(r => r.id === id ? { ...r, fulfilled: true } : r))
        setTxStatus(`✓ Solicitud #${id} procesada. ${fmtS(req.net)} SUSHI enviados a ${shortAddr(req.destAddress)} en ${req.chain === 'wld' ? 'BNB Chain' : 'World Chain'}. SUSHI del usuario queda en contrato como liquidez para el sentido inverso.`)
      } else {
        // LIVE MODE: 2 TXs reales automáticas
        const wldProv = getProvider()
        const bnbProv = new ethers.JsonRpcProvider(BNB_RPC)
        if (!bnbPrivateKey) throw new Error('Necesitas importar tu wallet BNB con clave privada para procesar solicitudes')

        const bnbSigner = new ethers.Wallet(bnbPrivateKey, bnbProv)
        const wldBridge = new ethers.Contract(BRIDGE_WLD_ADDRESS, BRIDGE_ABI, wldProv)
        const bnbBridge = new ethers.Contract(BRIDGE_BNB_ADDRESS, BRIDGE_BNB_ABI, bnbSigner)

        // Determinar qué request procesar y en qué dirección
        const reqList = [...wldWaiting, ...bnbWaiting]
        const req = reqList.find(r => r.id === id)
        if (!req) throw new Error(`Request #${id} no encontrado`)

        if (req.chain === 'wld') {
          // WLD→BNB: Release en BNB (auto-lee req.destAddress y req.net) → markFulfilled en WLD
          setTxStatus(`⏳ Paso 1/2 — Enviando ${fmtS(req.net)} SUSHI a ${shortAddr(req.destAddress)} en BNB…`)
          const tx1 = await bnbBridge.releaseToUser(req.destAddress, req.net)
          await tx1.wait()
          setTxStatus(`⏳ Paso 2/2 — Marcando solicitud #${id} como completada en WLD…`)
          // WLD requiere MiniKit / Permit2 — owner usa su WLD wallet via MiniKit
          // TODO: implementar via MiniKit sendTransaction
          setTxStatus(`✓ Release en BNB completado (TX: ${tx1.hash.slice(0,10)}…). Marca #${id} en WLD con: WLDContract.markFulfilled(${id})`)
        } else {
          // BNB→WLD: Release en WLD (auto-lee req.destAddress y req.net) → markFulfilled en BNB
          setTxStatus(`⏳ Paso 1/2 — Enviando ${fmtS(req.net)} SUSHI a ${shortAddr(req.destAddress)} en WLD…`)
          // WLD TX via MiniKit — owner usa su WLD wallet
          // TODO: implementar via MiniKit sendTransaction
          setTxStatus(`⏳ Paso 2/2 — Marcando solicitud #${id} como completada en BNB…`)
          const tx2 = await bnbBridge.markFulfilled(id)
          await tx2.wait()
          setTxStatus(`✓ Solicitud #${id} BNB→WLD procesada (TX: ${tx2.hash.slice(0,10)}…). Release en WLD: WLDContract.releaseToUser(${req.destAddress}, ${req.net})`)
        }
        await loadData()
      }
    } catch (e: any) {
      setTxStatus(`✗ Error: ${e?.reason ?? e?.message ?? 'Error desconocido'}`)
    } finally {
      setProcessingId(null)
    }
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────
  const handleCancelRequest = async (id: number) => {
    if (!confirm(`¿Cancelar solicitud #${id} y devolver SUSHI al usuario?`)) return
    setProcessingId(id)
    try {
      if (!DEPLOYED) {
        saveDemoRequests(demoRequests.map(r => r.id === id ? { ...r, cancelled: true } : r))
        setTxStatus(`✓ Solicitud #${id} cancelada. SUSHI devuelto al usuario.`)
      } else {
        const req = [...wldWaiting, ...bnbWaiting].find(r => r.id === id)
        if (!req || !bnbPrivateKey) return
        const bnbProv = new ethers.JsonRpcProvider(BNB_RPC)
        const bnbSigner = new ethers.Wallet(bnbPrivateKey, bnbProv)
        const contract = req.chain === 'bnb'
          ? new ethers.Contract(BRIDGE_BNB_ADDRESS, BRIDGE_BNB_ABI, bnbSigner)
          : null
        if (contract) { const tx = await contract.cancel(id); await tx.wait() }
        setTxStatus(`✓ Solicitud #${id} cancelada.`)
        await loadData()
      }
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason ?? e?.message ?? 'Error'}`)
    } finally {
      setProcessingId(null)
    }
  }

  const copyAddr = (addr: string) => {
    navigator.clipboard.writeText(addr).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const displayWLD = DEPLOYED ? wldWaiting : demoRequests.filter(r => r.chain === 'wld')
  const displayBNB = DEPLOYED ? bnbWaiting : demoRequests.filter(r => r.chain === 'bnb')
  const pendingWLD = displayWLD.filter(r => !r.fulfilled && !r.cancelled)
  const pendingBNB = displayBNB.filter(r => !r.fulfilled && !r.cancelled)

  const fromBal = direction === 'wld-to-bnb' ? sushiWLDBal : sushiBNBBal
  const fromNet = direction === 'wld-to-bnb' ? 'World Chain'  : 'BNB Chain'
  const toNet   = direction === 'wld-to-bnb' ? 'BNB Chain'   : 'World Chain'

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-28">

      {/* ─── Header ──────────────────────────────────────────────────────── */}
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
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Bridge Automático</p>
            <h2 className="text-lg font-black text-foreground">🍣 SUSHI Bridge</h2>
            <p className="text-[9px] text-[oklch(0.40_0.01_230)]">World Chain ↔ BNB Chain · Owner aprueba un click</p>
          </div>
          <button onClick={loadData} disabled={refreshing} className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5 text-[oklch(0.50_0.012_230)]', refreshing && 'animate-spin')} />
          </button>
        </div>

        {/* Balances */}
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

        {/* Total bridgeado — público */}
        <div className="mt-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[9px] font-bold text-emerald-400">Total Bridgeado (global)</span>
          </div>
          <span className="text-sm font-black font-mono text-emerald-400">{fmtS(totalBridgedCombined)} SUSHI</span>
        </div>

        {/* BNB wallet info */}
        {effectiveBnb && (
          <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-[#f0b90b]/8 border border-[#f0b90b]/20">
            <Wallet className="w-3 h-3 text-[#f0b90b] shrink-0" />
            <p className="text-[8px] text-[oklch(0.50_0.012_230)]">
              BNB: <span className="text-[#f0b90b] font-bold">{shortAddr(effectiveBnb)}</span>
              {!bnbAddress && <span className="ml-1 text-[oklch(0.40_0.01_230)]">(usando World Wallet)</span>}
              {bnbPrivateKey && <span className="ml-1 text-emerald-400 font-bold">· 🔑 Firmante listo</span>}
            </p>
          </div>
        )}
      </div>

      {/* ─── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-1">
        <TabBtn label="🌉 Bridge"     active={tab === 'bridge'}   onClick={() => setTab('bridge')} />
        <TabBtn label={`🌐 WLD (${pendingWLD.length})`} active={tab === 'wld-list'} onClick={() => setTab('wld-list')} />
        <TabBtn label={`🟡 BNB (${pendingBNB.length})`} active={tab === 'bnb-list'} onClick={() => setTab('bnb-list')} />
        {isOwnerLocal && <TabBtn label="⚙️ Admin" active={tab === 'admin'} onClick={() => setTab('admin')} />}
      </div>

      {/* Status */}
      {txStatus && (
        <div className={cn(
          'px-3 py-2.5 rounded-xl text-[10px] font-medium border leading-relaxed',
          txStatus.startsWith('✓') ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-400'
          : txStatus.startsWith('⏳') ? 'border-blue-500/30 bg-blue-500/8 text-blue-400'
          : 'border-red-500/30 bg-red-500/8 text-red-400'
        )}>
          {txStatus.startsWith('⏳') && <Loader2 className="w-3 h-3 animate-spin inline mr-1" />}
          {txStatus}
          {!txStatus.startsWith('⏳') && <button onClick={() => setTxStatus(null)} className="ml-2 opacity-50 hover:opacity-100">✕</button>}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: BRIDGE (formulario)
          ════════════════════════════════════════════════════════════════ */}
      {tab === 'bridge' && (
        <div className="space-y-3">
          {!DEPLOYED && <PreDeployBanner />}

          {/* Dirección */}
          <Card>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-xl bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-3 text-center">
                <p className="text-[8px] font-bold text-[oklch(0.40_0.01_230)]">DESDE</p>
                <p className="text-[10px] font-black text-foreground mt-0.5">{fromNet}</p>
              </div>
              <button onClick={() => setDir(d => d === 'wld-to-bnb' ? 'bnb-to-wld' : 'wld-to-bnb')}
                className="w-10 h-10 rounded-full bg-[oklch(0.65_0.22_255)]/20 border border-[oklch(0.65_0.22_255)]/40 flex items-center justify-center hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors shrink-0">
                <ArrowLeftRight className="w-4 h-4 text-[oklch(0.65_0.22_255)]" />
              </button>
              <div className="flex-1 rounded-xl bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-3 text-center">
                <p className="text-[8px] font-bold text-[oklch(0.40_0.01_230)]">HASTA</p>
                <p className="text-[10px] font-black text-foreground mt-0.5">{toNet}</p>
              </div>
            </div>
          </Card>

          {/* Amount */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Cantidad SUSHI</p>
              <p className="text-[9px] font-mono text-[oklch(0.45_0.01_230)]">Bal: <span className="text-foreground font-bold">{fmt(fromBal, 4)}</span></p>
            </div>
            <div className="relative">
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="Mín. 10 000 SUSHI"
                className="w-full bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-3 text-sm font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50 placeholder:text-[oklch(0.30_0.01_230)]" />
              <button onClick={() => setAmount(ethers.formatEther(fromBal))}
                className="absolute right-12 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[oklch(0.65_0.22_255)] hover:text-blue-300">MAX</button>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[oklch(0.50_0.012_230)]">SUSHI</div>
            </div>
            {amtBig > BigInt(0) && !minOk && <p className="text-[9px] text-red-400">Mínimo: 10 000 SUSHI</p>}
            {isSplit && (
              <div className="rounded-lg bg-blue-500/8 border border-blue-500/25 px-2.5 py-2 flex items-start gap-1.5">
                <Info className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-[9px] text-blue-300">
                  {'>'} 100 000 SUSHI → se divide automáticamente en <strong>{chunks} chunks</strong>. Fee total: <strong>{chunks} × 1 000 SUSHI</strong>.
                </p>
              </div>
            )}
          </div>

          {/* Dest address */}
          <div className="space-y-1">
            <p className="text-[10px] text-[oklch(0.45_0.01_230)]">
              Wallet destino en {toNet}
              <span className="ml-1 text-[oklch(0.35_0.01_230)]">(vacío = usa tu wallet)</span>
            </p>
            <input value={destAddr} onChange={e => setDestAddr(e.target.value)}
              placeholder={`0x… en ${toNet}`}
              className="w-full bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2.5 text-[11px] font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50 placeholder:text-[oklch(0.30_0.01_230)]" />
          </div>

          {/* Fee breakdown */}
          {amtBig >= DEFAULT_MIN_AMOUNT && (
            <Card className="space-y-1.5">
              <SectionTitle>Desglose</SectionTitle>
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-[oklch(0.45_0.01_230)]">Total enviado</span>
                  <span className="font-mono font-bold text-foreground">{fmtS(amtBig)} SUSHI</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[oklch(0.45_0.01_230)]">Comisión ({chunks > 1 ? `${chunks}×` : ''}1 000 flat)</span>
                  <span className="font-mono text-red-400">−{fmtS(DEFAULT_FLAT_FEE * BigInt(chunks))} SUSHI</span>
                </div>
                <div className="flex justify-between border-t border-[oklch(0.18_0.02_245)] pt-1">
                  <span className="font-bold text-foreground">Recibirás en {toNet}</span>
                  <span className="font-mono font-bold text-emerald-400">{fmtS(amtBig - DEFAULT_FLAT_FEE * BigInt(chunks))} SUSHI</span>
                </div>
              </div>
            </Card>
          )}

          {/* Route */}
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
                  {(() => {
                    const d = destAddr || (direction === 'wld-to-bnb' ? effectiveBnb : effectiveWld)
                    return d ? shortAddr(d) : '—'
                  })()}
                </p>
              </div>
            </div>
          </Card>

          {/* Info */}
          <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-blue-500/20 px-3 py-2.5 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-[9px] text-[oklch(0.50_0.012_230)] leading-relaxed space-y-0.5">
              <p>Tu SUSHI va al contrato. El owner aprueba con <strong className="text-foreground">un solo click</strong> — el sistema envía automáticamente a tu wallet en la red destino.</p>
              <p>Mín: <strong className="text-foreground">10 000 SUSHI</strong> · Fee: <strong className="text-foreground">1 000 SUSHI flat</strong> · SUSHI procesado queda en contrato como liquidez</p>
            </div>
          </div>

          <button onClick={handleSubmitDemo}
            disabled={loading || !effectiveWld || amtBig === BigInt(0) || !minOk}
            className="w-full py-3.5 rounded-2xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
            style={{ background: 'linear-gradient(135deg, #1d4ed8, #2563eb)', color: 'white', boxShadow: '0 0 20px rgba(37,99,235,0.3)' }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeftRight className="w-4 h-4" />}
            SOLICITAR BRIDGE {isSplit && `(${chunks} chunks)`}
          </button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: LISTA WLD (WLD→BNB)
          ════════════════════════════════════════════════════════════════ */}
      {tab === 'wld-list' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Solicitudes WLD → BNB</SectionTitle>
            <span className="text-[9px] font-bold text-amber-400">{pendingWLD.length} pendientes</span>
          </div>

          {wldStats && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'En espera', val: fmtS(wldStats.userPool), color: 'text-amber-400' },
                { label: 'FundPool', val: fmtS(wldStats.fundPool), color: 'text-blue-400' },
                { label: 'Fees', val: fmtS(wldStats.feePool), color: 'text-violet-400' },
              ].map(s => (
                <Card key={s.label} className="text-center py-2">
                  <p className="text-[7px] text-[oklch(0.40_0.01_230)]">{s.label}</p>
                  <p className={cn('text-[10px] font-black font-mono', s.color)}>{s.val}</p>
                </Card>
              ))}
            </div>
          )}

          {displayWLD.length === 0 ? (
            <Card className="text-center py-8">
              <ArrowLeftRight className="w-8 h-8 mx-auto text-[oklch(0.25_0.01_230)] mb-2" />
              <p className="text-xs text-[oklch(0.40_0.01_230)]">Sin solicitudes WLD→BNB</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {displayWLD.map(req => (
                <RequestCard key={req.id} req={req} isOwner={isOwnerLocal}
                  processing={processingId === req.id}
                  onApprove={handleApproveRequest}
                  onCancel={handleCancelRequest} />
              ))}
            </div>
          )}

          {isOwnerLocal && !DEPLOYED && (
            <div className="rounded-xl bg-blue-500/8 border border-blue-500/20 p-3">
              <p className="text-[9px] text-blue-300 font-bold mb-1">Flujo WLD→BNB (automático)</p>
              <ol className="text-[8px] text-[oklch(0.50_0.012_230)] space-y-0.5 list-decimal list-inside">
                <li>Usuario deposita SUSHI en contrato WLD → solicitud guardada con ID y destino BNB</li>
                <li>Owner hace click "APROBAR" → sistema lee automáticamente wallet BNB y monto neto</li>
                <li>TX 1: BNBContract.releaseToUser(destAddress, net) → SUSHI llega al usuario en BNB</li>
                <li>TX 2: WLDContract.markFulfilled(id) → SUSHI del usuario pasa a fundPool (liquidez BNB→WLD)</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: LISTA BNB (BNB→WLD)
          ════════════════════════════════════════════════════════════════ */}
      {tab === 'bnb-list' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Solicitudes BNB → WLD</SectionTitle>
            <span className="text-[9px] font-bold text-amber-400">{pendingBNB.length} pendientes</span>
          </div>

          {bnbStats && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'En espera', val: fmtS(bnbStats.userPool), color: 'text-amber-400' },
                { label: 'FundPool', val: fmtS(bnbStats.fundPool), color: 'text-blue-400' },
                { label: 'Fees', val: fmtS(bnbStats.feePool), color: 'text-violet-400' },
              ].map(s => (
                <Card key={s.label} className="text-center py-2">
                  <p className="text-[7px] text-[oklch(0.40_0.01_230)]">{s.label}</p>
                  <p className={cn('text-[10px] font-black font-mono', s.color)}>{s.val}</p>
                </Card>
              ))}
            </div>
          )}

          {displayBNB.length === 0 ? (
            <Card className="text-center py-8">
              <ArrowLeftRight className="w-8 h-8 mx-auto text-[oklch(0.25_0.01_230)] mb-2" />
              <p className="text-xs text-[oklch(0.40_0.01_230)]">Sin solicitudes BNB→WLD</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {displayBNB.map(req => (
                <RequestCard key={req.id} req={req} isOwner={isOwnerLocal}
                  processing={processingId === req.id}
                  onApprove={handleApproveRequest}
                  onCancel={handleCancelRequest} />
              ))}
            </div>
          )}

          {isOwnerLocal && !DEPLOYED && (
            <div className="rounded-xl bg-amber-500/8 border border-amber-500/20 p-3">
              <p className="text-[9px] text-amber-300 font-bold mb-1">Flujo BNB→WLD (automático)</p>
              <ol className="text-[8px] text-[oklch(0.50_0.012_230)] space-y-0.5 list-decimal list-inside">
                <li>Usuario deposita SUSHI en contrato BNB → solicitud guardada con ID y destino WLD</li>
                <li>Owner hace click "APROBAR" → sistema lee automáticamente wallet WLD y monto neto</li>
                <li>TX 1: WLDContract.releaseToUser(destAddress, net) → SUSHI llega al usuario en WLD</li>
                <li>TX 2: BNBContract.markFulfilled(id) → SUSHI del usuario pasa a fundPool (liquidez WLD→BNB)</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          TAB: ADMIN (solo owners)
          ════════════════════════════════════════════════════════════════ */}
      {tab === 'admin' && isOwnerLocal && (
        <div className="space-y-4">

          {/* ── Header badge ──────────────────────────────────────────────── */}
          <div className="rounded-xl overflow-hidden border border-violet-500/25"
            style={{ background: 'linear-gradient(135deg, oklch(0.10 0.025 285), oklch(0.08 0.018 245))' }}>
            <div className="flex items-center gap-3 px-3 py-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-black text-violet-300">Panel Owner</p>
                <p className="text-[8px] text-[oklch(0.45_0.01_230)]">Bridge SUSHI v3-lean · deploy pendiente</p>
              </div>
              {!bnbPrivateKey && (
                <div className="rounded-lg bg-amber-500/15 border border-amber-500/30 px-2 py-1">
                  <p className="text-[7px] font-bold text-amber-400">Sin clave BNB</p>
                </div>
              )}
              {bnbPrivateKey && (
                <div className="rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2 py-1">
                  <p className="text-[7px] font-bold text-emerald-400">🔑 BNB listo</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Pendientes + Procesar ─────────────────────────────────────── */}
          <div>
            <SectionTitle>Solicitudes pendientes</SectionTitle>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => setTab('wld-list')}
                className="group relative rounded-xl border border-blue-500/30 bg-blue-500/8 p-3 text-center hover:bg-blue-500/14 transition-all active:scale-95">
                <p className="text-3xl font-black text-blue-400 tabular-nums">{pendingWLD.length}</p>
                <p className="text-[9px] font-bold text-blue-300 mt-0.5">WLD → BNB</p>
                <p className="text-[7px] text-[oklch(0.40_0.01_230)] mt-0.5">Ver · Aprobar</p>
                {pendingWLD.length > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                )}
              </button>
              <button onClick={() => setTab('bnb-list')}
                className="group relative rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 text-center hover:bg-amber-500/14 transition-all active:scale-95">
                <p className="text-3xl font-black text-amber-400 tabular-nums">{pendingBNB.length}</p>
                <p className="text-[9px] font-bold text-amber-300 mt-0.5">BNB → WLD</p>
                <p className="text-[7px] text-[oklch(0.40_0.01_230)] mt-0.5">Ver · Aprobar</p>
                {pendingBNB.length > 0 && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                )}
              </button>
            </div>
            {(pendingWLD.length + pendingBNB.length) > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setTab('wld-list') }}
                  className="py-2.5 rounded-xl text-[9px] font-black flex items-center justify-center gap-1.5 transition-all active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8, #2563eb)', color: 'white' }}
                >
                  <Zap className="w-3 h-3" /> Procesar WLD ({pendingWLD.length})
                </button>
                <button
                  onClick={() => { setTab('bnb-list') }}
                  className="py-2.5 rounded-xl text-[9px] font-black flex items-center justify-center gap-1.5 transition-all active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #92400e, #d97706)', color: 'white' }}
                >
                  <Zap className="w-3 h-3" /> Procesar BNB ({pendingBNB.length})
                </button>
              </div>
            )}
          </div>

          {/* ── Pools de contratos ────────────────────────────────────────── */}
          <div>
            <SectionTitle>Balances de contratos</SectionTitle>
            <div className="mt-2 space-y-2">
              {/* WLD */}
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <p className="text-[9px] font-bold text-blue-400">AcuaBridgeWLD</p>
                    <span className="text-[7px] text-[oklch(0.35_0.01_230)]">World Chain 480</span>
                  </div>
                  {DEPLOYED && wldStats && (
                    <span className={cn('text-[7px] font-bold px-1.5 py-0.5 rounded-full', wldStats.paused ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400')}>
                      {wldStats.paused ? '⏸ Pausado' : '▶ Activo'}
                    </span>
                  )}
                </div>
                {DEPLOYED && wldStats ? (
                  <div className="space-y-1.5">
                    {[
                      { label: 'FundPool (liquidez owner)', val: fmtS(wldStats.fundPool), color: 'text-blue-400', pct: wldContractBal > BigInt(0) ? Number(wldStats.fundPool * 100n / wldContractBal) : 0 },
                      { label: 'UserPool (pendientes)', val: fmtS(wldStats.userPool), color: 'text-amber-400', pct: wldContractBal > BigInt(0) ? Number(wldStats.userPool * 100n / wldContractBal) : 0 },
                      { label: 'FeePool (comisiones)', val: fmtS(wldStats.feePool), color: 'text-violet-400', pct: wldContractBal > BigInt(0) ? Number(wldStats.feePool * 100n / wldContractBal) : 0 },
                    ].map(p => (
                      <div key={p.label}>
                        <div className="flex justify-between text-[8px] mb-0.5">
                          <span className="text-[oklch(0.40_0.01_230)]">{p.label}</span>
                          <span className={cn('font-mono font-bold', p.color)}>{p.val} SUSHI</span>
                        </div>
                        <div className="h-1 rounded-full bg-[oklch(0.08_0.015_245)]">
                          <div className="h-full rounded-full bg-current transition-all" style={{ width: `${Math.min(p.pct, 100)}%`, color: p.color.replace('text-', '') }} />
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between text-[8px] pt-1 border-t border-[oklch(0.18_0.02_245)]">
                      <span className="text-[oklch(0.40_0.01_230)]">Total contrato</span>
                      <span className="font-mono font-bold text-foreground">{fmtS(wldContractBal)} SUSHI</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-2 text-center">
                    <p className="text-[9px] text-amber-400 font-bold">{DEPLOYED ? 'Cargando…' : 'Pendiente de deploy'}</p>
                    <p className="text-[8px] text-[oklch(0.35_0.01_230)] mt-0.5">contracts-hh/scripts/deploy-bridge-wld.js</p>
                  </div>
                )}
              </Card>

              {/* BNB */}
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                    <p className="text-[9px] font-bold text-amber-400">AcuaBridgeBNB</p>
                    <span className="text-[7px] text-[oklch(0.35_0.01_230)]">BNB Chain 56</span>
                  </div>
                  {DEPLOYED && bnbStats && (
                    <span className={cn('text-[7px] font-bold px-1.5 py-0.5 rounded-full', bnbStats.paused ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400')}>
                      {bnbStats.paused ? '⏸ Pausado' : '▶ Activo'}
                    </span>
                  )}
                </div>
                {DEPLOYED && bnbStats ? (
                  <div className="space-y-1.5">
                    {[
                      { label: 'FundPool (liquidez owner)', val: fmtS(bnbStats.fundPool), color: 'text-blue-400', pct: bnbContractBal > BigInt(0) ? Number(bnbStats.fundPool * 100n / bnbContractBal) : 0 },
                      { label: 'UserPool (pendientes)', val: fmtS(bnbStats.userPool), color: 'text-amber-400', pct: bnbContractBal > BigInt(0) ? Number(bnbStats.userPool * 100n / bnbContractBal) : 0 },
                      { label: 'FeePool (comisiones)', val: fmtS(bnbStats.feePool), color: 'text-violet-400', pct: bnbContractBal > BigInt(0) ? Number(bnbStats.feePool * 100n / bnbContractBal) : 0 },
                    ].map(p => (
                      <div key={p.label}>
                        <div className="flex justify-between text-[8px] mb-0.5">
                          <span className="text-[oklch(0.40_0.01_230)]">{p.label}</span>
                          <span className={cn('font-mono font-bold', p.color)}>{p.val} SUSHI</span>
                        </div>
                        <div className="h-1 rounded-full bg-[oklch(0.08_0.015_245)]">
                          <div className="h-full rounded-full bg-current transition-all" style={{ width: `${Math.min(p.pct, 100)}%`, color: p.color.replace('text-', '') }} />
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between text-[8px] pt-1 border-t border-[oklch(0.18_0.02_245)]">
                      <span className="text-[oklch(0.40_0.01_230)]">Total contrato</span>
                      <span className="font-mono font-bold text-foreground">{fmtS(bnbContractBal)} SUSHI</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-2 text-center">
                    <p className="text-[9px] text-amber-400 font-bold">{DEPLOYED ? 'Cargando…' : 'Pendiente de deploy'}</p>
                    <p className="text-[8px] text-[oklch(0.35_0.01_230)] mt-0.5">contracts-hh/scripts/deploy-bridge-bnb.js</p>
                  </div>
                )}
              </Card>
            </div>
          </div>

          {/* ── Fondear / Retirar BNB (real si hay clave) ─────────────────── */}
          <div>
            <SectionTitle>Fondear · Retirar (BNB Chain)</SectionTitle>
            <Card className="mt-2 space-y-2.5">
              <div className="space-y-1.5">
                <div className="relative">
                  <input value={adminAmt} onChange={e => setAdminAmt(e.target.value)}
                    placeholder="Cantidad SUSHI (ej: 50000)"
                    className="w-full bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-2.5 text-[10px] font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50" />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[oklch(0.40_0.01_230)]">SUSHI</span>
                </div>
                <input value={adminAddr} onChange={e => setAdminAddr(e.target.value)}
                  placeholder="0x… wallet destino (retiro)"
                  className="w-full bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-2.5 text-[10px] font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={async () => {
                    if (!DEPLOYED || !bnbPrivateKey || !adminAmt) { setTxStatus('📋 Fondear BNB: approve SUSHI → fund(amount) en AcuaBridgeBNB'); return }
                    setTxStatus('⏳ Fondeando BNB — paso 1/2: approve SUSHI…')
                    try {
                      const prov = new ethers.JsonRpcProvider(BNB_RPC)
                      const signer = new ethers.Wallet(bnbPrivateKey, prov)
                      const amt = ethers.parseEther(adminAmt)
                      const sushi = new ethers.Contract(SUSHI_BNB, ['function approve(address,uint256) returns (bool)'], signer)
                      const t1 = await sushi.approve(BRIDGE_BNB_ADDRESS, amt, { gasPrice: 1_000_000_000n, gasLimit: 55_000n })
                      await t1.wait()
                      setTxStatus('⏳ Fondeando BNB — paso 2/2: fund()…')
                      const bridge = new ethers.Contract(BRIDGE_BNB_ADDRESS, ['function fund(uint256)'], signer)
                      const t2 = await bridge.fund(amt, { gasPrice: 1_000_000_000n, gasLimit: 80_000n })
                      await t2.wait()
                      setTxStatus(`✓ FundPool BNB fondeado con ${adminAmt} SUSHI (TX: ${t2.hash.slice(0,10)}…)`)
                      await loadData()
                    } catch (e: any) { setTxStatus(`✗ ${e?.reason ?? e?.message ?? 'Error'}`) }
                  }}
                  className="py-2.5 rounded-lg text-[9px] font-bold bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30 transition-colors flex items-center justify-center gap-1">
                  <Zap className="w-3 h-3" /> Fondear BNB
                </button>
                <button
                  onClick={async () => {
                    if (!DEPLOYED || !bnbPrivateKey || !adminAmt || !adminAddr) { setTxStatus('📋 Retirar BNB: withdraw(amount, to) en AcuaBridgeBNB'); return }
                    setTxStatus('⏳ Retirando de fundPool BNB…')
                    try {
                      const prov = new ethers.JsonRpcProvider(BNB_RPC)
                      const signer = new ethers.Wallet(bnbPrivateKey, prov)
                      const bridge = new ethers.Contract(BRIDGE_BNB_ADDRESS, ['function withdraw(uint256,address)'], signer)
                      const t = await bridge.withdraw(ethers.parseEther(adminAmt), adminAddr, { gasPrice: 1_000_000_000n, gasLimit: 80_000n })
                      await t.wait()
                      setTxStatus(`✓ ${adminAmt} SUSHI retirado a ${adminAddr.slice(0,10)}… (TX: ${t.hash.slice(0,10)}…)`)
                      await loadData()
                    } catch (e: any) { setTxStatus(`✗ ${e?.reason ?? e?.message ?? 'Error'}`) }
                  }}
                  className="py-2.5 rounded-lg text-[9px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors flex items-center justify-center gap-1">
                  <XCircle className="w-3 h-3" /> Retirar BNB
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setTxStatus('📋 Fondear WLD: usa MiniKit + Permit2 → fund(permit,sig,amount) en AcuaBridgeWLD')}
                  className="py-2.5 rounded-lg text-[9px] font-bold bg-blue-500/20 border border-blue-500/30 text-blue-400 hover:bg-blue-500/30 transition-colors">
                  Fondear WLD
                </button>
                <button onClick={() => setTxStatus('📋 Retirar WLD: withdraw(amount, to) via MiniKit en AcuaBridgeWLD')}
                  className="py-2.5 rounded-lg text-[9px] font-bold bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 transition-colors">
                  Retirar WLD
                </button>
              </div>

              <button
                onClick={async () => {
                  if (!DEPLOYED || !bnbPrivateKey) { setTxStatus('📋 withdrawFees: withdrawFees(ownerAddr) — 10% auto → owner2'); return }
                  const to = adminAddr || effectiveBnb || ''
                  if (!to) { setTxStatus('✗ Introduce wallet destino'); return }
                  setTxStatus('⏳ Retirando fees de BNB…')
                  try {
                    const prov = new ethers.JsonRpcProvider(BNB_RPC)
                    const signer = new ethers.Wallet(bnbPrivateKey, prov)
                    const bridge = new ethers.Contract(BRIDGE_BNB_ADDRESS, ['function withdrawFees(address)'], signer)
                    const t = await bridge.withdrawFees(to, { gasPrice: 1_000_000_000n, gasLimit: 90_000n })
                    await t.wait()
                    setTxStatus(`✓ Fees retirados → ${to.slice(0,10)}… (10% auto → owner2) TX: ${t.hash.slice(0,10)}…`)
                    await loadData()
                  } catch (e: any) { setTxStatus(`✗ ${e?.reason ?? e?.message ?? 'Error'}`) }
                }}
                className="w-full py-2.5 rounded-lg text-[9px] font-black bg-violet-500/20 border border-violet-500/30 text-violet-400 hover:bg-violet-500/30 transition-colors flex items-center justify-center gap-1.5">
                <TrendingUp className="w-3 h-3" /> Retirar Fees BNB (10% auto → owner2)
              </button>
            </Card>
          </div>

          {/* ── Configuración ─────────────────────────────────────────────── */}
          <div>
            <button onClick={() => setShowConfig(c => !c)} className="flex items-center gap-2 w-full text-left">
              <SectionTitle>Configuración de contratos</SectionTitle>
              {showConfig ? <ChevronUp className="w-3 h-3 text-[oklch(0.40_0.01_230)]" /> : <ChevronDown className="w-3 h-3 text-[oklch(0.40_0.01_230)]" />}
            </button>
            {showConfig && (
              <Card className="mt-2 space-y-3">
                <div className="grid grid-cols-3 gap-1.5 text-center text-[8px] mb-1">
                  {[
                    { l: 'Fee flat', v: '1 000 SUSHI' },
                    { l: 'Mínimo', v: '10 000 SUSHI' },
                    { l: 'Owner2 %', v: '10 %' },
                  ].map(s => (
                    <div key={s.l} className="rounded-lg bg-[oklch(0.08_0.015_245)] border border-[oklch(0.15_0.015_245)] p-1.5">
                      <p className="text-[oklch(0.40_0.01_230)]">{s.l}</p>
                      <p className="font-bold text-foreground text-[9px]">{s.v}</p>
                    </div>
                  ))}
                </div>
                {[
                  { label: 'Fee flat (SUSHI por request)', val: cfgFee, set: setCfgFee, fn: () => setTxStatus(`📋 setFlatFee(${ethers.parseEther(cfgFee || '0')}) en ambos contratos`) },
                  { label: 'Mínimo bridge (SUSHI)', val: cfgMin, set: setCfgMin, fn: () => setTxStatus(`📋 setMinAmount(${ethers.parseEther(cfgMin || '0')}) en ambos contratos`) },
                  { label: '% fees owner2 (bps, 1000=10%)', val: cfgMemBps, set: setCfgMemBps, fn: () => setTxStatus(`📋 setMembershipFeeBps(${cfgMemBps}) en ambos contratos`) },
                ].map(c => (
                  <div key={c.label} className="space-y-1">
                    <label className="text-[8px] text-[oklch(0.45_0.01_230)]">{c.label}</label>
                    <div className="flex gap-2">
                      <input value={c.val} onChange={e => c.set(e.target.value)}
                        className="flex-1 bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-foreground focus:outline-none focus:border-[oklch(0.65_0.22_255)]/50" />
                      <button onClick={c.fn}
                        className="px-3 py-1.5 rounded-lg text-[9px] font-bold bg-[oklch(0.65_0.22_255)]/20 border border-[oklch(0.65_0.22_255)]/30 text-[oklch(0.65_0.22_255)] hover:bg-[oklch(0.65_0.22_255)]/30 transition-colors">
                        Set
                      </button>
                    </div>
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button onClick={() => setTxStatus('📋 setPaused(true) en ambos contratos')}
                    className="py-2 rounded-lg text-[9px] font-bold bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors">
                    ⏸ Pausar bridge
                  </button>
                  <button onClick={() => setTxStatus('📋 setPaused(false) en ambos contratos')}
                    className="py-2 rounded-lg text-[9px] font-bold bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-colors">
                    ▶ Reanudar bridge
                  </button>
                </div>
              </Card>
            )}
          </div>

          {/* ── Direcciones de contratos ───────────────────────────────────── */}
          <div>
            <SectionTitle>Direcciones de contratos</SectionTitle>
            <Card className="mt-2 space-y-3">
              {[
                { label: 'AcuaBridgeWLD v3-lean (World Chain 480)', addr: BRIDGE_WLD_ADDRESS, scan: 'https://worldscan.org/address/' },
                { label: 'AcuaBridgeBNB v3-lean (BNB Chain 56)', addr: BRIDGE_BNB_ADDRESS, scan: 'https://bscscan.com/address/' },
              ].map(c => {
                const isPending = c.addr === '0x0000000000000000000000000000000000000001' || c.addr === '0x0000000000000000000000000000000000000002'
                return (
                  <div key={c.label}>
                    <p className="text-[8px] text-[oklch(0.40_0.01_230)] mb-1">{c.label}</p>
                    <div className="flex items-center gap-2 rounded-lg bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] px-2.5 py-2">
                      {isPending ? (
                        <p className="flex-1 text-[9px] font-bold text-amber-400">⏳ Pendiente de deploy</p>
                      ) : (
                        <>
                          <p className="flex-1 text-[8px] font-mono text-foreground truncate">{c.addr}</p>
                          <button onClick={() => copyAddr(c.addr)} className="text-[oklch(0.40_0.01_230)] hover:text-foreground shrink-0">
                            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                          <a href={`${c.scan}${c.addr}`} target="_blank" rel="noopener noreferrer" className="text-[oklch(0.40_0.01_230)] hover:text-blue-400 shrink-0">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </Card>
          </div>

          {/* ── Deploy cost v3-lean ────────────────────────────────────────── */}
          <div>
            <SectionTitle>Costo de deploy (v3-lean)</SectionTitle>
            <Card className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-center text-[8px]">
                {[
                  { l: 'Gas total', v: '~1 490 000', sub: 'era ~1 950 000' },
                  { l: 'Mínimo gas', v: '1 gwei', sub: 'hard floor BSC' },
                  { l: 'Costo @ 1gwei', v: '0.0015 BNB', sub: '≈ $0.90' },
                  { l: 'Costo @ 3gwei', v: '0.0045 BNB', sub: '≈ $2.70' },
                ].map(s => (
                  <div key={s.l} className="rounded-lg bg-[oklch(0.08_0.015_245)] border border-[oklch(0.18_0.02_245)] p-2">
                    <p className="text-[oklch(0.40_0.01_230)] text-[7px]">{s.l}</p>
                    <p className="font-bold text-foreground text-[10px]">{s.v}</p>
                    <p className="text-[oklch(0.35_0.01_230)] text-[7px]">{s.sub}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-blue-500/8 border border-blue-500/20 p-2.5 space-y-1">
                <p className="text-[9px] font-black text-blue-300">Resumen para deployer</p>
                <div className="space-y-0.5 text-[8px] text-[oklch(0.50_0.012_230)]">
                  <p>• BNB mínimo recomendado: <strong className="text-foreground">0.02 BNB</strong> (~$12)</p>
                  <p>• Cubre deploy + 5 setup txs + approve SUSHI + fund()</p>
                  <p>• AcuaBridgeWLD en World Chain: costo ≈ $0 (gas ultrabajo)</p>
                  <p>• Gas price BSC: 1 gwei = mínimo · 3 gwei = inclusión rápida</p>
                  <p className="text-amber-400 font-bold">⚠️ No usar &lt; 1 gwei — los validadores rechazan el TX</p>
                </div>
              </div>
              <div className="space-y-0.5 text-[8px] text-[oklch(0.45_0.01_230)]">
                <p className="font-bold text-[oklch(0.50_0.012_230)]">Scripts de deploy:</p>
                <p className="font-mono text-blue-400">contracts-hh/scripts/deploy-bridge-bnb.js</p>
                <p className="font-mono text-blue-400">contracts-hh/scripts/deploy-bridge-wld.js</p>
              </div>
            </Card>
          </div>

          {/* ── Estadísticas globales ─────────────────────────────────────── */}
          <div>
            <SectionTitle>Estadísticas globales</SectionTitle>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                { label: 'Total bridgeado', val: fmtS(totalBridgedCombined) + ' SUSHI', color: 'text-emerald-400' },
                { label: 'Solicitudes WLD', val: DEPLOYED ? (wldStats?.totalRequests.toString() ?? '?') : String(demoRequests.filter(r => r.chain === 'wld').length), color: 'text-blue-400' },
                { label: 'Solicitudes BNB', val: DEPLOYED ? (bnbStats?.totalRequests.toString() ?? '?') : String(demoRequests.filter(r => r.chain === 'bnb').length), color: 'text-amber-400' },
                { label: 'Completadas', val: DEPLOYED ? '—' : String(demoRequests.filter(r => r.fulfilled).length), color: 'text-emerald-400' },
              ].map(s => (
                <Card key={s.label} className="py-2 text-center">
                  <p className="text-[7px] text-[oklch(0.40_0.01_230)]">{s.label}</p>
                  <p className={cn('font-black font-mono text-[11px]', s.color)}>{s.val}</p>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
