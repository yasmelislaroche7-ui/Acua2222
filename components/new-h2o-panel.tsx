'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Droplets, Zap, Users, Gift, Copy, Check, ExternalLink,
  TrendingUp, ArrowDownToLine, ArrowUpFromLine, RefreshCw,
  Sparkles, Shield, Clock, ChevronRight, Heart, Info, Star,
  Loader2, CheckCircle2, XCircle, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { WORLD_CHAIN_RPC, randomNonce } from '@/lib/new-contracts'

// ─── Contract Config ─────────────────────────────────────────────────────────
const H2O_STAKE2_ADDR   = '0x7f78b1B2c881E90D49C780461a88cb6CAC875afc'
const H2O2_TOKEN        = '0x08131A6f780AEF79E86518c4A10c06387Ec74636'
const H2O2_DECIMALS     = 18
const APP_DOMAIN        = 'https://acua.app'

// ─── ABIs ────────────────────────────────────────────────────────────────────
const ABI_GET_GLOBAL = [
  'function getGlobalStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
]
const ABI_GET_USER = [
  'function getUserInfo(address) view returns (uint256,uint256,bool,uint256,address,uint256,uint256)',
]
const ABI_PENDING = [
  'function pendingRewards(address) view returns (uint256)',
]
const ABI_GET_REFS = [
  'function getReferrals(address) view returns (address[])',
]
const ABI_REFERRED_BY = [
  'function referredBy(address) view returns (address)',
]
const ABI_STAKE = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'permit', type: 'tuple', components: [
          { name: 'permitted', type: 'tuple', components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
          ]},
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
      ]},
      { name: 'sig', type: 'bytes' },
      { name: 'grossAmount', type: 'uint256' },
      { name: 'referrer', type: 'address' },
    ],
    outputs: [],
  },
]
const ABI_STAKE_NORMAL = [
  'function stakeNormal(uint256 grossAmount, address referrer) nonpayable',
]
const ABI_WITHDRAW = [
  'function requestWithdrawal(uint256 amount) nonpayable',
]
const ABI_CLAIM = [
  'function claimRewards() nonpayable',
]
const ABI_REGISTER = [
  'function register(address referrer) nonpayable',
]
const ABI_TRIGGER = [
  'function triggerQueue() nonpayable',
]
const ABI_FUND = [
  {
    name: 'fund',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'permit', type: 'tuple', components: [
          { name: 'permitted', type: 'tuple', components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
          ]},
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
      ]},
      { name: 'sig', type: 'bytes' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
]
const ABI_ERC20_BALANCE = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) nonpayable returns (bool)',
]

// ─── Types ───────────────────────────────────────────────────────────────────
interface GlobalStats {
  totalStaked: bigint
  fundPool: bigint
  totalDeposited: bigint
  totalWithdrawn: bigint
  totalClaimed: bigint
  totalFeesPaid: bigint
  totalReferralsPaid: bigint
  totalFunded: bigint
  totalUsers: bigint
  totalReferralLinks: bigint
  aprBps: bigint
  withdrawQueueLen: bigint
  totalPendingWithdrawals: bigint
  totalPaidWithdrawals: bigint
}
interface UserInfo {
  staked: bigint
  rewards: bigint
  hasPendingWithdraw: boolean
  withdrawReadyAt: bigint
  referrer: string
  refEarnings: bigint
  refCount: bigint
}
interface MsgState { ok: boolean; text: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(val: bigint, dec = 18, dp = 3): string {
  return Number(ethers.formatUnits(val, dec)).toLocaleString('es', {
    minimumFractionDigits: 0, maximumFractionDigits: dp,
  })
}
function fmtApr(aprBps: bigint): string {
  return (Number(aprBps) / 100).toFixed(2) + '%'
}
function shortAddr(addr: string): string {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}
function parseMiniKitError(payload: any): string {
  if (!payload) return 'Sin respuesta del wallet'
  if (payload.status === 'error') {
    const d = payload.errorCode || payload.description || ''
    if (typeof d === 'string' && d.includes('user_rejected')) return 'Transacción cancelada'
    return d || 'Error desconocido'
  }
  return 'Error desconocido'
}
function isValidAddr(addr: string): boolean {
  try { ethers.getAddress(addr); return true } catch { return false }
}
function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatBox({ label, value, sub, accent = 'text-cyan-400' }: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <span className={cn('text-lg font-black truncate', accent)}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
    </div>
  )
}
function MsgBanner({ msg, onClear }: { msg: MsgState; onClear: () => void }) {
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-2xl p-3 text-sm border',
      msg.ok
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        : 'bg-red-500/10 border-red-500/30 text-red-300'
    )}>
      {msg.ok
        ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span className="flex-1 break-words text-xs leading-relaxed">{msg.text}</span>
      <button onClick={onClear} className="shrink-0 opacity-60 hover:opacity-100 text-xs">✕</button>
    </div>
  )
}
function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 p-2.5">
      <span className="flex-1 text-xs font-mono text-muted-foreground truncate">{label}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        className="shrink-0 flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
function ActionBtn({
  onClick, loading, disabled, label, icon, color = 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300',
}: {
  onClick: () => void; loading?: boolean; disabled?: boolean
  label: string; icon: React.ReactNode; color?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'flex items-center gap-2 w-full rounded-2xl px-4 py-3 text-sm font-bold border transition-opacity',
        color,
        (disabled || loading) ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80 active:scale-[.98]'
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : icon}
      <span>{loading ? 'Procesando…' : label}</span>
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  userAddress: string
  walletMode?: 'minikit' | 'imported' | null
  importedSigner?: ethers.Signer | null
}

export function NewH2OPanel({ userAddress, walletMode, importedSigner }: Props) {
  const [tab, setTab] = useState<'stake' | 'referidos' | 'stats'>('stake')

  // ── Data state ──────────────────────────────────────────────────────────
  const [global, setGlobal]     = useState<GlobalStats | null>(null)
  const [user, setUser]         = useState<UserInfo | null>(null)
  const [myRefs, setMyRefs]     = useState<string[]>([])
  const [h2oBalance, setH2oBal] = useState(0n)
  const [loadingData, setLoadingData] = useState(false)

  // ── Tx state ───────────────────────────────────────────────────────────
  const [stakeAmt, setStakeAmt]   = useState('')
  const [wdAmt, setWdAmt]         = useState('')
  const [stakeMsg, setStakeMsg]   = useState<MsgState | null>(null)
  const [wdMsg, setWdMsg]         = useState<MsgState | null>(null)
  const [claimMsg, setClaimMsg]   = useState<MsgState | null>(null)
  const [regMsg, setRegMsg]       = useState<MsgState | null>(null)
  const [loadingStake, setLStake] = useState(false)
  const [loadingWd, setLWd]       = useState(false)
  const [loadingClaim, setLClaim] = useState(false)
  const [loadingReg, setLReg]     = useState(false)

  // ── Referral state ─────────────────────────────────────────────────────
  const [refInput, setRefInput]    = useState('')
  const [urlRef, setUrlRef]        = useState('')
  const [refFromUrl, setRefFromUrl] = useState(false)

  const addr = userAddress?.toLowerCase() !== ethers.ZeroAddress.toLowerCase() ? userAddress : ''
  const isWorldApp = walletMode === 'minikit' || MiniKit.isInstalled()

  // ── Parse URL ref on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const r = params.get('ref') || ''
    if (r && isValidAddr(r)) {
      setUrlRef(r)
      setRefInput(r)
      setRefFromUrl(true)
    }
  }, [])

  // ── Load data ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!addr) return
    setLoadingData(true)
    try {
      const provider = getProvider()
      const contract = new ethers.Contract(H2O_STAKE2_ADDR, [
        ...ABI_GET_GLOBAL, ...ABI_GET_USER, ...ABI_GET_REFS,
      ], provider)
      const token = new ethers.Contract(H2O2_TOKEN, ABI_ERC20_BALANCE, provider)

      const [gs, ui, refs, bal] = await Promise.all([
        contract.getGlobalStats(),
        contract.getUserInfo(addr),
        contract.getReferrals(addr),
        token.balanceOf(addr),
      ])

      setGlobal({
        totalStaked:          gs[0],
        fundPool:             gs[1],
        totalDeposited:       gs[2],
        totalWithdrawn:       gs[3],
        totalClaimed:         gs[4],
        totalFeesPaid:        gs[5],
        totalReferralsPaid:   gs[6],
        totalFunded:          gs[7],
        totalUsers:           gs[8],
        totalReferralLinks:   gs[9],
        aprBps:               gs[10],
        withdrawQueueLen:     gs[11],
        totalPendingWithdrawals: gs[12],
        totalPaidWithdrawals:    gs[13],
      })
      setUser({
        staked:              ui[0],
        rewards:             ui[1],
        hasPendingWithdraw:  ui[2],
        withdrawReadyAt:     ui[3],
        referrer:            ui[4],
        refEarnings:         ui[5],
        refCount:            ui[6],
      })
      setMyRefs(refs as string[])
      setH2oBal(bal)
    } catch (e) {
      console.error('H2OStake2 loadData:', e)
    } finally {
      setLoadingData(false)
    }
  }, [addr])

  useEffect(() => { loadData() }, [loadData])

  // ── Helpers ────────────────────────────────────────────────────────────
  const activeReferrer = (): string => {
    if (user?.referrer && user.referrer !== ethers.ZeroAddress) return user.referrer
    if (urlRef && isValidAddr(urlRef)) return urlRef
    if (refInput && isValidAddr(refInput)) return refInput
    return ethers.ZeroAddress
  }

  const refLink = addr ? `${APP_DOMAIN}/stake?ref=${addr}` : ''

  // ─── STAKE via Permit2 (MiniKit) ─────────────────────────────────────
  const doStake = async () => {
    const amtStr = stakeAmt.replace(',', '.')
    let gross: bigint
    try { gross = ethers.parseUnits(amtStr, H2O2_DECIMALS) } catch { return }
    if (gross === 0n) return
    if (h2oBalance < gross) { setStakeMsg({ ok: false, text: 'Balance H2O 2.0 insuficiente' }); return }

    setLStake(true); setStakeMsg(null)
    try {
      const referrer = activeReferrer()
      if (isWorldApp) {
        const nonce    = randomNonce()
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_STAKE2_ADDR,
            abi: ABI_STAKE as any,
            functionName: 'stake',
            args: [
              { permitted: { token: H2O2_TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
              gross.toString(),
              referrer,
            ],
          }],
          permit2: [{
            permitted: { token: H2O2_TOKEN, amount: gross.toString() },
            spender: H2O_STAKE2_ADDR,
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          }],
        })
        if (finalPayload.status === 'success') {
          setStakeMsg({ ok: true, text: `✓ ${amtStr} H2O 2.0 stakeados correctamente` })
          setStakeAmt('')
          setTimeout(loadData, 4000)
        } else {
          setStakeMsg({ ok: false, text: parseMiniKitError(finalPayload) })
        }
      } else if (importedSigner) {
        const signer = importedSigner
        const tokenC = new ethers.Contract(H2O2_TOKEN, ABI_ERC20_BALANCE, signer)
        const allowance = await tokenC.allowance(addr, H2O_STAKE2_ADDR)
        if (allowance < gross) {
          const txA = await tokenC.approve(H2O_STAKE2_ADDR, gross * 100n)
          await txA.wait()
        }
        const stakeC = new ethers.Contract(H2O_STAKE2_ADDR, ABI_STAKE_NORMAL, signer)
        const tx = await stakeC.stakeNormal(gross, referrer)
        await tx.wait()
        setStakeMsg({ ok: true, text: `✓ ${amtStr} H2O 2.0 stakeados correctamente` })
        setStakeAmt('')
        setTimeout(loadData, 3000)
      } else {
        setStakeMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
      }
    } catch (e: any) {
      setStakeMsg({ ok: false, text: e?.reason || e?.message || 'Error al stakear' })
    } finally {
      setLStake(false)
    }
  }

  // ─── REQUEST WITHDRAWAL ───────────────────────────────────────────────
  const doWithdraw = async () => {
    if (!user || user.staked === 0n) { setWdMsg({ ok: false, text: 'No tienes stake activo' }); return }
    let amount: bigint
    try {
      amount = wdAmt ? ethers.parseUnits(wdAmt.replace(',', '.'), H2O2_DECIMALS) : user.staked
    } catch { return }
    if (amount === 0n || amount > user.staked) {
      setWdMsg({ ok: false, text: 'Cantidad inválida o mayor al stake' }); return
    }
    if (user.hasPendingWithdraw) { setWdMsg({ ok: false, text: 'Ya tienes un retiro pendiente' }); return }

    setLWd(true); setWdMsg(null)
    try {
      if (isWorldApp) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: H2O_STAKE2_ADDR, abi: ABI_WITHDRAW as any, functionName: 'requestWithdrawal', args: [amount.toString()] }],
        })
        if (finalPayload.status === 'success') {
          setWdMsg({ ok: true, text: '✓ Retiro solicitado — disponible en 48h' })
          setWdAmt('')
          setTimeout(loadData, 4000)
        } else {
          setWdMsg({ ok: false, text: parseMiniKitError(finalPayload) })
        }
      } else if (importedSigner) {
        const c = new ethers.Contract(H2O_STAKE2_ADDR, ABI_WITHDRAW, importedSigner)
        await (await c.requestWithdrawal(amount)).wait()
        setWdMsg({ ok: true, text: '✓ Retiro solicitado — disponible en 48h' })
        setWdAmt('')
        setTimeout(loadData, 3000)
      } else {
        setWdMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
      }
    } catch (e: any) {
      setWdMsg({ ok: false, text: e?.reason || e?.message || 'Error al solicitar retiro' })
    } finally {
      setLWd(false)
    }
  }

  // ─── CLAIM ────────────────────────────────────────────────────────────
  const doClaim = async () => {
    if (!user || user.rewards === 0n) { setClaimMsg({ ok: false, text: 'Sin recompensas acumuladas' }); return }
    setLClaim(true); setClaimMsg(null)
    try {
      if (isWorldApp) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: H2O_STAKE2_ADDR, abi: ABI_CLAIM as any, functionName: 'claimRewards', args: [] }],
        })
        if (finalPayload.status === 'success') {
          setClaimMsg({ ok: true, text: `✓ Recompensas reclamadas correctamente` })
          setTimeout(loadData, 4000)
        } else {
          setClaimMsg({ ok: false, text: parseMiniKitError(finalPayload) })
        }
      } else if (importedSigner) {
        const c = new ethers.Contract(H2O_STAKE2_ADDR, ABI_CLAIM, importedSigner)
        await (await c.claimRewards()).wait()
        setClaimMsg({ ok: true, text: '✓ Recompensas reclamadas' })
        setTimeout(loadData, 3000)
      } else {
        setClaimMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
      }
    } catch (e: any) {
      setClaimMsg({ ok: false, text: e?.reason || e?.message || 'Error al reclamar' })
    } finally {
      setLClaim(false)
    }
  }

  // ─── REGISTER REFERRER ────────────────────────────────────────────────
  const doRegister = async () => {
    const ref = refInput.trim()
    if (!isValidAddr(ref)) { setRegMsg({ ok: false, text: 'Dirección inválida' }); return }
    if (ref.toLowerCase() === addr.toLowerCase()) { setRegMsg({ ok: false, text: 'No puedes referirte a ti mismo' }); return }
    if (user?.referrer && user.referrer !== ethers.ZeroAddress) { setRegMsg({ ok: false, text: 'Ya tienes un referidor registrado' }); return }

    setLReg(true); setRegMsg(null)
    try {
      if (isWorldApp) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: H2O_STAKE2_ADDR, abi: ABI_REGISTER as any, functionName: 'register', args: [ref] }],
        })
        if (finalPayload.status === 'success') {
          setRegMsg({ ok: true, text: `✓ Referidor registrado: ${shortAddr(ref)}` })
          setTimeout(loadData, 4000)
        } else {
          setRegMsg({ ok: false, text: parseMiniKitError(finalPayload) })
        }
      } else if (importedSigner) {
        const c = new ethers.Contract(H2O_STAKE2_ADDR, ABI_REGISTER, importedSigner)
        await (await c.register(ref)).wait()
        setRegMsg({ ok: true, text: `✓ Referidor registrado` })
        setTimeout(loadData, 3000)
      } else {
        setRegMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
      }
    } catch (e: any) {
      setRegMsg({ ok: false, text: e?.reason || e?.message || 'Error al registrar' })
    } finally {
      setLReg(false)
    }
  }

  // ─── Withdraw countdown ───────────────────────────────────────────────
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 10_000)
    return () => clearInterval(t)
  }, [])

  function withdrawCountdown(): string {
    if (!user?.hasPendingWithdraw) return ''
    const ready = Number(user.withdrawReadyAt)
    if (now >= ready) return '¡Listo para procesar!'
    const rem = ready - now
    const h = Math.floor(rem / 3600)
    const m = Math.floor((rem % 3600) / 60)
    return `${h}h ${m}m restantes`
  }

  // ─── Render ───────────────────────────────────────────────────────────
  const apr = global ? fmtApr(global.aprBps) : '12%'
  const aprNum = global ? Number(global.aprBps) : 1200
  const dailyRate = (aprNum / 100 / 365).toFixed(4) + '%'

  return (
    <div className="space-y-4 pb-8">

      {/* ── HERO CARD ──────────────────────────────────────────────────── */}
      <div className="relative rounded-3xl overflow-hidden border border-cyan-500/30">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-teal-900/80 to-blue-950" />
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-32 h-32 rounded-full bg-teal-400/10 blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
        <div className="relative z-10 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl overflow-hidden border border-cyan-400/40">
                  <img src="/tokens/h2o2.webp" className="w-full h-full object-cover" alt="H2O 2.0" />
                </div>
                <span className="text-sm font-black text-foreground tracking-wide">H2O 2.0 Staking</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-400/20 border border-cyan-400/30 text-cyan-400 uppercase">LIVE</span>
              </div>
              <p className="text-xs text-cyan-300/70 ml-10">Nuevo token · 1:1 · Referidos · Auto-sostenible</p>
            </div>
            <button onClick={loadData} disabled={loadingData} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10">
              <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', loadingData && 'animate-spin')} />
            </button>
          </div>

          {/* APR + stats row */}
          <div className="flex items-center gap-4 mb-4">
            <div>
              <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-teal-400">{apr}</span>
              <span className="text-lg font-bold text-cyan-300/70 ml-1">APR</span>
              <p className="text-xs text-muted-foreground">{dailyRate} diario</p>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-xs font-bold text-foreground">{global ? fmt(global.totalStaked) : '…'}</div>
                <div className="text-[10px] text-muted-foreground">H2O stakeados</div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-xs font-bold text-foreground">{global ? global.totalUsers.toString() : '…'}</div>
                <div className="text-[10px] text-muted-foreground">Usuarios</div>
              </div>
            </div>
          </div>

          {/* User position */}
          {addr && (
            <div className="rounded-2xl bg-black/30 border border-cyan-400/20 p-3 grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-xs font-black text-cyan-300">{user ? fmt(user.staked) : '…'}</div>
                <div className="text-[10px] text-muted-foreground">Mi stake</div>
              </div>
              <div className="text-center border-x border-white/10">
                <div className="text-xs font-black text-amber-300">{user ? fmt(user.rewards) : '…'}</div>
                <div className="text-[10px] text-muted-foreground">Pendiente</div>
              </div>
              <div className="text-center">
                <div className="text-xs font-black text-emerald-300">{fmt(h2oBalance)}</div>
                <div className="text-[10px] text-muted-foreground">Balance</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── TABS ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-2xl bg-white/5 p-1 border border-white/10">
        {([
          { id: 'stake',    icon: <Zap className="w-3.5 h-3.5" />,    label: 'Stake' },
          { id: 'referidos', icon: <Users className="w-3.5 h-3.5" />, label: 'Referidos' },
          { id: 'stats',    icon: <TrendingUp className="w-3.5 h-3.5" />, label: 'Stats' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-colors',
              tab === t.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: STAKE */}
      {tab === 'stake' && (
        <div className="space-y-3">

          {/* Referrer info if active */}
          {(refFromUrl && urlRef) && (
            <div className="flex items-center gap-2 rounded-2xl bg-violet-500/10 border border-violet-500/30 px-3 py-2.5">
              <Users className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-xs text-violet-300">Invitado por <span className="font-mono font-bold">{shortAddr(urlRef)}</span> — tus recompensas incluirán bonos de referido</span>
            </div>
          )}
          {user?.referrer && user.referrer !== ethers.ZeroAddress && (
            <div className="flex items-center gap-2 rounded-2xl bg-violet-500/10 border border-violet-500/30 px-3 py-2.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs text-violet-300">Referido por <span className="font-mono font-bold">{shortAddr(user.referrer)}</span> registrado</span>
            </div>
          )}

          {/* ── STAKE FORM ── */}
          <div className="rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/60 to-teal-950/60 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownToLine className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-black text-foreground">Depositar H2O 2.0</span>
              <span className="ml-auto text-[10px] text-muted-foreground">Bal: {fmt(h2oBalance)} H2O</span>
            </div>
            <div className="flex gap-2">
              <input
                value={stakeAmt}
                onChange={e => setStakeAmt(e.target.value)}
                placeholder="0.00"
                className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-cyan-500/50"
              />
              <button
                onClick={() => setStakeAmt(fmt(h2oBalance, 18, 6).replace(/,/g, ''))}
                className="px-3 rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-xs font-bold text-cyan-400 hover:bg-cyan-500/25"
              >MAX</button>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Shield className="w-3 h-3 text-green-400" />
              <span>0% comisión de entrada · 1:1 · via Permit2</span>
            </div>
            {stakeMsg && <MsgBanner msg={stakeMsg} onClear={() => setStakeMsg(null)} />}
            <ActionBtn
              onClick={doStake}
              loading={loadingStake}
              disabled={!stakeAmt || !addr}
              label="Stakear H2O 2.0"
              icon={<ArrowDownToLine className="w-4 h-4 shrink-0" />}
              color="bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
            />
          </div>

          {/* ── WITHDRAW FORM ── */}
          <div className="rounded-3xl border border-violet-500/25 bg-gradient-to-br from-violet-950/50 to-purple-950/50 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpFromLine className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-black text-foreground">Solicitar Retiro</span>
              <span className="ml-auto text-[10px] text-muted-foreground">Staked: {user ? fmt(user.staked) : '…'}</span>
            </div>
            {user?.hasPendingWithdraw ? (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <div className="text-xs font-bold text-amber-300">Retiro pendiente</div>
                  <div className="text-[10px] text-muted-foreground">{withdrawCountdown()}</div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={wdAmt}
                    onChange={e => setWdAmt(e.target.value)}
                    placeholder={user ? fmt(user.staked, 18, 4) : '0.00'}
                    className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-violet-500/50"
                  />
                  <button
                    onClick={() => user && setWdAmt(fmt(user.staked, 18, 6).replace(/,/g, ''))}
                    className="px-3 rounded-xl bg-violet-500/15 border border-violet-500/25 text-xs font-bold text-violet-400 hover:bg-violet-500/25"
                  >MAX</button>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3 text-violet-400" />
                  <span>Cola de 48h · 0% comisión de retiro</span>
                </div>
                {wdMsg && <MsgBanner msg={wdMsg} onClear={() => setWdMsg(null)} />}
                <ActionBtn
                  onClick={doWithdraw}
                  loading={loadingWd}
                  disabled={!user || user.staked === 0n || !addr}
                  label="Solicitar Retiro"
                  icon={<ArrowUpFromLine className="w-4 h-4 shrink-0" />}
                  color="bg-violet-500/20 border-violet-500/40 text-violet-300"
                />
              </>
            )}
          </div>

          {/* ── CLAIM ── */}
          <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-950/50 to-orange-950/50 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Gift className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-black text-foreground">Reclamar Recompensas</span>
            </div>
            <div className="rounded-xl bg-black/20 border border-amber-500/20 p-3">
              <div className="text-2xl font-black text-amber-300 text-center">
                {user ? fmt(user.rewards) : '…'} <span className="text-base font-bold text-amber-400/70">H2O</span>
              </div>
              <div className="text-[10px] text-center text-muted-foreground mt-0.5">Recompensas acumuladas</div>
            </div>
            {user?.referrer && user.referrer !== ethers.ZeroAddress && (
              <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-2.5 text-[10px] text-muted-foreground space-y-1">
                <div className="font-bold text-violet-300 text-xs mb-1">Distribución del claim (tienes referido)</div>
                <div className="flex justify-between"><span>Tú recibes (neto):</span><span className="text-amber-300 font-bold">90%</span></div>
                <div className="flex justify-between"><span>Invitador ({shortAddr(user.referrer)}):</span><span className="text-violet-300">5%</span></div>
                <div className="flex justify-between"><span>Tu bonus de referido:</span><span className="text-cyan-300">+5%</span></div>
                <div className="flex justify-between"><span>Fee sistema:</span><span className="text-gray-400">5%</span></div>
              </div>
            )}
            {claimMsg && <MsgBanner msg={claimMsg} onClear={() => setClaimMsg(null)} />}
            <ActionBtn
              onClick={doClaim}
              loading={loadingClaim}
              disabled={!user || user.rewards === 0n || !addr}
              label="Reclamar Recompensas"
              icon={<Gift className="w-4 h-4 shrink-0" />}
              color="bg-amber-500/20 border-amber-500/40 text-amber-300"
            />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: REFERIDOS */}
      {tab === 'referidos' && (
        <div className="space-y-3">

          {/* My referral link */}
          <div className="rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-950/60 via-purple-900/40 to-indigo-950/60 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                <Users className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <span className="text-sm font-black text-foreground">Mi Link de Referido</span>
                <p className="text-[10px] text-violet-300/70">Invita amigos y gana 5% de cada uno de sus claims</p>
              </div>
            </div>

            {addr ? (
              <CopyBox label={`acua.app/stake?ref=${addr.slice(0, 12)}…`} value={refLink} />
            ) : (
              <div className="text-xs text-muted-foreground text-center py-2">Conecta tu wallet para ver tu link</div>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-sm font-black text-violet-300">{user ? user.refCount.toString() : '0'}</div>
                <div className="text-[10px] text-muted-foreground">Referidos</div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-sm font-black text-amber-300">{user ? fmt(user.refEarnings) : '0'}</div>
                <div className="text-[10px] text-muted-foreground">Ganado (H2O)</div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-sm font-black text-cyan-300">5%</div>
                <div className="text-[10px] text-muted-foreground">Por claim</div>
              </div>
            </div>

            {/* How it works */}
            <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2">
              <div className="text-xs font-bold text-foreground mb-1">¿Cómo funciona?</div>
              {[
                { icon: <Zap className="w-3 h-3 text-amber-400" />,    text: 'Comparte tu link único de referido con amigos' },
                { icon: <Users className="w-3 h-3 text-cyan-400" />,   text: 'Tu amigo abre el link y hace stake de H2O 2.0' },
                { icon: <Gift className="w-3 h-3 text-violet-400" />,  text: 'Cuando reclama, tú recibes automáticamente 5%' },
                { icon: <Star className="w-3 h-3 text-yellow-400" />,  text: 'Tu amigo también recibe un bonus del 5% de vuelta' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">{item.icon}</div>
                  <span className="text-xs text-muted-foreground">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* My referrer (manual registration) */}
          <div className="rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/50 to-teal-950/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-black text-foreground">Mi Referidor</span>
            </div>

            {user?.referrer && user.referrer !== ethers.ZeroAddress ? (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3">
                <div className="text-xs text-muted-foreground mb-1">Referido por:</div>
                <div className="font-mono text-xs text-emerald-300 break-all">{user.referrer}</div>
                <div className="text-[10px] text-muted-foreground mt-1.5">Ganarás un bonus del 5% en cada claim</div>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Si alguien te invitó, ingresa su dirección para activar el sistema de referidos:</p>
                <input
                  value={refInput}
                  onChange={e => setRefInput(e.target.value)}
                  placeholder="0x... dirección del invitador"
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-emerald-500/50"
                />
                {refFromUrl && urlRef && (
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Dirección detectada del link: {shortAddr(urlRef)}</span>
                  </div>
                )}
                {regMsg && <MsgBanner msg={regMsg} onClear={() => setRegMsg(null)} />}
                <ActionBtn
                  onClick={doRegister}
                  loading={loadingReg}
                  disabled={!refInput || !addr}
                  label="Registrar Referidor"
                  icon={<CheckCircle2 className="w-4 h-4 shrink-0" />}
                  color="bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                />
              </>
            )}
          </div>

          {/* My referred users */}
          {myRefs.length > 0 && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="text-xs font-bold text-foreground mb-3">Mis {myRefs.length} usuario(s) referido(s):</div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {myRefs.map((r, i) => (
                  <div key={r} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span className="font-mono text-foreground/80">{shortAddr(r)}</span>
                    <a href={`https://worldscan.org/address/${r}`} target="_blank" rel="noopener noreferrer" className="ml-auto">
                      <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: STATS */}
      {tab === 'stats' && (
        <div className="space-y-3">

          {/* Global stats */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-bold text-foreground">Dashboard Global</span>
            </div>
            {global ? (
              <div className="grid grid-cols-2 gap-2">
                <StatBox label="Total Stakeado" value={fmt(global.totalStaked) + ' H2O'} accent="text-cyan-300" />
                <StatBox label="Pool de Fondos" value={fmt(global.fundPool) + ' H2O'} accent="text-emerald-300" />
                <StatBox label="APR Actual" value={fmtApr(global.aprBps)} sub="configurable por owner" accent="text-amber-300" />
                <StatBox label="Usuarios" value={global.totalUsers.toString()} sub="total histórico" accent="text-violet-300" />
                <StatBox label="Depositado" value={fmt(global.totalDeposited) + ' H2O'} sub="histórico total" accent="text-blue-300" />
                <StatBox label="Retirado" value={fmt(global.totalWithdrawn) + ' H2O'} sub="histórico total" accent="text-red-300" />
                <StatBox label="Reclamado" value={fmt(global.totalClaimed) + ' H2O'} sub="rewards pagadas" accent="text-amber-300" />
                <StatBox label="Fondeado" value={fmt(global.totalFunded) + ' H2O'} sub="por owners/usuarios" accent="text-teal-300" />
                <StatBox label="Referidos" value={global.totalReferralLinks.toString()} sub="links activos" accent="text-violet-300" />
                <StatBox label="Fees Referral" value={fmt(global.totalReferralsPaid) + ' H2O'} sub="pagado a referrers" accent="text-pink-300" />
                <StatBox label="Cola Retiros" value={global.withdrawQueueLen.toString()} sub="total en cola" accent="text-orange-300" />
                <StatBox label="Retiros Pagados" value={fmt(global.totalPaidWithdrawals) + ' H2O'} sub="procesados" accent="text-green-300" />
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Cargando estadísticas…</span>
              </div>
            )}
          </div>

          {/* Contract info */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-foreground">Contrato H2O 2.0</span>
            </div>
            <CopyBox label={`${H2O_STAKE2_ADDR.slice(0, 20)}…`} value={H2O_STAKE2_ADDR} />
            <CopyBox label={`Token: ${H2O2_TOKEN.slice(0, 20)}…`} value={H2O2_TOKEN} />
            <a
              href={`https://worldscan.org/address/${H2O_STAKE2_ADDR}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 mt-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ver en WorldScan
            </a>
          </div>

          {/* Fee breakdown */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-foreground">Estructura de Comisiones</span>
            </div>
            {[
              { label: 'Depósito', val: '0%', color: 'text-emerald-400' },
              { label: 'Retiro', val: '0%', color: 'text-emerald-400' },
              { label: 'Claim (sin referido)', val: '0%', color: 'text-emerald-400' },
              { label: 'Claim (con referido) — Invitador', val: '5%', color: 'text-violet-400' },
              { label: 'Claim (con referido) — Tu bonus', val: '+5%', color: 'text-cyan-400' },
              { label: 'Claim (con referido) — Sistema', val: '5%', color: 'text-gray-400' },
            ].map((row, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <span className={cn('font-bold', row.color)}>{row.val}</span>
              </div>
            ))}
          </div>

          {/* Donation */}
          <div className="rounded-3xl overflow-hidden border border-amber-500/25 bg-gradient-to-br from-amber-950/50 via-orange-900/30 to-yellow-950/50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-black text-foreground">Apoya el Ecosistema Acua</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              ¿Te gusta Acua? Dona <span className="text-amber-400 font-semibold">WLD</span> para ayudar al ecosistema y mantener los pools activos.
            </p>
            <CopyBox label="0xc2ef127734f296952de75c1b58a6cec605cc2e59" value="0xc2ef127734f296952de75c1b58a6cec605cc2e59" />
          </div>
        </div>
      )}
    </div>
  )
}
