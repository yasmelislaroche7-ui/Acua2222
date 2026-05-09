'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  TrendingUp, Clock, RefreshCw, Loader2, ChevronDown, AlertCircle,
  Wallet, Crown, ExternalLink, Info, Users, Gift, Zap, Lock,
  CheckCircle2, ArrowRight, Flame, XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLang } from '@/context/lang-context'
import { t } from '@/lib/i18n'
import {
  SUSHI_BNB_CONTRACT, SUSHI_BNB_TOKEN, BNB_RPC, BNB_USD_APPROX,
  SUSHI_BNB_ABI, ERC20_ABI, MEMBERSHIP_TIERS,
} from '@/lib/sushibnb-abi'
import {
  WLD_CONTRACT, WLD_TOKEN,
  WLD_STAKE_ABI, WLD_WITHDRAW_ABI, WLD_CLAIM_ABI, WLD_FUND_ABI, WLD_TRIGGER_ABI,
  fetchUserWldInfo, fetchGlobalWldStats,
  fmtWld, fmtWldShort,
  type UserWldInfo, type GlobalWldStats,
} from '@/lib/wld-stake-v2'
import { randomNonce } from '@/lib/new-contracts'
import type { WalletMode } from '@/lib/tx-signer'

// ─── MiniKit JSON ABIs (for BNB Chain signing via World Wallet) ───────────────
const MK_APPROVE     = [{ name: 'approve',            type: 'function', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }]
const MK_DEPOSIT     = [{ name: 'deposit',            type: 'function', inputs: [{ name: 'amount',  type: 'uint256' }], outputs: [] }]
const MK_WITHDRAW    = [{ name: 'withdraw',           type: 'function', inputs: [], outputs: [] }]
const MK_CLAIM       = [{ name: 'claimRewards',       type: 'function', inputs: [], outputs: [] }]
const MK_COOK        = [{ name: 'cook',               type: 'function', inputs: [{ name: 'duration', type: 'uint256' }], outputs: [] }]
const MK_SUBSCRIBE   = [{ name: 'subscribeMembership',type: 'function', stateMutability: 'payable', inputs: [{ name: 'tier', type: 'uint256' }], outputs: [] }]
const MK_APPLY_REF   = [{ name: 'applyReferral',      type: 'function', inputs: [{ name: 'code', type: 'string' }], outputs: [] }]
const MK_CREATE_CODE = [{ name: 'createReferralCode', type: 'function', inputs: [{ name: 'code', type: 'string' }], outputs: [] }]

// ─── Constants ────────────────────────────────────────────────────────────────
const SUSHI_COLOR = '#e84142'
const BNB_COLOR   = '#f0b90b'
// ─── Gas reality on BSC ───────────────────────────────────────────────────────
// BSC hard minimum gas price = 1 gwei (1,000,000,000 wei) since Tycho hard fork
// Feb 2024.  Anything below 1 gwei is rejected by all validators — it is a
// protocol rule, not configurable.  0.05–0.09 gwei or costs < 0.00002 BNB per
// smart-contract call are NOT achievable on BSC.
// Minimum costs at 1 gwei:
//   ERC20 approve (~46k gas)  → 0.000046 BNB ≈ $0.028
//   SUSHI deposit (~100k gas) → 0.0001  BNB ≈ $0.060
//   Full stake (approve+dep)  → 0.00015 BNB ≈ $0.090
const GAS_PRICE_GWEI   = 1n
const GAS_PRICE_WEI    = GAS_PRICE_GWEI * 1_000_000_000n  // 1e9 wei = 1 gwei
const GAS_LIMITS = {
  approve:           50_000n,   // ERC20 approve  ~44-47k
  deposit:          110_000n,   // SUSHI deposit  ~95-105k
  withdraw:          90_000n,   // withdraw all   ~75-85k
  claimRewards:      70_000n,   // claimRewards   ~60-65k
  cook:              65_000n,   // cook           ~55-60k
  subscribeMember:  100_000n,   // payable member ~80-95k
  referral:          65_000n,   // referral       ~55-60k
} as const
// Cheapest realistic single TX at 1 gwei (claim / cook / withdraw)
const GAS_ESTIMATE_BNB = 0.000070   // ~70k gas × 1 gwei = 0.000070 BNB
const GAS_ESTIMATE_STAKE = 0.000150 // approve + deposit = ~150k gas total
const BSCSCAN = 'https://bscscan.com/tx/'

// ─── Types ────────────────────────────────────────────────────────────────────
interface StakeInfo {
  staked:          bigint
  pendingRewards:  bigint
  cookingRewards:  bigint
  lastActionTs:    number
  membership:      number
  membershipExpires: number
  streakBps:       number
  sushiBal:        bigint
  bnbBal:          bigint
}

// Multi-step TX status
interface TxStep {
  step:    number
  total:   number
  label:   string
  hash?:   string
  done?:   boolean
  error?:  string
}

// TX history record
interface TxRecord {
  id:     string
  op:     string
  hashes: string[]
  ts:     number
}

const HISTORY_KEY = 'acua_bnb_tx_history_v1'
function loadHistory(): TxRecord[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(recs: TxRecord[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(recs.slice(0, 50))) } catch { /* ignore */ }
}

// ─── Cook options ─────────────────────────────────────────────────────────────
const COOK_OPTIONS = [
  { label: '15 min',    seconds: 900,   minTier: 0 },
  { label: '45 min',    seconds: 2700,  minTier: 1 },
  { label: '3 horas',   seconds: 10800, minTier: 2 },
  { label: '24 horas',  seconds: 86400, minTier: 2 },
  { label: '48 horas',  seconds: 172800,minTier: 3 },
]

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtSushi(v: bigint, dec = 4): string {
  const n = parseFloat(ethers.formatEther(v))
  if (n === 0) return '0.0000'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1000)      return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n.toFixed(dec)
}
function fmtBNB(v: bigint): string { return parseFloat(ethers.formatEther(v)).toFixed(4) }
function countdown(until: number): string {
  const diff = until - Math.floor(Date.now() / 1000)
  if (diff <= 0) return 'Listo ✓'
  const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60
  if (h > 0) return `${h}h ${m}m restantes`
  if (m > 0) return `${m}m ${s}s restantes`
  return `${s}s restantes`
}
function gasCostUSD(): string {
  return (GAS_ESTIMATE_BNB * BNB_USD_APPROX).toFixed(2)
}

// ─── Badge de membresía ───────────────────────────────────────────────────────
function MembershipBadge({ tier }: { tier: number }) {
  const meta  = MEMBERSHIP_TIERS[tier] ?? MEMBERSHIP_TIERS[0]
  const icons = ['', '🥈', '🥇', '💎']
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border"
      style={{ color: meta.color, borderColor: `${meta.color}50`, background: `${meta.color}15` }}>
      {icons[tier]} {meta.name}
    </span>
  )
}

// ─── TX Modal de confirmación ─────────────────────────────────────────────────
function TxConfirmModal({
  title, detail, gasNote, onConfirm, onCancel, confirming,
}: {
  title:      string
  detail:     string
  gasNote:    string
  onConfirm:  () => void
  onCancel:   () => void
  confirming: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm px-3 pb-6">
      <div className="w-full max-w-sm rounded-2xl border border-[oklch(0.25_0.03_245)] bg-[oklch(0.09_0.018_245)] overflow-hidden shadow-2xl">
        <div className="px-4 pt-4 pb-1">
          <p className="text-xs font-black text-foreground">{title}</p>
          <p className="text-[10px] text-[oklch(0.50_0.012_230)] mt-1 leading-relaxed">{detail}</p>
        </div>
        <div className="mx-4 mt-3 rounded-xl bg-[#f0b90b]/8 border border-[#f0b90b]/20 px-3 py-2 flex items-center gap-2">
          <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={14} height={14} className="rounded-full" unoptimized />
          <p className="text-[9px] text-[#f0b90b]">
            Gas BNB Chain: <strong>~{GAS_ESTIMATE_BNB} BNB</strong> ≈ <strong>${gasCostUSD()} USD</strong>
          </p>
        </div>
        {gasNote && (
          <div className="mx-4 mt-2 rounded-xl bg-blue-500/8 border border-blue-500/20 px-3 py-1.5">
            <p className="text-[8px] text-blue-300 leading-relaxed">{gasNote}</p>
          </div>
        )}
        <div className="p-4 flex gap-2">
          <button onClick={onCancel} disabled={confirming}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold border border-[oklch(0.22_0.025_245)] text-[oklch(0.55_0.01_230)] hover:bg-white/5 transition-colors disabled:opacity-40">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={confirming}
            className="flex-1 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white' }}>
            {confirming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TX Progress indicator ────────────────────────────────────────────────────
function TxProgress({ step }: { step: TxStep | null }) {
  if (!step) return null
  const isError = !!step.error
  const isDone  = !!step.done
  return (
    <div className={cn(
      'rounded-xl border px-3 py-2.5 space-y-2',
      isError ? 'border-red-500/30 bg-red-500/8'
      : isDone ? 'border-emerald-500/30 bg-emerald-500/8'
      : 'border-blue-500/30 bg-blue-500/8'
    )}>
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {isError  ? <XCircle className="w-4 h-4 text-red-400 shrink-0" />
         : isDone  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
         : <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />}
        <p className={cn(
          'text-[10px] font-bold leading-snug',
          isError ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-blue-300'
        )}>{step.label}</p>
        {step.total > 1 && !isError && (
          <span className="ml-auto text-[8px] font-bold text-[oklch(0.40_0.01_230)] shrink-0">
            {step.step}/{step.total}
          </span>
        )}
      </div>
      {/* Step progress bar */}
      {step.total > 1 && !isError && (
        <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${(step.step / step.total) * 100}%`,
              background: isDone ? '#10b981' : '#3b82f6',
            }} />
        </div>
      )}
      {/* TX hash */}
      {step.hash && (
        <a href={`${BSCSCAN}${step.hash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[8px] font-mono text-[oklch(0.50_0.012_230)] hover:text-blue-400 transition-colors">
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          TX: {step.hash.slice(0, 14)}…{step.hash.slice(-6)}
        </a>
      )}
      {/* Error message */}
      {step.error && (
        <p className="text-[9px] text-red-300 leading-relaxed">{step.error}</p>
      )}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface BNBSushiPanelProps {
  bnbAddress:    string | null
  bnbPrivateKey?: string | null
  walletMode?:   WalletMode
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export function BNBSushiPanel({ bnbAddress, bnbPrivateKey, walletMode }: BNBSushiPanelProps) {
  const { lang } = useLang()

  // ─── Panel switcher (SUSHI BNB | WLD World Chain) ────────────────────────
  const [activePanel, setActivePanel] = useState<'sushi' | 'wld'>('sushi')

  // ─── SUSHI (BNB Chain) state ──────────────────────────────────────────────
  const [info, setInfo]           = useState<StakeInfo | null>(null)
  const [totalStaked, setTotalStaked] = useState<bigint | null>(null)
  const [loading, setLoading]     = useState(false)
  const [activeView, setActiveView] = useState<'stake' | 'membership' | 'referral' | 'history'>('stake')

  // Inputs
  const [depositAmt, setDepositAmt]   = useState('')
  const [cookOption, setCookOption]   = useState(0)
  const [showCookDrop, setShowCookDrop] = useState(false)
  const [referralCode, setReferralCode] = useState('')

  // TX flow
  const [txStep, setTxStep]       = useState<TxStep | null>(null)
  const [txPending, setTxPending] = useState(false)
  const [confirm, setConfirm]     = useState<null | {
    title: string; detail: string; gasNote: string; onConfirm: () => Promise<void>
  }>(null)
  const [confirming, setConfirming] = useState(false)

  // TX history
  const [txHistory, setTxHistory] = useState<TxRecord[]>([])
  useEffect(() => { setTxHistory(loadHistory()) }, [])

  // ─── WLD (World Chain) state ──────────────────────────────────────────────
  const [wldUser, setWldUser]       = useState<UserWldInfo | null>(null)
  const [wldGlobal, setWldGlobal]   = useState<GlobalWldStats | null>(null)
  const [wldPaidWd, setWldPaidWd]   = useState<bigint>(BigInt(0))
  const [wldPaidCl, setWldPaidCl]   = useState<bigint>(BigInt(0))
  const [wldLoading, setWldLoading] = useState(false)
  const [wldStakeAmt, setWldStakeAmt] = useState('')
  const [wldWdAmt, setWldWdAmt]       = useState('')
  const [wldFundAmt, setWldFundAmt]   = useState('')
  const [wldTxStep, setWldTxStep]   = useState<TxStep | null>(null)
  const [wldTxPending, setWldTxPending] = useState(false)

  // ─── WLD owner addresses ──────────────────────────────────────────────────
  const WLD_OWNER  = '0x5474c309e985c6b4fc623acf01ade604da781e52'
  const WLD_OWNER2 = '0x5474c309e985c6b4fc623acf01ade604da781e52'
  const isWldOwner = !!(wldAddr && (
    wldAddr.toLowerCase() === WLD_OWNER.toLowerCase() ||
    wldAddr.toLowerCase() === WLD_OWNER2.toLowerCase()
  ))

  // ─── Load user info ──────────────────────────────────────────────────────────
  const load = useCallback(async (addr: string) => {
    setLoading(true)
    try {
      const provider = new ethers.JsonRpcProvider(BNB_RPC)
      const contract   = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, provider)
      const sushiToken = new ethers.Contract(SUSHI_BNB_TOKEN, ERC20_ABI, provider)

      const [uInfo, bnbBal, sushiBal, totalSt] = await Promise.allSettled([
        contract.getUserInfo(addr),
        provider.getBalance(addr),
        sushiToken.balanceOf(addr),
        contract.totalStaked() as Promise<bigint>,
      ])
      if (totalSt.status === 'fulfilled') setTotalStaked(BigInt(totalSt.value))

      const ui = uInfo.status === 'fulfilled' ? uInfo.value : null
      const bb = bnbBal.status === 'fulfilled'   ? bnbBal.value   : BigInt(0)
      const sb = sushiBal.status === 'fulfilled' ? sushiBal.value : BigInt(0)

      // Try membership/streak (unverified — graceful fallback)
      let membership = 0, membershipExpires = 0, streakBps = 10000
      try {
        const mb = await contract.getMembership(addr)
        membership        = Number(mb[0])
        membershipExpires = Number(mb[1])
      } catch { /* not supported */ }
      try {
        const sk = await contract.getStreakMultiplier(addr)
        streakBps = Number(sk)
      } catch { /* not supported */ }

      setInfo({
        staked:           ui ? BigInt(ui[0]) : BigInt(0),
        pendingRewards:   ui ? BigInt(ui[1]) : BigInt(0),
        cookingRewards:   ui ? BigInt(ui[2]) : BigInt(0),
        lastActionTs:     ui ? Number(ui[3]) : 0,
        membership,
        membershipExpires,
        streakBps,
        sushiBal:         BigInt(sb),
        bnbBal:           BigInt(bb),
      })
    } catch (e) {
      console.error('[BNBSushi] load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (bnbAddress) load(bnbAddress) }, [bnbAddress, load])

  // ─── WLD (World Chain) load ───────────────────────────────────────────────
  const wldAddr = walletMode === 'minikit' ? bnbAddress : null

  const loadWLD = useCallback(async (addr: string) => {
    setWldLoading(true)
    try {
      const [user, global] = await Promise.allSettled([
        fetchUserWldInfo(addr),
        fetchGlobalWldStats(),
      ])
      if (user.status   === 'fulfilled') setWldUser(user.value)
      if (global.status === 'fulfilled') {
        setWldGlobal(global.value)
        // totalPaidWithdrawals / totalPaidClaims are part of global
        // (not returned by getGlobalStats — read separately if needed)
      }
    } catch (e) { console.error('[WLDStake] load error', e) }
    finally { setWldLoading(false) }
  }, [])

  useEffect(() => { if (wldAddr) loadWLD(wldAddr) }, [wldAddr, loadWLD])

  // ─── WLD tx runner (MiniKit, World Chain) ─────────────────────────────────
  const runWldTx = async (label: string, fn: () => Promise<any>) => {
    setWldTxPending(true)
    setWldTxStep({ step: 1, total: 1, label })
    try {
      const finalPayload = await fn()
      if (finalPayload?.status === 'success') {
        setWldTxStep({ step: 1, total: 1, label: `✓ ${label.replace('…', '')}`, done: true })
        if (wldAddr) await loadWLD(wldAddr)
      } else {
        const msg = finalPayload?.message ?? finalPayload?.error_code ?? 'Rechazado por World App'
        setWldTxStep({ step: 1, total: 1, label: 'Error', error: msg })
      }
    } catch (e: any) {
      setWldTxStep({ step: 1, total: 1, label: 'Error', error: e?.message ?? 'Error inesperado' })
    } finally {
      setWldTxPending(false)
    }
  }

  // ─── WLD actions ──────────────────────────────────────────────────────────
  const doWLDStake = async () => {
    if (!wldStakeAmt || !MiniKit.isInstalled()) return
    let gross: bigint
    try { gross = ethers.parseEther(wldStakeAmt.replace(',', '.')) } catch { return }
    if (gross === BigInt(0)) return
    const nonce    = randomNonce()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    await runWldTx(`Stakeando ${wldStakeAmt} WLD…`, async () => {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: WLD_CONTRACT,
          abi: WLD_STAKE_ABI as any,
          functionName: 'stake',
          args: [
            { permitted: { token: WLD_TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
            gross.toString(),
          ],
        }],
        permit2: [{
          permitted: { token: WLD_TOKEN, amount: gross.toString() },
          spender: WLD_CONTRACT,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      setWldStakeAmt('')
      return finalPayload
    })
  }

  const doWLDRequestWithdraw = async () => {
    if (!wldUser || wldUser.staked === BigInt(0)) return
    if (!MiniKit.isInstalled()) return
    const gross = wldWdAmt
      ? (() => { try { return ethers.parseEther(wldWdAmt.replace(',', '.')) } catch { return wldUser.staked } })()
      : wldUser.staked
    await runWldTx('Solicitando retiro WLD…', async () => {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: WLD_CONTRACT, abi: WLD_WITHDRAW_ABI as any, functionName: 'requestWithdrawal', args: [gross.toString()] }],
      })
      setWldWdAmt('')
      return finalPayload
    })
  }

  const doWLDRequestClaim = async () => {
    if (!wldUser || wldUser.rewards === BigInt(0)) return
    if (!MiniKit.isInstalled()) return
    await runWldTx('Solicitando cobro de recompensas WLD…', async () => {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: WLD_CONTRACT, abi: WLD_CLAIM_ABI as any, functionName: 'requestClaim', args: [] }],
      })
      return finalPayload
    })
  }

  const doWLDTriggerQueue = async () => {
    if (!MiniKit.isInstalled()) return
    await runWldTx('Procesando cola WLD…', async () => {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: WLD_CONTRACT, abi: WLD_TRIGGER_ABI as any, functionName: 'triggerQueue', args: [] }],
      })
      return finalPayload
    })
  }

  const doWLDFund = async () => {
    if (!wldFundAmt || !MiniKit.isInstalled()) return
    let amount: bigint
    try { amount = ethers.parseEther(wldFundAmt.replace(',', '.')) } catch { return }
    if (amount === BigInt(0)) return
    const nonce    = randomNonce()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    await runWldTx(`Fondeando pool con ${wldFundAmt} WLD…`, async () => {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: WLD_CONTRACT,
          abi: WLD_FUND_ABI as any,
          functionName: 'fund',
          args: [
            { permitted: { token: WLD_TOKEN, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
            amount.toString(),
          ],
        }],
        permit2: [{
          permitted: { token: WLD_TOKEN, amount: amount.toString() },
          spender: WLD_CONTRACT,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      setWldFundAmt('')
      return finalPayload
    })
  }

  // ─── MiniKit helper for BNB transactions ─────────────────────────────────────
  // NOTE: BNB Chain transactions do NOT go through MiniKit (World Chain only).
  // World App would reject them — BNB contracts are on chainId 56, not 480.
  // All BNB transactions require an imported BNB private key (getSigner below).
  const runMiniKitTx = async (
    label: string,
    txList: object[],
    successLabel: string,
  ) => {
    setTxPending(true)
    setTxStep({ step: 1, total: 1, label })
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: txList as any,
      })
      if ((finalPayload as any).status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        const hashes = txId ? [txId] : []
        setTxStep({ step: 1, total: 1, label: `✓ ${successLabel}`, done: true })
        if (hashes.length > 0) {
          const rec = { id: Date.now().toString(), op: successLabel, hashes, ts: Date.now() }
          const updated = [rec, ...loadHistory()]
          saveHistory(updated)
          setTxHistory(updated)
        }
        if (bnbAddress) await load(bnbAddress)
      } else {
        const msg = (finalPayload as any).message ?? 'Transacción rechazada en World App'
        setTxStep({ step: 1, total: 1, label: 'Error', error: msg })
      }
    } catch (e: any) {
      setTxStep({ step: 1, total: 1, label: 'Error', error: e?.message ?? 'Error inesperado' })
    } finally {
      setTxPending(false)
    }
  }

  // ─── Signer with capped gas price ────────────────────────────────────────────
  // BNB Chain has had a 1 gwei floor since the Feb-2024 hard-fork.
  // The RPC sometimes returns inflated estimates (3-10 gwei) which drives
  // costs to 0.0008 BNB+. We override getFeeData so every tx through this
  // signer is capped at 1.1 gwei regardless of what the RPC returns.
  const getSigner = (): ethers.Wallet => {
    if (!bnbPrivateKey) throw new Error('Para firmar en BNB Chain importa tu wallet con clave privada en el selector de redes.')
    const provider = new ethers.JsonRpcProvider(BNB_RPC)
    const origGetFeeData = provider.getFeeData.bind(provider)
    provider.getFeeData = async () => {
      try {
        const d = await origGetFeeData()
        const cap = GAS_PRICE_WEI + GAS_PRICE_WEI / 10n  // 1.1 gwei
        const gp  = d.gasPrice !== null && d.gasPrice > cap ? cap : d.gasPrice
        return new ethers.FeeData(null, null, gp)
      } catch {
        return new ethers.FeeData(null, null, GAS_PRICE_WEI)
      }
    }
    return new ethers.Wallet(bnbPrivateKey, provider)
  }

  // ─── Core TX runner ──────────────────────────────────────────────────────────
  const runTx = async (
    steps: Array<{ label: string; run: () => Promise<ethers.TransactionResponse | null> }>,
    successLabel: string,
  ) => {
    setTxPending(true)
    setTxStep(null)
    const collectedHashes: string[] = []
    try {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]
        setTxStep({ step: i + 1, total: steps.length, label: s.label })
        const tx = await s.run()
        if (tx) {
          collectedHashes.push(tx.hash)
          setTxStep({ step: i + 1, total: steps.length, label: s.label + ' — confirmando en BNB Chain…', hash: tx.hash })
          await tx.wait()
        }
      }
      setTxStep({ step: steps.length, total: steps.length, label: `✓ ${successLabel}`, done: true })
      // Save to TX history
      if (collectedHashes.length > 0) {
        const rec: TxRecord = { id: Date.now().toString(), op: successLabel, hashes: collectedHashes, ts: Date.now() }
        const updated = [rec, ...loadHistory()]
        saveHistory(updated)
        setTxHistory(updated)
      }
      if (bnbAddress) await load(bnbAddress)
    } catch (e: any) {
      const msg = e?.reason ?? e?.data?.message ?? e?.message ?? 'Error desconocido'
      const clean = msg.length > 180 ? msg.slice(0, 180) + '…' : msg
      setTxStep({ step: 1, total: 1, label: 'Error en la transacción', error: clean })
    } finally {
      setTxPending(false)
    }
  }

  // ─── Ask confirmation then run ────────────────────────────────────────────
  const askConfirm = (
    title: string, detail: string, gasNote: string,
    action: () => Promise<void>,
  ) => {
    setTxStep(null)
    setConfirm({ title, detail, gasNote, onConfirm: action })
  }

  const executeConfirm = async () => {
    if (!confirm) return
    setConfirming(true)
    try {
      await confirm.onConfirm()
    } finally {
      setConfirming(false)
      setConfirm(null)
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────
  // BNB Chain transactions CANNOT go through MiniKit (World App only signs World Chain).
  // isMiniKit is always false for BNB operations — private key is required.
  const isMiniKit = false

  // Deposit
  const doDeposit = () => {
    if (!depositAmt) return
    let amount: bigint
    try { amount = ethers.parseEther(depositAmt.replace(',', '.')) } catch { return }
    if (amount === BigInt(0)) return

    askConfirm(
      `Depositar ${depositAmt} SUSHI`,
      `Stakearás ${depositAmt} SUSHI en el contrato de BNB Chain. Primero se aprobará el token SUSHI, luego se ejecutará el depósito. En total son 2 transacciones.`,
      'Asegúrate de tener BNB en tu wallet para pagar el gas de ambas transacciones.',
      async () => {
        if (isMiniKit) {
          // Check allowance first (read-only, no signing needed)
          const provider = new ethers.JsonRpcProvider(BNB_RPC)
          const token = new ethers.Contract(SUSHI_BNB_TOKEN, ERC20_ABI, provider)
          const allowance: bigint = await token.allowance(bnbAddress!, SUSHI_BNB_CONTRACT)
          const txList: object[] = []
          if (allowance < amount) {
            txList.push({ address: SUSHI_BNB_TOKEN, abi: MK_APPROVE, functionName: 'approve', args: [SUSHI_BNB_CONTRACT, ethers.MaxUint256.toString()] })
          }
          txList.push({ address: SUSHI_BNB_CONTRACT, abi: MK_DEPOSIT, functionName: 'deposit', args: [amount.toString()] })
          await runMiniKitTx(`Depositando ${depositAmt} SUSHI…`, txList, `${depositAmt} SUSHI stakeados correctamente`)
          setDepositAmt('')
          return
        }
        await runTx([
          {
            label: `Paso 1/2 — Aprobando ${depositAmt} SUSHI para el contrato…`,
            run: async () => {
              const signer = getSigner()
              const token  = new ethers.Contract(SUSHI_BNB_TOKEN, ERC20_ABI, signer)
              const allowance = await token.allowance(bnbAddress!, SUSHI_BNB_CONTRACT)
              if (allowance >= amount) return null
              return token.approve(SUSHI_BNB_CONTRACT, ethers.MaxUint256,
                { gasLimit: GAS_LIMITS.approve, gasPrice: GAS_PRICE_WEI })
            },
          },
          {
            label: `Paso 2/2 — Depositando ${depositAmt} SUSHI en staking…`,
            run: async () => {
              const signer   = getSigner()
              const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
              return contract.deposit(amount,
                { gasLimit: GAS_LIMITS.deposit, gasPrice: GAS_PRICE_WEI })
            },
          },
        ], `${depositAmt} SUSHI stakeados correctamente`)
        setDepositAmt('')
      },
    )
  }

  // Withdraw all
  const doWithdraw = () => {
    if (!info || info.staked === BigInt(0)) return
    askConfirm(
      `Retirar ${fmtSushi(info.staked)} SUSHI`,
      `Se retirarán TODOS tus tokens stakeados (${fmtSushi(info.staked)} SUSHI). Las recompensas pendientes (${fmtSushi(info.pendingRewards)} SUSHI) también se cobrarán automáticamente.`,
      'El retiro es total — no hay retiro parcial en este contrato.',
      async () => {
        if (isMiniKit) {
          await runMiniKitTx(`Retirando ${fmtSushi(info.staked)} SUSHI…`,
            [{ address: SUSHI_BNB_CONTRACT, abi: MK_WITHDRAW, functionName: 'withdraw', args: [] }],
            `${fmtSushi(info.staked)} SUSHI retirados a tu wallet`)
          return
        }
        await runTx([
          {
            label: `Retirando ${fmtSushi(info.staked)} SUSHI del staking…`,
            run: async () => {
              const signer   = getSigner()
              const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
              return contract.withdraw({ gasLimit: GAS_LIMITS.withdraw, gasPrice: GAS_PRICE_WEI })
            },
          },
        ], `${fmtSushi(info.staked)} SUSHI retirados a tu wallet`)
      },
    )
  }

  // Claim rewards
  const doClaim = () => {
    if (!info || info.pendingRewards === BigInt(0)) return
    askConfirm(
      `Cobrar ${fmtSushi(info.pendingRewards, 6)} SUSHI`,
      `Recibirás ${fmtSushi(info.pendingRewards, 6)} SUSHI de recompensas en tu wallet BNB. Tu stake permanece intacto.`,
      '',
      async () => {
        if (isMiniKit) {
          await runMiniKitTx(`Cobrando recompensas SUSHI…`,
            [{ address: SUSHI_BNB_CONTRACT, abi: MK_CLAIM, functionName: 'claimRewards', args: [] }],
            `${fmtSushi(info.pendingRewards, 6)} SUSHI cobrados`)
          return
        }
        await runTx([
          {
            label: `Cobrando ${fmtSushi(info.pendingRewards, 6)} SUSHI de recompensas…`,
            run: async () => {
              const signer   = getSigner()
              const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
              return contract.claimRewards({ gasLimit: GAS_LIMITS.claimRewards, gasPrice: GAS_PRICE_WEI })
            },
          },
        ], `${fmtSushi(info.pendingRewards, 6)} SUSHI cobrados`)
      },
    )
  }

  // Cook boost
  const doCook = () => {
    if (!info || info.staked === BigInt(0)) return
    const opt = COOK_OPTIONS[cookOption]
    askConfirm(
      `Iniciar Cocción — ${opt.label}`,
      `Activarás el boost de cocción por ${opt.label}. Durante este período tus recompensas se multiplican según tu racha. Necesitas SUSHI stakeado.`,
      'La cocción genera recompensas adicionales sobre tu stake. Función avanzada del contrato.',
      async () => {
        if (isMiniKit) {
          await runMiniKitTx(`Iniciando cocción por ${opt.label}…`,
            [{ address: SUSHI_BNB_CONTRACT, abi: MK_COOK, functionName: 'cook', args: [opt.seconds.toString()] }],
            `¡Cocción iniciada por ${opt.label}!`)
          return
        }
        await runTx([
          {
            label: `Iniciando cocción por ${opt.label}…`,
            run: async () => {
              const signer   = getSigner()
              const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
              return contract.cook(opt.seconds,
                { gasLimit: GAS_LIMITS.cook, gasPrice: GAS_PRICE_WEI })
            },
          },
        ], `¡Cocción iniciada por ${opt.label}!`)
      },
    )
  }

  // Buy membership
  const doMembership = (tier: number, priceBNB: bigint) => {
    const meta = MEMBERSHIP_TIERS[tier]
    askConfirm(
      `Activar membresía ${meta.name}`,
      `Pagarás ${ethers.formatEther(priceBNB)} BNB para activar la membresía ${meta.name}. Esta membresía te permite tiempos de cocción de hasta ${meta.cookMinutes < 60 ? meta.cookMinutes + ' minutos' : meta.cookMinutes / 60 + ' horas'}.`,
      `Pago en BNB: ${ethers.formatEther(priceBNB)} BNB + gas (~${GAS_ESTIMATE_BNB} BNB). Asegúrate de tener suficiente saldo BNB.`,
      async () => {
        if (isMiniKit) {
          await runMiniKitTx(`Activando membresía ${meta.name}…`,
            [{ address: SUSHI_BNB_CONTRACT, abi: MK_SUBSCRIBE, functionName: 'subscribeMembership', args: [tier.toString()], value: priceBNB.toString() }],
            `Membresía ${meta.name} activada`)
          return
        }
        await runTx([
          {
            label: `Activando membresía ${meta.name}…`,
            run: async () => {
              const signer   = getSigner()
              const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
              return contract.subscribeMembership(tier,
                { value: priceBNB, gasLimit: GAS_LIMITS.subscribeMember, gasPrice: GAS_PRICE_WEI })
            },
          },
        ], `Membresía ${meta.name} activada`)
      },
    )
  }

  // Referral
  const doApplyReferral = () => {
    if (!referralCode.trim()) return
    askConfirm(
      'Aplicar código de referido',
      `Aplicarás el código "${referralCode.trim()}". Esto puede darte un descuento en membresías.`,
      '',
      async () => {
        if (isMiniKit) {
          await runMiniKitTx(`Aplicando código "${referralCode}"…`,
            [{ address: SUSHI_BNB_CONTRACT, abi: MK_APPLY_REF, functionName: 'applyReferral', args: [referralCode.trim()] }],
            `Código "${referralCode}" aplicado`)
          setReferralCode('')
          return
        }
        await runTx([
          {
            label: `Aplicando código "${referralCode}"…`,
            run: async () => {
              const signer   = getSigner()
              const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
              return contract.applyReferral(referralCode.trim(),
                { gasLimit: GAS_LIMITS.referral, gasPrice: GAS_PRICE_WEI })
            },
          },
        ], `Código "${referralCode}" aplicado`)
        setReferralCode('')
      },
    )
  }

  const doCreateCode = () => {
    const code = `ACUA${(bnbAddress ?? '').slice(2, 8).toUpperCase()}`
    askConfirm(
      'Crear código de referido',
      `Crearás el código "${code}" vinculado a tu wallet. Compártelo y gana el 10% de las membresías que tus amigos compren.`,
      '',
      async () => {
        if (isMiniKit) {
          await runMiniKitTx(`Creando código de referido "${code}"…`,
            [{ address: SUSHI_BNB_CONTRACT, abi: MK_CREATE_CODE, functionName: 'createReferralCode', args: [code] }],
            `Código "${code}" creado`)
          return
        }
        await runTx([
          {
            label: `Creando código de referido "${code}"…`,
            run: async () => {
              const signer   = getSigner()
              const contract = new ethers.Contract(SUSHI_BNB_CONTRACT, SUSHI_BNB_ABI, signer)
              return contract.createReferralCode(code,
                { gasLimit: GAS_LIMITS.referral, gasPrice: GAS_PRICE_WEI })
            },
          },
        ], `Código "${code}" creado`)
      },
    )
  }

  // ─── Derivados ───────────────────────────────────────────────────────────────
  const multiplier   = info ? (info.streakBps / 10000).toFixed(2) : '1.00'
  const cookOpt      = COOK_OPTIONS[cookOption]
  const lastActionAgo = info?.lastActionTs
    ? Math.floor((Date.now() / 1000) - info.lastActionTs)
    : null
  const lastActionLabel = lastActionAgo !== null
    ? lastActionAgo < 3600
      ? `hace ${Math.floor(lastActionAgo / 60)} min`
      : lastActionAgo < 86400
      ? `hace ${Math.floor(lastActionAgo / 3600)}h`
      : `hace ${Math.floor(lastActionAgo / 86400)} días`
    : null

  // ─── No wallet ───────────────────────────────────────────────────────────────
  if (!bnbAddress && walletMode !== 'minikit') {
    return (
      <div className="space-y-4 pb-24">
        <div className="relative rounded-2xl overflow-hidden p-5" style={{ background: 'linear-gradient(135deg,#7c1d1d,#e8414210,#0a0a14)' }}>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl border border-[#e84142]/40" style={{ background: '#e8414215' }}>🍣</div>
            <div>
              <p className="text-[10px] font-bold text-[#e84142]/80 uppercase tracking-wider">ACUA en</p>
              <h2 className="text-xl font-black text-foreground">SUSHI Staking BNB</h2>
              <p className="text-[10px] text-[oklch(0.50_0.012_230)]">BNB Chain · Contrato verificado on-chain</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/25">
          <Wallet className="w-5 h-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-400">Wallet BNB requerida</p>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)] leading-relaxed">
              Conecta tu World Wallet o importa una wallet BNB con clave privada en el selector de redes (esquina superior derecha).
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ─── No private key warning ───────────────────────────────────────────────────
  // All BNB transactions require a BNB private key (World App cannot sign on BSC).
  const noKey = !bnbPrivateKey

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-24">

      {/* ══ Panel switcher ═══════════════════════════════════════════════════ */}
      <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-1">
        <button onClick={() => setActivePanel('sushi')}
          className={cn('flex-1 py-2 rounded-lg text-[10px] font-black transition-colors flex items-center justify-center gap-1.5', activePanel === 'sushi' ? 'bg-[#e84142] text-white' : 'text-[oklch(0.50_0.012_230)] hover:text-foreground')}>
          🍣 SUSHI <span className="text-[8px] opacity-70">BNB</span>
        </button>
        <button onClick={() => setActivePanel('wld')}
          className={cn('flex-1 py-2 rounded-lg text-[10px] font-black transition-colors flex items-center justify-center gap-1.5', activePanel === 'wld' ? 'text-white' : 'text-[oklch(0.50_0.012_230)] hover:text-foreground')}
          style={activePanel === 'wld' ? { background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)' } : {}}>
          💛 WLD <span className="text-[8px] opacity-70">World Chain</span>
        </button>
      </div>

      {/* ══ SUSHI Panel (BNB Chain) ══════════════════════════════════════════ */}
      {activePanel === 'sushi' && (<>

      {/* ── Confirmation modal ─────────────────────────────────────────────── */}
      {confirm && (
        <TxConfirmModal
          title={confirm.title}
          detail={confirm.detail}
          gasNote={confirm.gasNote}
          onConfirm={executeConfirm}
          onCancel={() => setConfirm(null)}
          confirming={confirming}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden p-4" style={{ background: 'linear-gradient(135deg,#7c1d1d,#e8414210,#0a0a14)' }}>
        <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(circle at 80% 50%, #e84142, transparent 60%)' }} />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl border border-[#e84142]/30" style={{ background: '#e8414215' }}>🍣</div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold text-[#e84142]/80 uppercase tracking-wider">SUSHI Staking · BNB Chain</p>
            <h2 className="text-lg font-black text-foreground leading-tight">SUSHI Staking</h2>
            <p className="text-[8px] text-[oklch(0.45_0.01_230)] truncate font-mono">{bnbAddress?.slice(0,10)}…{bnbAddress?.slice(-6)}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {info && <MembershipBadge tier={info.membership} />}
            <button onClick={() => bnbAddress && load(bnbAddress)} disabled={loading}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
              <RefreshCw className={cn('w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Balances */}
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-center">
            <p className="text-[8px] text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Saldo SUSHI</p>
            <p className="text-sm font-black font-mono" style={{ color: SUSHI_COLOR }}>
              {info ? fmtSushi(info.sushiBal) : loading ? '…' : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-black/20 border border-white/5 px-3 py-2 text-center">
            <p className="text-[8px] text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Saldo BNB</p>
            <p className="text-sm font-black font-mono" style={{ color: BNB_COLOR }}>
              {info ? fmtBNB(info.bnbBal) : loading ? '…' : '—'}
            </p>
          </div>
        </div>

        {/* Account change hint */}
        <div className="relative mt-2 flex items-center justify-between gap-2 px-2.5 py-1 rounded-xl bg-white/4 border border-white/8">
          <p className="text-[8px] text-[oklch(0.45_0.01_230)]">
            {isMiniKit ? '🌐 World Wallet · MiniKit' : noKey ? '👁 Solo lectura · sin clave privada BNB' : '🔑 Clave privada BNB activa'}
          </p>
          <button
            onClick={() => {
              const el = document.getElementById('network-switcher-trigger')
              if (el) el.click()
            }}
            className="text-[8px] text-blue-400 hover:text-blue-300 font-bold shrink-0 transition-colors"
          >
            Cambiar →
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-1 gap-1">
        {[
          { id: 'stake',      label: '🍣 Stake'   },
          { id: 'membership', label: '👑 VIP'      },
          { id: 'referral',   label: '🤝 Ref'      },
          { id: 'history',    label: `🕑 Historial${txHistory.length > 0 ? ` (${txHistory.length})` : ''}` },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveView(tab.id as any)}
            className={cn('flex-1 py-1.5 rounded-lg text-[9px] font-bold transition-colors', activeView === tab.id ? 'text-white' : 'text-[oklch(0.50_0.012_230)] hover:text-foreground')}
            style={activeView === tab.id ? { background: SUSHI_COLOR } : {}}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TX progress ─────────────────────────────────────────────────────── */}
      <TxProgress step={txStep} />

      {/* ════════════════════════════════════════════════════════════════════════
          STAKE TAB
          ════════════════════════════════════════════════════════════════════ */}
      {activeView === 'stake' && (
        <div className="space-y-3">

          {/* ─ Staked balance card ─ */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Tu Balance Stakeado</p>
            <div className="flex items-end gap-3">
              <span className="text-3xl">🍣</span>
              <div>
                <p className="text-3xl font-black font-mono leading-none" style={{ color: SUSHI_COLOR }}>
                  {info ? fmtSushi(info.staked, 2) : loading ? '…' : '0.00'}
                </p>
                <p className="text-[9px] text-[oklch(0.40_0.01_230)] mt-0.5">SUSHI stakeados</p>
              </div>
            </div>
            {lastActionLabel && (
              <p className="text-[8px] text-[oklch(0.40_0.01_230)]">Última acción: {lastActionLabel}</p>
            )}

            {/* Cooking rewards acum */}
            {info && info.cookingRewards > BigInt(0) && (
              <div className="rounded-lg bg-[#e84142]/8 border border-[#e84142]/20 px-3 py-1.5 flex items-center gap-2">
                <Flame className="w-3 h-3 text-[#e84142] shrink-0" />
                <p className="text-[9px] text-[oklch(0.50_0.012_230)]">
                  Recompensas cocción acumuladas: <span className="font-bold text-[#e84142]">{fmtSushi(info.cookingRewards, 4)} SUSHI</span>
                </p>
              </div>
            )}

            {/* Withdraw button */}
            <button
              onClick={doWithdraw}
              disabled={txPending || !info || info.staked === BigInt(0)}
              className="w-full py-2.5 rounded-xl text-xs font-bold border border-[oklch(0.30_0.025_245)] bg-[oklch(0.14_0.02_245)] text-[oklch(0.60_0.01_230)] disabled:opacity-40 hover:bg-[oklch(0.18_0.025_245)] transition-colors flex items-center justify-center gap-2"
            >
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '📤'}
              RETIRAR TODO ({info ? fmtSushi(info.staked) : '0'} SUSHI)
            </button>
          </div>

          {/* ─ Pending rewards card ─ */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Recompensas Acumuladas</p>
            <div className="flex items-center gap-3">
              <p className="text-2xl font-black font-mono" style={{ color: SUSHI_COLOR }}>
                {info ? fmtSushi(info.pendingRewards, 6) : '0.000000'}
              </p>
              <span className="text-xl">🍣</span>
            </div>
            <button
              onClick={doClaim}
              disabled={txPending || !info || info.pendingRewards === BigInt(0)}
              className="w-full py-2.5 rounded-xl text-xs font-bold disabled:opacity-40 transition-all flex items-center justify-center gap-2"
              style={info && info.pendingRewards > BigInt(0)
                ? { background: 'linear-gradient(135deg,#e84142,#c02f30)', color: 'white', boxShadow: '0 0 16px rgba(232,65,66,0.3)' }
                : { border: '1px solid oklch(0.22 0.025 245)', background: 'oklch(0.14 0.02 245)', color: 'oklch(0.55 0.01 230)' }
              }
            >
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🍜'}
              COBRAR RECOMPENSAS
            </button>
          </div>

          {/* ─ Cook section ─ */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
            <div className="p-4 space-y-3"
              style={{ backgroundImage: 'url(https://i.imgur.com/XwFMb7Q.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', backgroundBlendMode: 'overlay' }}>
              <div className="bg-black/60 rounded-xl p-3 space-y-3 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <p className="text-xs font-bold text-foreground">Ajustes de Cocción</p>
                </div>

                {/* Cook time selector */}
                <div className="relative">
                  <p className="text-[9px] text-[oklch(0.45_0.01_230)] mb-1">Elige tiempo de cocción</p>
                  <button
                    onClick={() => setShowCookDrop(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] text-xs font-medium text-foreground"
                  >
                    {cookOpt.label}
                    {cookOpt.minTier > 0 && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full mr-1"
                        style={{ color: MEMBERSHIP_TIERS[cookOpt.minTier].color, background: `${MEMBERSHIP_TIERS[cookOpt.minTier].color}20` }}>
                        req. {MEMBERSHIP_TIERS[cookOpt.minTier].name}
                      </span>
                    )}
                    <ChevronDown className={cn('w-3.5 h-3.5 text-[oklch(0.45_0.01_230)] transition-transform', showCookDrop && 'rotate-180')} />
                  </button>
                  {showCookDrop && (
                    <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.12_0.02_245)] z-20 overflow-hidden shadow-xl">
                      {COOK_OPTIONS.map((opt, i) => {
                        const locked = (info?.membership ?? 0) < opt.minTier
                        return (
                          <button key={i}
                            onClick={() => { if (!locked) { setCookOption(i); setShowCookDrop(false) } }}
                            className={cn('w-full flex items-center justify-between px-3 py-2 text-xs transition-colors', locked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5', cookOption === i && 'bg-[#e84142]/10')}>
                            <span className="font-medium text-foreground">{opt.label}</span>
                            <div className="flex items-center gap-1.5">
                              {opt.minTier > 0 && (
                                <span className="text-[7px] font-bold" style={{ color: MEMBERSHIP_TIERS[opt.minTier].color }}>
                                  {MEMBERSHIP_TIERS[opt.minTier].name}
                                </span>
                              )}
                              {locked && <Lock className="w-3 h-3 text-[oklch(0.45_0.01_230)]" />}
                              {cookOption === i && <span className="text-[#e84142]">✓</span>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Streak */}
                <div className="rounded-xl bg-[oklch(0.10_0.018_245)]/60 border border-white/5 px-3 py-2">
                  <p className="text-[9px] text-[oklch(0.45_0.01_230)] mb-0.5">Multiplicador de Racha</p>
                  <p className="text-sm font-black font-mono text-emerald-400">{multiplier}×</p>
                </div>

                {/* Projected */}
                <div className="rounded-xl bg-[oklch(0.10_0.018_245)]/60 border border-white/5 px-3 py-2">
                  <p className="text-[9px] text-[oklch(0.45_0.01_230)] mb-0.5">Proyección de recompensas</p>
                  <p className="text-sm font-black font-mono text-emerald-400">
                    +{info ? (parseFloat(fmtSushi(info.staked)) * (cookOpt.seconds / 86400) * 0.0082 * (info.streakBps / 10000)).toFixed(6) : '0.000000'} SUSHI
                  </p>
                </div>

                {/* Cook button */}
                <button
                  onClick={doCook}
                  disabled={txPending || !info || info.staked === BigInt(0)}
                  className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', boxShadow: '0 0 16px rgba(34,197,94,0.4)' }}
                >
                  {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🍳'}
                  {t('cook', lang).toUpperCase()}
                </button>
              </div>
            </div>
          </div>

          {/* ─ Deposit ─ */}
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-foreground">Depositar SUSHI</p>
              <p className="text-[9px] text-[oklch(0.45_0.01_230)]">
                Balance: <span className="font-bold text-foreground font-mono">{info ? fmtSushi(info.sushiBal) : '—'}</span>
              </p>
            </div>
            <div className="relative">
              <input type="number" value={depositAmt} onChange={e => setDepositAmt(e.target.value)}
                placeholder="0.0 SUSHI"
                className="w-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-[#e84142]/50 placeholder:text-[oklch(0.35_0.01_230)]" />
              <button onClick={() => setDepositAmt(info ? ethers.formatEther(info.sushiBal) : '')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#e84142] hover:text-[#ff6b6b]">MAX</button>
            </div>

            {/* Info about 2 TXs */}
            <div className="flex items-start gap-1.5 text-[8px] text-[oklch(0.45_0.01_230)]">
              <Info className="w-3 h-3 shrink-0 mt-0.5" />
              <p>2 transacciones: Approve SUSHI + Deposit. Gas mínimo BSC (1 gwei): <span className="text-[#f0b90b] font-bold">~{GAS_ESTIMATE_STAKE.toFixed(6)} BNB</span> (~${(GAS_ESTIMATE_STAKE * BNB_USD_APPROX).toFixed(3)} USD)</p>
            </div>

            <button
              onClick={doDeposit}
              disabled={txPending || !depositAmt || parseFloat(depositAmt) <= 0}
              className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white', boxShadow: '0 0 16px rgba(34,197,94,0.25)' }}
            >
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🍱'}
              {t('deposit', lang).toUpperCase()} SUSHI
            </button>
          </div>

          {/* Contract info */}
          <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.20_0.025_245)] p-3 space-y-1.5 text-[9px]">
            <p className="font-bold text-[oklch(0.50_0.012_230)] uppercase tracking-wider text-[8px]">Info del Contrato</p>
            <div className="flex items-center justify-between">
              <span className="text-[oklch(0.45_0.01_230)]">SUSHI total stakeado</span>
              <span className="font-mono text-foreground">{totalStaked !== null ? fmtSushi(totalStaked, 0) + ' SUSHI' : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[oklch(0.45_0.01_230)]">Contrato BNB Chain</span>
              <a href={`https://bscscan.com/address/${SUSHI_BNB_CONTRACT}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-mono">
                {SUSHI_BNB_CONTRACT.slice(0,8)}…<ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[oklch(0.45_0.01_230)]">Gas mínimo / TX (1 gwei)</span>
              <span className="font-mono text-[#f0b90b]">~{GAS_ESTIMATE_BNB.toFixed(6)} BNB ≈ ${gasCostUSD()} USD</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[oklch(0.45_0.01_230)]">Gas stake (approve+dep)</span>
              <span className="font-mono text-[#f0b90b]">~{GAS_ESTIMATE_STAKE.toFixed(6)} BNB ≈ ${(GAS_ESTIMATE_STAKE * BNB_USD_APPROX).toFixed(3)} USD</span>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          MEMBERSHIP TAB
          ════════════════════════════════════════════════════════════════════ */}
      {activeView === 'membership' && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.22_0.025_245)] p-5 text-center space-y-3">
            <div className="text-5xl">💪</div>
            <h3 className="text-base font-black text-foreground">🚀 Potenciá tus ganancias!</h3>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)]">Aumentá tu nivel para tiempos de cocción más largos y mayores multiplicadores.</p>
            <div className="flex items-center justify-center gap-2">
              <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Mi membresía actual:</p>
              {info && <MembershipBadge tier={info.membership} />}
            </div>
          </div>

          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[oklch(0.18_0.02_245)] flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">VIP · MEMBRESÍAS</p>
            </div>
            <div className="divide-y divide-[oklch(0.15_0.02_245)]">
              {MEMBERSHIP_TIERS.map((tier, i) => {
                const isCurrent = (info?.membership ?? 0) === i
                const isLower   = (info?.membership ?? 0) > i
                const icons = ['⚪', '🥈', '🥇', '💎']
                return (
                  <div key={i} className={cn('flex items-center gap-3 px-4 py-3 transition-colors', isCurrent && 'bg-[oklch(0.14_0.02_245)]')}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{icons[i]}</span>
                        <span className="text-xs font-bold" style={{ color: tier.color }}>{tier.name}</span>
                        {isCurrent && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">ACTUAL</span>}
                      </div>
                      <p className="text-[9px] text-[oklch(0.45_0.01_230)] mt-0.5">
                        ⏱ {tier.cookMinutes < 60 ? `${tier.cookMinutes} min` : tier.cookMinutes < 1440 ? `${tier.cookMinutes / 60}h` : `${tier.cookMinutes / 1440}d`} cocción
                      </p>
                    </div>
                    {i === 0 ? (
                      <span className="text-[10px] text-[oklch(0.45_0.01_230)] px-3 py-1.5 rounded-xl bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)]">GRATIS</span>
                    ) : isLower ? (
                      <span className="text-[9px] text-[oklch(0.40_0.01_230)]">ya superado</span>
                    ) : (
                      <button
                        onClick={() => doMembership(i, tier.priceBNB)}
                        disabled={txPending || isCurrent}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold disabled:opacity-40 transition-all active:scale-95"
                        style={{ background: `${tier.color}20`, color: tier.color, border: `1.5px solid ${tier.color}50` }}
                      >
                        <Image src="https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" alt="BNB" width={12} height={12} className="rounded-full" unoptimized />
                        {ethers.formatEther(tier.priceBNB)} BNB
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/8 border border-blue-500/25">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-[9px] text-[oklch(0.50_0.012_230)] leading-relaxed">
              Las membresías se pagan directamente en <strong className="text-[#f0b90b]">BNB</strong> desde tu wallet. Necesitarás saldo BNB para el precio de la membresía + el gas de la transacción.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          REFERRAL TAB
          ════════════════════════════════════════════════════════════════════ */}
      {activeView === 'referral' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-emerald-400" />
              <p className="text-xs font-bold text-foreground">¿Te refirió un amigo? Ingresa el código</p>
            </div>
            <div className="flex gap-2">
              <input value={referralCode} onChange={e => setReferralCode(e.target.value)}
                placeholder="Código de descuento"
                className="flex-1 bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2 text-xs text-foreground focus:outline-none focus:border-emerald-500/50 placeholder:text-[oklch(0.35_0.01_230)]" />
              <button onClick={doApplyReferral} disabled={txPending || !referralCode.trim()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] text-[oklch(0.60_0.01_230)] hover:border-emerald-500/40 disabled:opacity-40 transition-colors">
                Aplicar
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-emerald-400" />
              <p className="text-xs font-bold text-emerald-400">🚀 ¡Gana recompensas invitando amigos!</p>
            </div>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)]">
              Crea tu código único para compartir y gana el 10% de las membresías que tus amigos compren.
            </p>
            <button onClick={doCreateCode} disabled={txPending}
              className="w-full py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: 'white' }}>
              {txPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🔗'}
              Crear mi código ACUA{(bnbAddress ?? '').slice(2, 8).toUpperCase()}
            </button>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-xl bg-[#f0b90b]/8 border border-[#f0b90b]/25">
            <Info className="w-4 h-4 text-[#f0b90b] shrink-0 mt-0.5" />
            <p className="text-[9px] text-[oklch(0.50_0.012_230)] leading-relaxed">
              BSC usa <strong className="text-[#f0b90b]">mínimo 1 gwei</strong> de gas (regla de protocolo inamovible). Cada TX cuesta <strong className="text-[#f0b90b]">~0.000070–0.000150 BNB</strong>. Mantén al menos <strong className="text-[#f0b90b]">0.001 BNB</strong> para cubrir fees cómodamente.
            </p>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          HISTORY TAB
          ════════════════════════════════════════════════════════════════════ */}
      {activeView === 'history' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Historial de Transacciones BNB</p>
            {txHistory.length > 0 && (
              <button
                onClick={() => { saveHistory([]); setTxHistory([]) }}
                className="text-[8px] text-red-400 hover:text-red-300 transition-colors font-bold"
              >
                Borrar todo
              </button>
            )}
          </div>

          {txHistory.length === 0 ? (
            <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-8 text-center space-y-2">
              <p className="text-3xl">🕑</p>
              <p className="text-xs font-bold text-[oklch(0.50_0.012_230)]">Sin historial aún</p>
              <p className="text-[9px] text-[oklch(0.40_0.01_230)]">Las transacciones completadas aparecerán aquí automáticamente.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {txHistory.map(rec => {
                const date = new Date(rec.ts)
                const dateStr = date.toLocaleDateString('es', { day: '2-digit', month: 'short' })
                const timeStr = date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
                return (
                  <div key={rec.id} className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold text-emerald-400 leading-snug">✓ {rec.op}</p>
                        <p className="text-[8px] text-[oklch(0.40_0.01_230)] mt-0.5">{dateStr} · {timeStr}</p>
                      </div>
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                        {rec.hashes.length} TX
                      </span>
                    </div>
                    <div className="space-y-1">
                      {rec.hashes.map((hash, i) => (
                        <a key={hash} href={`${BSCSCAN}${hash}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 group">
                          <span className="text-[7px] font-bold text-[oklch(0.35_0.01_230)] w-4 shrink-0">#{i + 1}</span>
                          <code className="flex-1 text-[8px] font-mono text-[oklch(0.45_0.01_230)] group-hover:text-blue-400 transition-colors truncate">
                            {hash.slice(0, 18)}…{hash.slice(-8)}
                          </code>
                          <ExternalLink className="w-2.5 h-2.5 text-[oklch(0.35_0.01_230)] group-hover:text-blue-400 transition-colors shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Gas info note */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/8 border border-blue-500/25">
            <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-[8px] text-blue-300 font-bold">Gas mínimo en BSC</p>
              <p className="text-[8px] text-[oklch(0.45_0.01_230)] leading-relaxed">
                BSC impone 1 gwei como precio mínimo de gas (protocolo, no configurable). El costo más barato posible es <strong className="text-[#f0b90b]">~0.000046 BNB por approve</strong> y <strong className="text-[#f0b90b]">~0.0001 BNB por stake</strong>. Gas de 0.05–0.09 gwei o costos de 0.000001 BNB no son alcanzables en ninguna tx de smart contract en BSC.
              </p>
            </div>
          </div>
        </div>
      )}

      </>)} {/* ── end SUSHI panel ── */}

      {/* ══ WLD Panel (World Chain) ══════════════════════════════════════════ */}
      {activePanel === 'wld' && (<>

        {/* ── WLD Header ───────────────────────────────────────────────────── */}
        <div className="relative rounded-2xl overflow-hidden p-4" style={{ background: 'linear-gradient(135deg,#1e3a8a,#3b82f615,#0a0a14)' }}>
          <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(circle at 80% 50%, #3b82f6, transparent 60%)' }} />
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl border border-[#3b82f6]/30" style={{ background: '#3b82f615' }}>💛</div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold text-[#3b82f6]/80 uppercase tracking-wider">WLD Staking · World Chain</p>
              <h2 className="text-lg font-black text-foreground leading-tight">WLD Stake V2</h2>
              <p className="text-[8px] text-[oklch(0.45_0.01_230)] truncate font-mono">
                {wldGlobal ? `${(wldGlobal.aprBps / 100).toFixed(0)}% APR · fee ${(wldGlobal.feeBps / 100).toFixed(0)}%` : '100% APR · fee 5%'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[8px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">World Chain</span>
              <button onClick={() => wldAddr && loadWLD(wldAddr)} disabled={wldLoading}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                <RefreshCw className={cn('w-3.5 h-3.5 text-[oklch(0.45_0.01_230)]', wldLoading && 'animate-spin')} />
              </button>
            </div>
          </div>

          {/* Global stats mini-row */}
          <div className="relative mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-black/20 border border-white/5 px-2 py-2 text-center">
              <p className="text-[7px] text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Total Staked</p>
              <p className="text-xs font-black font-mono text-[#3b82f6]">{wldGlobal ? fmtWldShort(wldGlobal.totalStaked) : '—'} WLD</p>
            </div>
            <div className="rounded-xl bg-black/20 border border-white/5 px-2 py-2 text-center">
              <p className="text-[7px] text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Fund Pool</p>
              <p className="text-xs font-black font-mono text-emerald-400">{wldGlobal ? fmtWldShort(wldGlobal.fundPool) : '—'} WLD</p>
            </div>
            <div className="rounded-xl bg-black/20 border border-white/5 px-2 py-2 text-center">
              <p className="text-[7px] text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Stakers</p>
              <p className="text-xs font-black font-mono text-foreground">{wldGlobal ? wldGlobal.stakerCount : '—'}</p>
            </div>
          </div>
        </div>

        {/* ── Global financials ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-2.5">
          <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Estadísticas Globales</p>
          {[
            { label: 'Total WLD depositado (fundPool)', val: wldGlobal ? fmtWld(wldGlobal.totalFunded, 2) + ' WLD' : '—' },
            { label: 'Total WLD pagado (retiros + cobros)', val: wldGlobal ? fmtWld(wldGlobal.totalFeeCollected + BigInt(0), 2) + ' WLD' : '—' },
            { label: 'Pendiente retiros / cobros', val: wldGlobal ? `${fmtWld(wldGlobal.totalPendingWithdrawals, 2)} / ${fmtWld(wldGlobal.totalPendingClaims, 2)} WLD` : '—' },
            { label: 'Cola retiros / cobros procesados', val: wldGlobal ? `${wldGlobal.withdrawQueueLen} / ${wldGlobal.claimQueueLen} (idx ${wldGlobal.nextWithdrawIdx}/${wldGlobal.nextClaimIdx})` : '—' },
          ].map(({ label, val }) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-[9px] text-[oklch(0.45_0.01_230)] leading-snug">{label}</span>
              <span className="text-[9px] font-bold font-mono text-foreground shrink-0">{val}</span>
            </div>
          ))}
        </div>

        {/* ── WLD TX Progress ───────────────────────────────────────────────── */}
        <TxProgress step={wldTxStep} />

        {/* ── User section ─────────────────────────────────────────────────── */}
        {walletMode === 'minikit' && wldAddr ? (
          <div className="space-y-3">

            {/* User balance card */}
            <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
              <p className="text-[9px] font-bold text-[oklch(0.45_0.01_230)] uppercase tracking-wider">Tu Posición WLD</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-black/30 border border-white/5 p-3 text-center">
                  <p className="text-[7px] text-[oklch(0.45_0.01_230)] uppercase mb-1">Stakeado</p>
                  <p className="text-xl font-black font-mono text-[#3b82f6]">{wldUser ? fmtWld(wldUser.staked, 2) : wldLoading ? '…' : '0.00'}</p>
                  <p className="text-[8px] text-[oklch(0.40_0.01_230)]">WLD</p>
                </div>
                <div className="rounded-xl bg-black/30 border border-white/5 p-3 text-center">
                  <p className="text-[7px] text-[oklch(0.45_0.01_230)] uppercase mb-1">Recompensas</p>
                  <p className="text-xl font-black font-mono text-emerald-400">{wldUser ? fmtWld(wldUser.rewards, 4) : wldLoading ? '…' : '0.0000'}</p>
                  <p className="text-[8px] text-[oklch(0.40_0.01_230)]">WLD</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-[9px] px-1">
                <span className="text-[oklch(0.45_0.01_230)]">Balance en wallet</span>
                <span className="font-bold font-mono text-foreground">{wldUser ? fmtWld(wldUser.wldBal, 4) : '—'} WLD</span>
              </div>
            </div>

            {/* Pending requests */}
            {wldUser?.hasWithdraw && wldUser.withdrawReq && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                <p className="text-[9px] font-bold text-amber-400">⏳ Retiro pendiente en cola</p>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-[oklch(0.45_0.01_230)]">Monto neto</span>
                  <span className="font-bold font-mono text-amber-400">{fmtWld(wldUser.withdrawReq.netAmount, 4)} WLD</span>
                </div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-[oklch(0.45_0.01_230)]">Listo en</span>
                  <span className="font-mono text-[oklch(0.50_0.012_230)]">{countdown(wldUser.withdrawReq.readyAt)}</span>
                </div>
                {wldUser.withdrawPos > 0 && (
                  <p className="text-[8px] text-[oklch(0.40_0.01_230)]">Posición en cola: #{wldUser.withdrawPos}</p>
                )}
              </div>
            )}

            {wldUser?.hasClaim && wldUser.claimReq && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1">
                <p className="text-[9px] font-bold text-emerald-400">⏳ Cobro de recompensas en cola</p>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-[oklch(0.45_0.01_230)]">Monto neto</span>
                  <span className="font-bold font-mono text-emerald-400">{fmtWld(wldUser.claimReq.netAmount, 4)} WLD</span>
                </div>
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-[oklch(0.45_0.01_230)]">Listo en</span>
                  <span className="font-mono text-[oklch(0.50_0.012_230)]">{countdown(wldUser.claimReq.readyAt)}</span>
                </div>
              </div>
            )}

            {/* Stake WLD */}
            <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-foreground">Stakear WLD</p>
                <p className="text-[9px] text-[oklch(0.45_0.01_230)]">Balance: <span className="font-bold text-foreground">{wldUser ? fmtWld(wldUser.wldBal, 4) : '—'}</span></p>
              </div>
              <div className="relative">
                <input type="number" value={wldStakeAmt} onChange={e => setWldStakeAmt(e.target.value)}
                  placeholder="0.0 WLD"
                  className="w-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-[#3b82f6]/50 placeholder:text-[oklch(0.35_0.01_230)]" />
                <button onClick={() => wldUser && setWldStakeAmt(fmtWld(wldUser.wldBal, 6))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#3b82f6] hover:text-blue-300">MAX</button>
              </div>
              <div className="flex items-start gap-1.5 text-[8px] text-[oklch(0.45_0.01_230)]">
                <Info className="w-3 h-3 shrink-0 mt-0.5" />
                <p>Usa Permit2 (sin approve separado). Fee: {wldGlobal ? (wldGlobal.feeBps / 100).toFixed(0) : 5}%. Queue: retiro 48h, cobro 24h.</p>
              </div>
              <button onClick={doWLDStake} disabled={wldTxPending || !wldStakeAmt || parseFloat(wldStakeAmt) <= 0}
                className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
                style={{ background: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', color: 'white', boxShadow: '0 0 16px rgba(59,130,246,0.3)' }}>
                {wldTxPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '💛'}
                STAKEAR WLD
              </button>
            </div>

            {/* Request Withdrawal */}
            {wldUser && wldUser.staked > BigInt(0) && !wldUser.hasWithdraw && (
              <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-4 space-y-3">
                <p className="text-xs font-bold text-foreground">Solicitar Retiro</p>
                <div className="relative">
                  <input type="number" value={wldWdAmt} onChange={e => setWldWdAmt(e.target.value)}
                    placeholder={`Máx: ${fmtWld(wldUser.staked, 4)} WLD`}
                    className="w-full bg-[oklch(0.14_0.02_245)] border border-[oklch(0.22_0.025_245)] rounded-xl px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-amber-500/50 placeholder:text-[oklch(0.35_0.01_230)]" />
                  <button onClick={() => setWldWdAmt(fmtWld(wldUser.staked, 6))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-amber-400 hover:text-amber-300">MAX</button>
                </div>
                <div className="flex items-start gap-1.5 text-[8px] text-[oklch(0.45_0.01_230)]">
                  <Clock className="w-3 h-3 shrink-0 mt-0.5" />
                  <p>El retiro toma 48h en cola. Fee: {wldGlobal ? (wldGlobal.feeBps / 100).toFixed(0) : 5}%. Solo 1 retiro pendiente por wallet.</p>
                </div>
                <button onClick={doWLDRequestWithdraw} disabled={wldTxPending}
                  className="w-full py-2.5 rounded-xl text-xs font-bold border border-amber-500/40 bg-amber-500/8 text-amber-400 hover:bg-amber-500/15 disabled:opacity-40 transition-colors flex items-center justify-center gap-2">
                  {wldTxPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '📤'}
                  SOLICITAR RETIRO WLD
                </button>
              </div>
            )}

            {/* Request Claim */}
            {wldUser && wldUser.rewards > BigInt(0) && !wldUser.hasClaim && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                <p className="text-xs font-bold text-foreground">Cobrar Recompensas</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[oklch(0.45_0.01_230)] text-[10px]">Recompensas acumuladas</span>
                  <span className="font-black font-mono text-emerald-400">{fmtWld(wldUser.rewards, 6)} WLD</span>
                </div>
                <div className="flex items-start gap-1.5 text-[8px] text-[oklch(0.45_0.01_230)]">
                  <Clock className="w-3 h-3 shrink-0 mt-0.5" />
                  <p>El cobro toma 24h en cola. Fee: {wldGlobal ? (wldGlobal.feeBps / 100).toFixed(0) : 5}%. Solo 1 cobro pendiente por wallet.</p>
                </div>
                <button onClick={doWLDRequestClaim} disabled={wldTxPending}
                  className="w-full py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white' }}>
                  {wldTxPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '🏆'}
                  COBRAR RECOMPENSAS
                </button>
              </div>
            )}

            {/* Trigger queue (public) */}
            <button onClick={doWLDTriggerQueue} disabled={wldTxPending}
              className="w-full py-2 rounded-xl text-[9px] font-bold border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] text-[oklch(0.45_0.01_230)] hover:border-blue-500/30 hover:text-blue-300 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
              {wldTxPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              Procesar cola (público)
            </button>

            {/* ─── Fund Pool (owner/owner2 only) ─────────────────────────── */}
            {isWldOwner && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">💰</span>
                  <div>
                    <p className="text-xs font-black text-emerald-400">Fondear Pool WLD</p>
                    <p className="text-[8px] text-[oklch(0.45_0.01_230)]">Solo owner · Permit2 · Mismo flujo que stake</p>
                  </div>
                  <span className="ml-auto text-[8px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-400">OWNER</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-black/30 border border-white/5 p-2 text-center">
                    <p className="text-[7px] text-[oklch(0.45_0.01_230)] uppercase mb-0.5">Fund Pool actual</p>
                    <p className="text-sm font-black font-mono text-emerald-400">{wldGlobal ? fmtWldShort(wldGlobal.fundPool) : '—'}</p>
                    <p className="text-[7px] text-[oklch(0.40_0.01_230)]">WLD</p>
                  </div>
                  <div className="rounded-xl bg-black/30 border border-white/5 p-2 text-center">
                    <p className="text-[7px] text-[oklch(0.45_0.01_230)] uppercase mb-0.5">Total fondeado</p>
                    <p className="text-sm font-black font-mono text-blue-400">{wldGlobal ? fmtWldShort(wldGlobal.totalFunded) : '—'}</p>
                    <p className="text-[7px] text-[oklch(0.40_0.01_230)]">WLD</p>
                  </div>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    value={wldFundAmt}
                    onChange={e => setWldFundAmt(e.target.value)}
                    placeholder="0.0 WLD a fondear"
                    className="w-full bg-[oklch(0.14_0.02_245)] border border-emerald-500/30 rounded-xl px-3 py-2.5 text-sm font-mono text-foreground focus:outline-none focus:border-emerald-500/60 placeholder:text-[oklch(0.35_0.01_230)]"
                  />
                  <button
                    onClick={() => wldUser && setWldFundAmt(fmtWld(wldUser.wldBal, 6))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-emerald-400 hover:text-emerald-300"
                  >
                    MAX
                  </button>
                </div>

                <div className="flex items-start gap-1.5 text-[8px] text-[oklch(0.45_0.01_230)]">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  <p>Usa Permit2 (sin approve separado). Los WLD van directamente al contrato como fondos para pagar retiros y recompensas.</p>
                </div>

                <button
                  onClick={doWLDFund}
                  disabled={wldTxPending || !wldFundAmt || parseFloat(wldFundAmt) <= 0}
                  className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
                  style={{ background: 'linear-gradient(135deg,#059669,#10b981)', color: 'white', boxShadow: '0 0 16px rgba(16,185,129,0.25)' }}
                >
                  {wldTxPending ? <Loader2 className="w-4 h-4 animate-spin" /> : '💰'}
                  FONDEAR POOL WLD
                </button>
              </div>
            )}
          </div>
        ) : (
          /* No World App connected */
          <div className="rounded-2xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-6 space-y-3 text-center">
            <div className="text-4xl">🌐</div>
            <p className="text-sm font-bold text-foreground">Conecta con World App</p>
            <p className="text-[10px] text-[oklch(0.50_0.012_230)] leading-relaxed">
              WLD Staking funciona en World Chain con tu World Wallet.<br/>
              Abre esta app dentro de World App para hacer stake de WLD.
            </p>
            <div className="mt-3 flex items-start gap-1.5 p-3 rounded-xl bg-blue-500/8 border border-blue-500/25 text-left">
              <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[9px] text-blue-300 leading-relaxed">
                Las estadísticas globales se muestran arriba. Para ver tu posición y hacer transacciones, accede desde World App.
              </p>
            </div>
          </div>
        )}

        {/* Contract info */}
        <div className="rounded-xl bg-[oklch(0.10_0.018_245)] border border-[oklch(0.20_0.025_245)] p-3 space-y-1.5 text-[9px]">
          <p className="font-bold text-[oklch(0.50_0.012_230)] uppercase tracking-wider text-[8px]">Info del Contrato WLD</p>
          <div className="flex items-center justify-between">
            <span className="text-[oklch(0.45_0.01_230)]">Contrato (World Chain)</span>
            <a href={`https://worldscan.org/address/${WLD_CONTRACT}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-mono">
              {WLD_CONTRACT.slice(0,8)}…<ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[oklch(0.45_0.01_230)]">APR</span>
            <span className="font-bold text-emerald-400">{wldGlobal ? (wldGlobal.aprBps / 100).toFixed(0) : 100}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[oklch(0.45_0.01_230)]">Fee de retiro / cobro</span>
            <span className="font-bold text-foreground">{wldGlobal ? (wldGlobal.feeBps / 100).toFixed(0) : 5}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[oklch(0.45_0.01_230)]">Total fee cobrado</span>
            <span className="font-mono text-foreground">{wldGlobal ? fmtWld(wldGlobal.totalFeeCollected, 4) : '—'} WLD</span>
          </div>
        </div>

      </>)} {/* ── end WLD panel ── */}

    </div>
  )
}
