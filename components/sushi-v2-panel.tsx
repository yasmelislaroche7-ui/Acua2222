'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useCountdown } from '@/hooks/use-countdown'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  TrendingUp, Clock, CheckCircle2, AlertCircle, Loader2,
  ChevronDown, ChevronUp, RefreshCw, Zap, ArrowDownToLine,
  Gift, Wallet, ShieldCheck, ExternalLink, Info, ArrowUpFromLine,
  CircleDollarSign, Users, BarChart3, Lock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

import {
  SUSHI_CONTRACT, SUSHI_TOKEN, SUSHI_OWNER2,
  STAKE_ABI, WITHDRAW_ABI, CLAIM_ABI, FUND_ABI, TRIGGER_ABI,
  SET_APR_ABI, SET_FEE_ABI, PERMIT_TUPLE,
  fetchUserSushiInfo, fetchGlobalSushiStats, fetchWithdrawQueue, fetchClaimQueue,
  fmtSushi, fmtSushiShort, fmtCountdown, worldscanTx, randNonce, makeDeadline, todayDay,
  type UserSushiInfo, type GlobalSushiStats, type QueueEntry,
} from '@/lib/sushi-v2'
import {
  WLD_CONTRACT, WLD_TOKEN, WLD_OWNER2,
  WLD_STAKE_ABI, WLD_WITHDRAW_ABI, WLD_CLAIM_ABI, WLD_FUND_ABI, WLD_TRIGGER_ABI,
  WLD_SET_APR_ABI, WLD_SET_FEE_ABI,
  fetchUserWldInfo, fetchGlobalWldStats, fetchWldWithdrawQueue, fetchWldClaimQueue,
  fmtWld, fmtWldShort,
  type UserWldInfo, type GlobalWldStats, type WldQueueEntry,
} from '@/lib/wld-stake-v2'

const SUSHI_COLOR = '#e84142' // sushi red

// ─── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'text-foreground', icon }: {
  label: string; value: string; sub?: string; color?: string; icon: React.ReactNode
}) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] text-[oklch(0.50_0.01_230)] font-medium uppercase tracking-wider">
        <span style={{ color: SUSHI_COLOR }}>{icon}</span>
        {label}
      </div>
      <p className={cn('text-lg font-black leading-tight font-mono truncate', color)}>{value}</p>
      {sub && <p className="text-[9px] text-[oklch(0.40_0.01_230)] font-mono">{sub}</p>}
    </div>
  )
}

function QueueRow({ entry, idx, type }: { entry: QueueEntry; idx: number; type: 'withdraw' | 'claim' }) {
  const now = Math.floor(Date.now() / 1000)
  const ready = now >= entry.readyAt
  const statusColor = entry.paid ? '#22c55e' : ready ? '#f59e0b' : '#6b7280'
  const statusLabel = entry.paid ? 'Pagado' : ready ? 'Listo' : fmtCountdown(entry.readyAt)

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[oklch(0.18_0.02_245)] last:border-0">
      <div className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
        style={{ background: `${statusColor}20`, color: statusColor, border: `1px solid ${statusColor}50` }}>
        {idx + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-mono text-foreground truncate">
          {entry.user.slice(0, 6)}…{entry.user.slice(-4)}
        </p>
        <p className="text-[9px] text-[oklch(0.45_0.01_230)] font-mono">
          {fmtSushi(entry.netAmount, 4)} SUSHI neto · comisión {fmtSushi(entry.fee, 4)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] font-bold" style={{ color: statusColor }}>{statusLabel}</p>
        {entry.paid && entry.paidAt > 0 && (
          <p className="text-[8px] text-[oklch(0.40_0.01_230)]">
            {new Date(entry.paidAt * 1000).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  )
}

function SectionCard({ title, children, collapsible = false, defaultOpen = true, badge }: {
  title: string; children: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean; badge?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 border-b border-[oklch(0.18_0.02_245)]"
        onClick={() => collapsible && setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">{title}</span>
          {badge && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
              {badge}
            </span>
          )}
        </div>
        {collapsible && (open
          ? <ChevronUp className="w-3.5 h-3.5 text-[oklch(0.50_0.01_230)]" />
          : <ChevronDown className="w-3.5 h-3.5 text-[oklch(0.50_0.01_230)]" />
        )}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

function InputRow({ label, value, onChange, max, symbol = 'SUSHI', hint }: {
  label: string; value: string; onChange: (v: string) => void
  max?: string; symbol?: string; hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[oklch(0.55_0.01_230)] font-medium">{label}</span>
        {max && (
          <button
            onClick={() => onChange(max)}
            className="text-[9px] font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            MAX {parseFloat(max).toFixed(4)}
          </button>
        )}
      </div>
      <div className="flex items-center rounded-xl border border-[oklch(0.26_0.025_245)] bg-[oklch(0.08_0.015_245)] overflow-hidden focus-within:border-red-500/50">
        <input
          type="number" min="0" step="any"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0.0000"
          className="flex-1 bg-transparent px-3 py-2.5 text-sm font-mono text-foreground outline-none"
        />
        <span className="px-3 text-xs font-bold text-[oklch(0.50_0.01_230)]">{symbol}</span>
      </div>
      {hint && <p className="text-[9px] text-[oklch(0.40_0.01_230)]">{hint}</p>}
    </div>
  )
}

// ─── Main Panel ─────────────────────────────────────────────────────────────

export function SushiV2Panel({ userAddress }: { userAddress: string }) {
  const [userInfo, setUserInfo]   = useState<UserSushiInfo | null>(null)
  const [stats, setStats]         = useState<GlobalSushiStats | null>(null)
  const [wQueue, setWQueue]       = useState<QueueEntry[]>([])
  const [cQueue, setCQueue]       = useState<QueueEntry[]>([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState('')

  // Form state
  const [stakeAmt, setStakeAmt]   = useState('')
  const [wdAmt, setWdAmt]         = useState('')
  const [fundAmt, setFundAmt]     = useState('')

  // Busy states
  const [busyStake, setBusyStake] = useState(false)
  const [busyWd,    setBusyWd]    = useState(false)
  const [busyClaim, setBusyClaim] = useState(false)
  const [busyFund,  setBusyFund]  = useState(false)
  const [busyTrig,  setBusyTrig]  = useState(false)

  // Owner admin
  const [newApr, setNewApr]       = useState('')
  const [newFee, setNewFee]       = useState('')
  const [busyApr, setBusyApr]     = useState(false)
  const [busyFeeSet, setBusyFeeSet] = useState(false)

  // ── WLD 2.0 staking state ─────────────────────────────────────────────────
  const [wldUserInfo, setWldUserInfo] = useState<UserWldInfo | null>(null)
  const [wldStats, setWldStats]       = useState<GlobalWldStats | null>(null)
  const [wldWQueue, setWldWQueue]     = useState<WldQueueEntry[]>([])
  const [wldCQueue, setWldCQueue]     = useState<WldQueueEntry[]>([])
  const [wldStakeAmt, setWldStakeAmt] = useState('')
  const [wldWdAmt, setWldWdAmt]       = useState('')
  const [wldFundAmt, setWldFundAmt]   = useState('')
  const [busyWldStake,  setBusyWldStake]  = useState(false)
  const [busyWldWd,     setBusyWldWd]     = useState(false)
  const [busyWldClaim,  setBusyWldClaim]  = useState(false)
  const [busyWldFund,   setBusyWldFund]   = useState(false)
  const [busyWldTrig,   setBusyWldTrig]   = useState(false)
  const [busyWldApr,    setBusyWldApr]    = useState(false)
  const [busyWldFeeSet, setBusyWldFeeSet] = useState(false)
  const [newWldApr, setNewWldApr]     = useState('')
  const [newWldFee, setNewWldFee]     = useState('')
  const [wldErr, setWldErr]           = useState('')

  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const isOwner2 = userAddress?.toLowerCase() === SUSHI_OWNER2.toLowerCase()
  const isDeployed = Boolean(SUSHI_CONTRACT)

  const load = useCallback(async () => {
    if (!isDeployed) { setLoading(false); return }
    try {
      const [u, g, wq, cq] = await Promise.all([
        fetchUserSushiInfo(userAddress),
        fetchGlobalSushiStats(),
        fetchWithdrawQueue(0, 30),
        fetchClaimQueue(0, 30),
      ])
      if (!mountedRef.current) return
      setUserInfo(u); setStats(g); setWQueue(wq); setCQueue(cq)
    } catch (e: any) {
      if (mountedRef.current) setErr(e?.message ?? 'Error cargando datos')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
    // WLD staking — independent, graceful degradation
    if (WLD_CONTRACT) {
      try {
        const [wu, wg, wwq, wcq] = await Promise.all([
          fetchUserWldInfo(userAddress),
          fetchGlobalWldStats(),
          fetchWldWithdrawQueue(0, 30),
          fetchWldClaimQueue(0, 30),
        ])
        if (mountedRef.current) {
          setWldUserInfo(wu); setWldStats(wg); setWldWQueue(wwq); setWldCQueue(wcq)
        }
      } catch { /* WLD not deployed yet */ }
    }
  }, [userAddress, isDeployed])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s
  useEffect(() => {
    if (!isDeployed) return
    const iv = setInterval(load, 30_000)
    return () => clearInterval(iv)
  }, [load, isDeployed])

  // ── Helpers ──────────────────────────────────────────────────────────────

  function parseWei(val: string): bigint {
    try { return ethers.parseUnits(val.trim() || '0', 18) } catch { return 0n }
  }

  async function sendTx(build: () => Parameters<typeof MiniKit.commandsAsync.sendTransaction>[0]) {
    const payload = build()
    const { finalPayload } = await MiniKit.commandsAsync.sendTransaction(payload)
    if (finalPayload.status !== 'success') throw new Error(finalPayload.error_code ?? 'tx failed')
    return (finalPayload as any).transaction_id as string
  }

  // ── Stake ────────────────────────────────────────────────────────────────

  async function doStake() {
    const gross = parseWei(stakeAmt)
    if (gross === 0n) return setErr('Ingresa un monto')
    const sushiFee = gross * BigInt(stats?.feeBps ?? 500) / 10_000n
    const net = gross - sushiFee
    if (net <= 0n) return setErr('Monto muy pequeño')
    setBusyStake(true); setErr('')
    try {
      const nonce = randNonce(); const dl = makeDeadline()
      await sendTx(() => ({
        transaction: [
          {
            address: SUSHI_CONTRACT,
            abi: STAKE_ABI,
            functionName: 'stake',
            args: [
              { permitted: { token: SUSHI_TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: dl.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
              gross.toString(),
            ],
          },
        ],
        permit2: [
          {
            permitted: { token: SUSHI_TOKEN, amount: gross.toString() },
            spender: SUSHI_CONTRACT,
            nonce: nonce.toString(),
            deadline: dl.toString(),
          },
        ],
      }))
      setStakeAmt('')
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Error en stake')
    } finally { setBusyStake(false) }
  }

  // ── Withdrawal Request ───────────────────────────────────────────────────

  async function doWithdraw() {
    const gross = parseWei(wdAmt)
    if (gross === 0n) return setErr('Ingresa un monto')
    const staked = userInfo?.staked ?? 0n
    if (gross > staked) return setErr('Monto mayor a tu stake')
    const today = todayDay()
    if (today <= (userInfo?.lastWithdrawDay ?? 0)) return setErr('Ya tienes un retiro solicitado hoy')
    if (userInfo?.hasWithdraw) return setErr('Ya tienes un retiro pendiente en cola')
    setBusyWd(true); setErr('')
    try {
      await sendTx(() => ({
        transaction: [
          {
            address: SUSHI_CONTRACT,
            abi: WITHDRAW_ABI,
            functionName: 'requestWithdrawal',
            args: [gross.toString()],
          },
        ],
      }))
      setWdAmt('')
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Error solicitando retiro')
    } finally { setBusyWd(false) }
  }

  // ── Claim Request ────────────────────────────────────────────────────────

  async function doClaim() {
    const rewards = userInfo?.rewards ?? 0n
    if (rewards === 0n) return setErr('Sin recompensas pendientes')
    const today = todayDay()
    if (today <= (userInfo?.lastClaimDay ?? 0)) return setErr('Ya tienes un reclamo solicitado hoy')
    if (userInfo?.hasClaim) return setErr('Ya tienes un reclamo pendiente en cola')
    setBusyClaim(true); setErr('')
    try {
      await sendTx(() => ({
        transaction: [
          {
            address: SUSHI_CONTRACT,
            abi: CLAIM_ABI,
            functionName: 'requestClaim',
            args: [],
          },
        ],
      }))
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Error solicitando reclamo')
    } finally { setBusyClaim(false) }
  }

  // ── Fund (owner2) ────────────────────────────────────────────────────────

  async function doFund() {
    const amount = parseWei(fundAmt)
    if (amount === 0n) return setErr('Ingresa un monto para fondear')
    setBusyFund(true); setErr('')
    try {
      const nonce = randNonce(); const dl = makeDeadline()
      await sendTx(() => ({
        transaction: [{
          address: SUSHI_CONTRACT,
          abi: FUND_ABI,
          functionName: 'fund',
          args: [
            { permitted: { token: SUSHI_TOKEN, amount: amount.toString() }, nonce: nonce.toString(), deadline: dl.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
            amount.toString(),
          ],
        }],
        permit2: [{
          permitted: { token: SUSHI_TOKEN, amount: amount.toString() },
          spender: SUSHI_CONTRACT,
          nonce: nonce.toString(),
          deadline: dl.toString(),
        }],
      }))
      setFundAmt('')
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Error fondeando contrato')
    } finally { setBusyFund(false) }
  }

  // ── Trigger queue ────────────────────────────────────────────────────────

  async function doTrigger() {
    setBusyTrig(true); setErr('')
    try {
      await sendTx(() => ({
        transaction: [{
          address: SUSHI_CONTRACT,
          abi: TRIGGER_ABI,
          functionName: 'triggerQueue',
          args: [],
        }],
        permit2: [],
      }))
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Error procesando cola')
    } finally { setBusyTrig(false) }
  }

  // ── Set APR ──────────────────────────────────────────────────────────────

  async function doSetApr() {
    const bps = Math.round(parseFloat(newApr) * 100)
    if (isNaN(bps) || bps <= 0) return setErr('APR inválido')
    setBusyApr(true); setErr('')
    try {
      await sendTx(() => ({
        transaction: [{
          address: SUSHI_CONTRACT,
          abi: SET_APR_ABI,
          functionName: 'setApr',
          args: [bps.toString()],
        }],
        permit2: [],
      }))
      setNewApr('')
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Error cambiando APR')
    } finally { setBusyApr(false) }
  }

  // ── Set Fee ──────────────────────────────────────────────────────────────

  async function doSetFee() {
    const bps = Math.round(parseFloat(newFee) * 100)
    if (isNaN(bps) || bps < 0) return setErr('Comisión inválida')
    setBusyFeeSet(true); setErr('')
    try {
      await sendTx(() => ({
        transaction: [{
          address: SUSHI_CONTRACT,
          abi: SET_FEE_ABI,
          functionName: 'setFee',
          args: [bps.toString()],
        }],
        permit2: [],
      }))
      setNewFee('')
      await load()
    } catch (e: any) {
      setErr(e?.message ?? 'Error cambiando comisión')
    } finally { setBusyFeeSet(false) }
  }

  // ── WLD action functions ─────────────────────────────────────────────────

  async function doWldStake() {
    const gross = parseWei(wldStakeAmt)
    if (gross === 0n) return setWldErr('Ingresa un monto')
    setBusyWldStake(true); setWldErr('')
    try {
      const nonce = randNonce(); const dl = makeDeadline()
      await sendTx(() => ({
        transaction: [
          {
            address: WLD_CONTRACT,
            abi: WLD_STAKE_ABI,
            functionName: 'stake',
            args: [
              { permitted: { token: WLD_TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: dl.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
              gross.toString(),
            ],
          },
        ],
        permit2: [
          {
            permitted: { token: WLD_TOKEN, amount: gross.toString() },
            spender: WLD_CONTRACT,
            nonce: nonce.toString(),
            deadline: dl.toString(),
          },
        ],
      }))
      setWldStakeAmt('')
      await load()
    } catch (e: any) {
      setWldErr(e?.message ?? 'Error en stake WLD')
    } finally { setBusyWldStake(false) }
  }

  async function doWldWithdraw() {
    const gross = parseWei(wldWdAmt)
    if (gross === 0n) return setWldErr('Ingresa un monto')
    setBusyWldWd(true); setWldErr('')
    try {
      await sendTx(() => ({
        transaction: [
          {
            address: WLD_CONTRACT,
            abi: WLD_WITHDRAW_ABI,
            functionName: 'requestWithdrawal',
            args: [gross.toString()],
          },
        ],
      }))
      setWldWdAmt('')
      await load()
    } catch (e: any) {
      setWldErr(e?.message ?? 'Error en retiro WLD')
    } finally { setBusyWldWd(false) }
  }

  async function doWldClaim() {
    setBusyWldClaim(true); setWldErr('')
    try {
      await sendTx(() => ({
        transaction: [
          { address: WLD_CONTRACT, abi: WLD_CLAIM_ABI, functionName: 'requestClaim', args: [] },
        ],
      }))
      await load()
    } catch (e: any) {
      setWldErr(e?.message ?? 'Error en reclamo WLD')
    } finally { setBusyWldClaim(false) }
  }

  async function doWldFund() {
    const amount = parseWei(wldFundAmt)
    if (amount === 0n) return setWldErr('Ingresa un monto')
    setBusyWldFund(true); setWldErr('')
    try {
      const nonce = randNonce(); const dl = makeDeadline()
      await sendTx(() => ({
        transaction: [{
          address: WLD_CONTRACT,
          abi: WLD_FUND_ABI,
          functionName: 'fund',
          args: [
            { permitted: { token: WLD_TOKEN, amount: amount.toString() }, nonce: nonce.toString(), deadline: dl.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
            amount.toString(),
          ],
        }],
        permit2: [{
          permitted: { token: WLD_TOKEN, amount: amount.toString() },
          spender: WLD_CONTRACT,
          nonce: nonce.toString(),
          deadline: dl.toString(),
        }],
      }))
      setWldFundAmt('')
      await load()
    } catch (e: any) {
      setWldErr(e?.message ?? 'Error fondeando WLD')
    } finally { setBusyWldFund(false) }
  }

  async function doWldTrigger() {
    setBusyWldTrig(true); setWldErr('')
    try {
      await sendTx(() => ({
        transaction: [{
          address: WLD_CONTRACT,
          abi: WLD_TRIGGER_ABI,
          functionName: 'triggerQueue',
          args: [],
        }],
        permit2: [],
      }))
      await load()
    } catch (e: any) {
      setWldErr(e?.message ?? 'Error procesando cola WLD')
    } finally { setBusyWldTrig(false) }
  }

  async function doWldSetApr() {
    const bps = Math.round(parseFloat(newWldApr) * 100)
    if (isNaN(bps) || bps <= 0) return setWldErr('APR inválido')
    setBusyWldApr(true); setWldErr('')
    try {
      await sendTx(() => ({
        transaction: [{
          address: WLD_CONTRACT,
          abi: WLD_SET_APR_ABI,
          functionName: 'setApr',
          args: [bps.toString()],
        }],
        permit2: [],
      }))
      setNewWldApr('')
      await load()
    } catch (e: any) {
      setWldErr(e?.message ?? 'Error cambiando APR WLD')
    } finally { setBusyWldApr(false) }
  }

  async function doWldSetFee() {
    const bps = Math.round(parseFloat(newWldFee) * 100)
    if (isNaN(bps) || bps < 0) return setWldErr('Comisión inválida')
    setBusyWldFeeSet(true); setWldErr('')
    try {
      await sendTx(() => ({
        transaction: [{
          address: WLD_CONTRACT,
          abi: WLD_SET_FEE_ABI,
          functionName: 'setFee',
          args: [bps.toString()],
        }],
        permit2: [],
      }))
      setNewWldFee('')
      await load()
    } catch (e: any) {
      setWldErr(e?.message ?? 'Error cambiando comisión WLD')
    } finally { setBusyWldFeeSet(false) }
  }

  // ── Derived values ───────────────────────────────────────────────────────

  const aprPct  = ((stats?.aprBps ?? 30000) / 100).toFixed(0)
  const feePct  = ((stats?.feeBps ?? 500) / 100).toFixed(1)
  const staked  = userInfo?.staked ?? 0n
  const rewards = userInfo?.rewards ?? 0n
  const sushiBal = userInfo?.sushiBal ?? 0n

  const today = todayDay()
  const canWithdraw = staked > 0n && !userInfo?.hasWithdraw && today > (userInfo?.lastWithdrawDay ?? 0)
  const canClaim    = rewards > 0n && !userInfo?.hasClaim  && today > (userInfo?.lastClaimDay ?? 0)

  // Unlock timestamps: next midnight after the last action day
  const wdLastDay  = userInfo?.lastWithdrawDay ?? 0
  const clLastDay  = userInfo?.lastClaimDay    ?? 0
  const withdrawUnlockTs = wdLastDay > 0 ? (wdLastDay + 1) * 86400 : null
  const claimUnlockTs    = clLastDay > 0 ? (clLastDay + 1) * 86400 : null

  // Countdowns (hooks must be at component top level)
  const wdCd = useCountdown(withdrawUnlockTs, 86400)
  const clCd = useCountdown(claimUnlockTs,    86400)

  const pendingWithdraw = stats?.totalPendingWithdrawals ?? 0n
  const pendingClaim    = stats?.totalPendingClaims ?? 0n
  const fundPool        = stats?.fundPool ?? 0n

  // ── WLD derived values ───────────────────────────────────────────────────

  const wldAprPct   = ((wldStats?.aprBps ?? 10000) / 100).toFixed(0)
  const wldFeePct   = ((wldStats?.feeBps ?? 500) / 100).toFixed(1)
  const wldStaked   = wldUserInfo?.staked ?? 0n
  const wldRewards  = wldUserInfo?.rewards ?? 0n
  const wldBal      = wldUserInfo?.wldBal ?? 0n
  const isWldOwner2 = userAddress?.toLowerCase() === WLD_OWNER2.toLowerCase()

  const wldCanWithdraw = wldStaked > 0n && !wldUserInfo?.hasWithdraw && today > (wldUserInfo?.lastWithdrawDay ?? 0)
  const wldCanClaim    = wldRewards > 0n && !wldUserInfo?.hasClaim   && today > (wldUserInfo?.lastClaimDay ?? 0)

  const wldWdLastDay = wldUserInfo?.lastWithdrawDay ?? 0
  const wldClLastDay = wldUserInfo?.lastClaimDay    ?? 0
  const wldWithdrawUnlockTs = wldWdLastDay > 0 ? (wldWdLastDay + 1) * 86400 : null
  const wldClaimUnlockTs    = wldClLastDay > 0 ? (wldClLastDay + 1) * 86400 : null

  // WLD countdowns — hooks must be unconditional at component top level
  const wldWdCd = useCountdown(wldWithdrawUnlockTs, 86400)
  const wldClCd = useCountdown(wldClaimUnlockTs,    86400)

  const wldFundPool       = wldStats?.fundPool ?? 0n
  const wldPendingWithdraw = wldStats?.totalPendingWithdrawals ?? 0n
  const wldPendingClaim    = wldStats?.totalPendingClaims ?? 0n

  // ── Render ───────────────────────────────────────────────────────────────

  if (!isDeployed) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
          style={{ background: `${SUSHI_COLOR}20`, border: `1.5px solid ${SUSHI_COLOR}40` }}>
          🍣
        </div>
        <div>
          <h2 className="text-lg font-black text-foreground">SUSHI 2.0</h2>
          <p className="text-xs text-[oklch(0.50_0.01_230)] mt-1">Contrato desplegándose en World Chain…</p>
        </div>
        <div className="text-[10px] font-mono text-[oklch(0.40_0.01_230)] border border-[oklch(0.22_0.025_245)] rounded-lg px-3 py-2 bg-[oklch(0.10_0.018_245)]">
          Token: {SUSHI_TOKEN.slice(0, 12)}…{SUSHI_TOKEN.slice(-6)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-6">

      {/* ── Hero Banner ──────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a0a0a 0%, #2d0b0b 50%, #1a0505 100%)', border: `1.5px solid ${SUSHI_COLOR}40` }}>
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'repeating-linear-gradient(45deg, #e84142 0, #e84142 1px, transparent 0, transparent 50%)', backgroundSize: '8px 8px' }} />
        <div className="relative p-4 flex flex-col gap-3">
          {/* Top row */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                style={{ background: `${SUSHI_COLOR}25`, border: `1.5px solid ${SUSHI_COLOR}60` }}>
                🍣
              </div>
              <div>
                <p className="text-base font-black text-foreground tracking-wide leading-tight">SUSHI 2.0</p>
                <p className="text-[9px] font-mono mt-0.5" style={{ color: SUSHI_COLOR }}>
                  {SUSHI_CONTRACT.slice(0, 10)}…{SUSHI_CONTRACT.slice(-6)}
                </p>
              </div>
            </div>
            <div className="text-right flex items-end gap-3">
              <div className="text-center">
                <p className="text-2xl font-black leading-none" style={{ color: SUSHI_COLOR }}>{aprPct}%</p>
                <p className="text-[8px] font-bold text-[oklch(0.50_0.01_230)] uppercase tracking-wider">🍣 SUSHI</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black leading-none text-blue-400">{wldAprPct}%</p>
                <p className="text-[8px] font-bold text-[oklch(0.50_0.01_230)] uppercase tracking-wider">🌍 WLD</p>
              </div>
            </div>
          </div>

          {/* APR badge row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold px-2 py-1 rounded-full"
              style={{ background: `${SUSHI_COLOR}20`, color: SUSHI_COLOR, border: `1px solid ${SUSHI_COLOR}40` }}>
              ⚡ {aprPct}% APR FIJO
            </span>
            <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
              🕐 Retiro 48h
            </span>
            <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">
              💰 Reclamo 24h
            </span>
            <span className="text-[9px] font-bold px-2 py-1 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
              🔑 Permit2
            </span>
          </div>

          {/* User balance row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(232,65,66,0.08)', border: '1px solid rgba(232,65,66,0.20)' }}>
              <p className="text-[8px] text-[oklch(0.45_0.01_230)] uppercase">Wallet</p>
              <p className="text-sm font-black font-mono text-foreground">{fmtSushiShort(sushiBal)}</p>
              <p className="text-[8px] text-[oklch(0.40_0.01_230)]">SUSHI</p>
            </div>
            <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(232,65,66,0.08)', border: '1px solid rgba(232,65,66,0.20)' }}>
              <p className="text-[8px] text-[oklch(0.45_0.01_230)] uppercase">Stakeado</p>
              <p className="text-sm font-black font-mono" style={{ color: SUSHI_COLOR }}>{fmtSushiShort(staked)}</p>
              <p className="text-[8px] text-[oklch(0.40_0.01_230)]">SUSHI</p>
            </div>
            <div className="rounded-lg p-2 text-center" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.20)' }}>
              <p className="text-[8px] text-[oklch(0.45_0.01_230)] uppercase">Ganancias</p>
              <p className="text-sm font-black font-mono text-green-400">{fmtSushiShort(rewards)}</p>
              <p className="text-[8px] text-[oklch(0.40_0.01_230)]">SUSHI</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{err}</p>
          <button onClick={() => setErr('')} className="ml-auto text-red-400 text-[10px] shrink-0">✕</button>
        </div>
      )}

      {/* ── Global stats row ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: SUSHI_COLOR }} />
        </div>
      ) : (
        <div className="flex gap-2">
          <StatCard
            label="Total Staked"
            value={fmtSushiShort(stats?.totalStaked ?? 0n)}
            sub={`${stats?.stakerCount ?? 0} usuarios`}
            color="text-foreground"
            icon={<Users className="w-3 h-3" />}
          />
          <StatCard
            label="Fondo"
            value={fmtSushiShort(fundPool)}
            sub="disponible pagos"
            color={fundPool >= pendingWithdraw + pendingClaim ? 'text-green-400' : 'text-amber-400'}
            icon={<CircleDollarSign className="w-3 h-3" />}
          />
          <StatCard
            label="En Cola"
            value={fmtSushiShort(pendingWithdraw + pendingClaim)}
            sub={`${(stats?.withdrawQueueLen ?? 0) - (stats?.nextWithdrawIdx ?? 0) + (stats?.claimQueueLen ?? 0) - (stats?.nextClaimIdx ?? 0)} solicitudes`}
            color="text-amber-400"
            icon={<Clock className="w-3 h-3" />}
          />
        </div>
      )}

      {/* ── User pending requests status ─────────────────────────────────── */}
      {userInfo && (userInfo.hasWithdraw || userInfo.hasClaim) && (
        <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] divide-y divide-[oklch(0.18_0.02_245)]">
          {userInfo.hasWithdraw && userInfo.withdrawReq && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                userInfo.withdrawReq.paid ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400',
              )}>
                <ArrowDownToLine className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground">Retiro en cola</p>
                <p className="text-[10px] text-[oklch(0.45_0.01_230)] font-mono">
                  {fmtSushi(userInfo.withdrawReq.netAmount, 4)} SUSHI neto
                </p>
              </div>
              <div className="text-right shrink-0">
                {userInfo.withdrawReq.paid ? (
                  <span className="text-[10px] font-bold text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Pagado
                  </span>
                ) : (
                  <div>
                    <p className="text-[10px] font-bold text-amber-400">
                      {fmtCountdown(userInfo.withdrawReq.readyAt)}
                    </p>
                    <p className="text-[8px] text-[oklch(0.40_0.01_230)]">Posición #{userInfo.withdrawPos}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          {userInfo.hasClaim && userInfo.claimReq && (
            <div className="px-4 py-3 flex items-center gap-3">
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                userInfo.claimReq.paid ? 'bg-green-500/15 text-green-400' : 'bg-purple-500/15 text-purple-400',
              )}>
                <Gift className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-foreground">Reclamo en cola</p>
                <p className="text-[10px] text-[oklch(0.45_0.01_230)] font-mono">
                  {fmtSushi(userInfo.claimReq.netAmount, 4)} SUSHI neto
                </p>
              </div>
              <div className="text-right shrink-0">
                {userInfo.claimReq.paid ? (
                  <span className="text-[10px] font-bold text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Pagado
                  </span>
                ) : (
                  <div>
                    <p className="text-[10px] font-bold text-purple-400">
                      {fmtCountdown(userInfo.claimReq.readyAt)}
                    </p>
                    <p className="text-[8px] text-[oklch(0.40_0.01_230)]">Posición #{userInfo.claimPos}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Stake Form ───────────────────────────────────────────────────── */}
      <SectionCard title="Depositar SUSHI" badge={`APR ${aprPct}%`}>
        <div className="flex flex-col gap-3">
          <InputRow
            label={`Cantidad a depositar (comisión ${feePct}%)`}
            value={stakeAmt}
            onChange={setStakeAmt}
            max={sushiBal > 0n ? fmtSushi(sushiBal, 6) : undefined}
            hint={stakeAmt && parseWei(stakeAmt) > 0n
              ? `Recibirás ${fmtSushi(parseWei(stakeAmt) - parseWei(stakeAmt) * BigInt(stats?.feeBps ?? 500) / 10_000n, 4)} SUSHI en stake · APR ${aprPct}%`
              : 'Los tokens van directo a custodia segura'}
          />
          <div className="rounded-lg border border-[oklch(0.22_0.025_245)] bg-[oklch(0.08_0.015_245)] px-3 py-2 flex items-center gap-2">
            <Info className="w-3 h-3 text-[oklch(0.45_0.01_230)] shrink-0" />
            <p className="text-[9px] text-[oklch(0.45_0.01_230)]">
              Tus SUSHI generan <strong className="text-foreground">{aprPct}% APR</strong> anual. Retiros después de 48h · Reclamos después de 24h.
            </p>
          </div>
          <button
            onClick={doStake}
            disabled={busyStake || !stakeAmt}
            className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{ background: busyStake ? 'rgba(232,65,66,0.3)' : SUSHI_COLOR, color: 'white', boxShadow: busyStake ? 'none' : `0 0 18px ${SUSHI_COLOR}55` }}
          >
            {busyStake ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpFromLine className="w-4 h-4" />}
            {busyStake ? 'Procesando…' : 'Depositar SUSHI'}
          </button>
        </div>
      </SectionCard>

      {/* ── Withdrawal Request ───────────────────────────────────────────── */}
      <SectionCard title="Solicitar Retiro" collapsible defaultOpen={staked > 0n}>
        <div className="flex flex-col gap-3">
          {!canWithdraw && staked > 0n && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="w-3 h-3 text-amber-400 shrink-0 animate-pulse" />
                <p className="text-[9px] text-amber-300">
                  {userInfo?.hasWithdraw
                    ? 'Retiro ya en cola de espera.'
                    : 'Un retiro por día.'}
                </p>
              </div>
              {!userInfo?.hasWithdraw && !wdCd.ready && (
                <span className="text-[10px] font-mono font-bold text-amber-400 shrink-0">
                  {wdCd.label}
                </span>
              )}
            </div>
          )}
          {staked === 0n && (
            <p className="text-[10px] text-[oklch(0.40_0.01_230)] text-center py-2">Sin saldo stakeado</p>
          )}
          {staked > 0n && (
            <InputRow
              label={`Cantidad a retirar (comisión ${feePct}%)`}
              value={wdAmt}
              onChange={setWdAmt}
              max={fmtSushi(staked, 6)}
              hint={wdAmt && parseWei(wdAmt) > 0n
                ? `Recibirás ${fmtSushi(parseWei(wdAmt) - parseWei(wdAmt) * BigInt(stats?.feeBps ?? 500) / 10_000n, 4)} SUSHI · Espera: 48h`
                : 'El retiro se pone en la cola de espera de 48 horas'}
            />
          )}
          <button
            onClick={doWithdraw}
            disabled={busyWd || !canWithdraw || !wdAmt}
            className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 border"
            style={{ borderColor: `${SUSHI_COLOR}50`, color: SUSHI_COLOR, background: `${SUSHI_COLOR}10` }}
          >
            {busyWd
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando…</>
              : !canWithdraw && !wdCd.ready && staked > 0n && !userInfo?.hasWithdraw
                ? <><Clock className="w-4 h-4 animate-pulse" /> Disponible en {wdCd.label}</>
                : <><ArrowDownToLine className="w-4 h-4" /> Solicitar Retiro (48h)</>
            }
          </button>
        </div>
      </SectionCard>

      {/* ── Claim Request ────────────────────────────────────────────────── */}
      <SectionCard title="Solicitar Reclamo" collapsible defaultOpen={rewards > 0n}>
        <div className="flex flex-col gap-3">
          {!canClaim && rewards > 0n && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-purple-500/25 bg-purple-500/8 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Lock className="w-3 h-3 text-purple-400 shrink-0 animate-pulse" />
                <p className="text-[9px] text-purple-300">
                  {userInfo?.hasClaim
                    ? 'Reclamo ya en cola de espera.'
                    : 'Un reclamo por día.'}
                </p>
              </div>
              {!userInfo?.hasClaim && !clCd.ready && (
                <span className="text-[10px] font-mono font-bold text-purple-400 shrink-0">
                  {clCd.label}
                </span>
              )}
            </div>
          )}
          <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.08_0.015_245)] p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/25 flex items-center justify-center shrink-0">
              <Gift className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Recompensas acumuladas</p>
              <p className="text-base font-black font-mono text-green-400">{fmtSushi(rewards, 6)} SUSHI</p>
              {rewards > 0n && stats && (
                <p className="text-[9px] text-[oklch(0.40_0.01_230)]">
                  Neto tras comisión: {fmtSushi(rewards - rewards * BigInt(stats.feeBps) / 10_000n, 4)} SUSHI
                </p>
              )}
            </div>
          </div>
          <button
            onClick={doClaim}
            disabled={busyClaim || !canClaim}
            className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 border"
            style={{ borderColor: 'rgba(34,197,94,0.40)', color: '#22c55e', background: 'rgba(34,197,94,0.10)' }}
          >
            {busyClaim
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando…</>
              : !canClaim && !clCd.ready && rewards > 0n && !userInfo?.hasClaim
                ? <><Clock className="w-4 h-4 animate-pulse" /> Disponible en {clCd.label}</>
                : <><Gift className="w-4 h-4" /> Solicitar Reclamo (24h) · {fmtSushi(rewards, 2)} SUSHI</>
            }
          </button>
        </div>
      </SectionCard>

      {/* ── Owner Panel: Fund + Trigger ──────────────────────────────────── */}
      {isOwner2 && (
        <SectionCard title="Panel Owner — Fondear Contrato" badge="OWNER">
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3 py-2 text-[10px] text-blue-300 flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <strong>Fondo actual:</strong> {fmtSushi(fundPool, 4)} SUSHI<br/>
                <strong>Pendiente retiros:</strong> {fmtSushi(pendingWithdraw, 4)} SUSHI<br/>
                <strong>Pendiente reclamos:</strong> {fmtSushi(pendingClaim, 4)} SUSHI<br/>
                <strong>Total a fondear:</strong> {fmtSushi(pendingWithdraw + pendingClaim, 4)} SUSHI
              </div>
            </div>
            <InputRow
              label="Cantidad a fondear (via Permit2)"
              value={fundAmt}
              onChange={setFundAmt}
              hint="Los SUSHI se transfieren al contrato para pagar la cola"
            />
            <button
              onClick={doFund}
              disabled={busyFund || !fundAmt}
              className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              style={{ background: 'rgba(59,130,246,0.85)', color: 'white', boxShadow: '0 0 14px rgba(59,130,246,0.40)' }}
            >
              {busyFund ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
              {busyFund ? 'Fondeando…' : 'Fondear Contrato'}
            </button>
            <button
              onClick={doTrigger}
              disabled={busyTrig}
              className="w-full h-9 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 border border-[oklch(0.30_0.025_245)]"
              style={{ color: 'oklch(0.70 0.01 230)', background: 'oklch(0.14 0.018 245)' }}
            >
              {busyTrig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              {busyTrig ? 'Procesando cola…' : 'Procesar Cola Manualmente'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* ── Owner Config ─────────────────────────────────────────────────── */}
      {isOwner2 && (
        <SectionCard title="Configurar APR & Comisiones" collapsible defaultOpen={false} badge="OWNER">
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <InputRow label={`APR actual: ${aprPct}%`} value={newApr} onChange={setNewApr} symbol="%" hint="Ej: 300 para 300% APR" />
              </div>
              <button
                onClick={doSetApr}
                disabled={busyApr || !newApr}
                className="self-end h-10 px-3 rounded-xl font-bold text-xs flex items-center gap-1 disabled:opacity-50 transition-all"
                style={{ background: `${SUSHI_COLOR}20`, color: SUSHI_COLOR, border: `1px solid ${SUSHI_COLOR}40` }}
              >
                {busyApr ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                Guardar
              </button>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <InputRow label={`Comisión actual: ${feePct}%`} value={newFee} onChange={setNewFee} symbol="%" hint="Ej: 5 para 5% comisión" />
              </div>
              <button
                onClick={doSetFee}
                disabled={busyFeeSet || !newFee}
                className="self-end h-10 px-3 rounded-xl font-bold text-xs flex items-center gap-1 disabled:opacity-50 transition-all"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }}
              >
                {busyFeeSet ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                Guardar
              </button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── Withdrawal Queue ─────────────────────────────────────────────── */}
      <SectionCard title="Cola de Retiros" collapsible defaultOpen={false}>
        <div className="flex flex-col">
          {wQueue.length === 0 ? (
            <p className="text-[10px] text-[oklch(0.40_0.01_230)] text-center py-2">Sin retiros en cola</p>
          ) : (
            wQueue.map((entry, i) => <QueueRow key={i} entry={entry} idx={i} type="withdraw" />)
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[9px] text-[oklch(0.40_0.01_230)]">
            {stats?.withdrawQueueLen ?? 0} total · {Math.max(0, (stats?.withdrawQueueLen ?? 0) - (stats?.nextWithdrawIdx ?? 0))} pendientes
          </p>
          <button onClick={load} className="flex items-center gap-1 text-[9px] text-[oklch(0.45_0.01_230)] hover:text-foreground transition-colors">
            <RefreshCw className="w-2.5 h-2.5" /> Actualizar
          </button>
        </div>
      </SectionCard>

      {/* ── Claim Queue ──────────────────────────────────────────────────── */}
      <SectionCard title="Cola de Reclamos" collapsible defaultOpen={false}>
        <div className="flex flex-col">
          {cQueue.length === 0 ? (
            <p className="text-[10px] text-[oklch(0.40_0.01_230)] text-center py-2">Sin reclamos en cola</p>
          ) : (
            cQueue.map((entry, i) => <QueueRow key={i} entry={entry} idx={i} type="claim" />)
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[9px] text-[oklch(0.40_0.01_230)]">
            {stats?.claimQueueLen ?? 0} total · {Math.max(0, (stats?.claimQueueLen ?? 0) - (stats?.nextClaimIdx ?? 0))} pendientes
          </p>
          <button onClick={load} className="flex items-center gap-1 text-[9px] text-[oklch(0.45_0.01_230)] hover:text-foreground transition-colors">
            <RefreshCw className="w-2.5 h-2.5" /> Actualizar
          </button>
        </div>
      </SectionCard>

      {/* ════════════════════════════════════════════════════════════════════
           WLD 2.0 STAKING SECTION
          ════════════════════════════════════════════════════════════════════ */}

      {/* ── WLD Divider ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 py-1">
        <div className="flex-1 h-px bg-[oklch(0.22_0.025_245)]" />
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30">
          <span className="text-base">🌍</span>
          <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">WLD 2.0 Staking</span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300">{wldAprPct}% APR</span>
        </div>
        <div className="flex-1 h-px bg-[oklch(0.22_0.025_245)]" />
      </div>

      {/* ── WLD not deployed notice ───────────────────────────────────────── */}
      {!WLD_CONTRACT && (
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">🌍</span>
          <div>
            <p className="text-xs font-bold text-blue-300">WLD 2.0 — En preparación</p>
            <p className="text-[10px] text-[oklch(0.45_0.01_230)] mt-0.5">Contrato desplegándose en World Chain · {wldAprPct}% APR fijo</p>
            <p className="text-[9px] font-mono text-[oklch(0.40_0.01_230)] mt-0.5">{WLD_TOKEN.slice(0, 12)}…{WLD_TOKEN.slice(-6)}</p>
          </div>
        </div>
      )}

      {/* ── WLD error banner ─────────────────────────────────────────────── */}
      {wldErr && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300">{wldErr}</p>
          <button onClick={() => setWldErr('')} className="ml-auto text-red-400 text-[10px] shrink-0">✕</button>
        </div>
      )}

      {WLD_CONTRACT && (
        <>
          {/* ── WLD Global stats ───────────────────────────────────────────── */}
          <div className="flex gap-2">
            <StatCard
              label="WLD Staked"
              value={fmtWldShort(wldStats?.totalStaked ?? 0n)}
              sub={`${wldStats?.stakerCount ?? 0} usuarios`}
              color="text-foreground"
              icon={<Users className="w-3 h-3" />}
            />
            <StatCard
              label="Fondo WLD"
              value={fmtWldShort(wldFundPool)}
              sub="disponible pagos"
              color={wldFundPool >= wldPendingWithdraw + wldPendingClaim ? 'text-green-400' : 'text-amber-400'}
              icon={<CircleDollarSign className="w-3 h-3" />}
            />
            <StatCard
              label="Cola WLD"
              value={fmtWldShort(wldPendingWithdraw + wldPendingClaim)}
              sub={`${(wldStats?.withdrawQueueLen ?? 0) - (wldStats?.nextWithdrawIdx ?? 0) + (wldStats?.claimQueueLen ?? 0) - (wldStats?.nextClaimIdx ?? 0)} solicitudes`}
              color="text-amber-400"
              icon={<Clock className="w-3 h-3" />}
            />
          </div>

          {/* ── WLD User pending requests ──────────────────────────────────── */}
          {wldUserInfo && (wldUserInfo.hasWithdraw || wldUserInfo.hasClaim) && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 divide-y divide-blue-500/15">
              {wldUserInfo.hasWithdraw && wldUserInfo.withdrawReq && (
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0', wldUserInfo.withdrawReq.paid ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400')}>
                    <ArrowDownToLine className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground">Retiro WLD en cola</p>
                    <p className="text-[10px] text-[oklch(0.45_0.01_230)] font-mono">{fmtWld(wldUserInfo.withdrawReq.netAmount, 4)} WLD neto</p>
                  </div>
                  <div className="text-right shrink-0">
                    {wldUserInfo.withdrawReq.paid
                      ? <span className="text-[10px] font-bold text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Pagado</span>
                      : <div>
                          <p className="text-[10px] font-bold text-amber-400">{fmtCountdown(wldUserInfo.withdrawReq.readyAt)}</p>
                          <p className="text-[8px] text-[oklch(0.40_0.01_230)]">Posición #{wldUserInfo.withdrawPos}</p>
                        </div>
                    }
                  </div>
                </div>
              )}
              {wldUserInfo.hasClaim && wldUserInfo.claimReq && (
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0', wldUserInfo.claimReq.paid ? 'bg-green-500/15 text-green-400' : 'bg-purple-500/15 text-purple-400')}>
                    <Gift className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground">Reclamo WLD en cola</p>
                    <p className="text-[10px] text-[oklch(0.45_0.01_230)] font-mono">{fmtWld(wldUserInfo.claimReq.netAmount, 4)} WLD neto</p>
                  </div>
                  <div className="text-right shrink-0">
                    {wldUserInfo.claimReq.paid
                      ? <span className="text-[10px] font-bold text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Pagado</span>
                      : <div>
                          <p className="text-[10px] font-bold text-purple-400">{fmtCountdown(wldUserInfo.claimReq.readyAt)}</p>
                          <p className="text-[8px] text-[oklch(0.40_0.01_230)]">Posición #{wldUserInfo.claimPos}</p>
                        </div>
                    }
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── WLD Stake Form ─────────────────────────────────────────────── */}
          <SectionCard title="Depositar WLD" badge={`APR ${wldAprPct}%`}>
            <div className="flex flex-col gap-3">
              <InputRow
                label={`Cantidad a depositar (comisión ${wldFeePct}%)`}
                value={wldStakeAmt}
                onChange={setWldStakeAmt}
                max={wldBal > 0n ? fmtWld(wldBal, 6) : undefined}
                hint={wldStakeAmt && parseWei(wldStakeAmt) > 0n
                  ? `Recibirás ${fmtWld(parseWei(wldStakeAmt) - parseWei(wldStakeAmt) * BigInt(wldStats?.feeBps ?? 500) / 10_000n, 4)} WLD en stake · APR ${wldAprPct}%`
                  : 'Los tokens van directo a custodia segura'}
              />
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 flex items-center gap-2">
                <Info className="w-3 h-3 text-blue-400 shrink-0" />
                <p className="text-[9px] text-blue-300">
                  Tus WLD generan <strong className="text-foreground">{wldAprPct}% APR</strong> anual. Retiros después de 48h · Reclamos después de 24h.
                </p>
              </div>
              <button
                onClick={doWldStake}
                disabled={busyWldStake || !wldStakeAmt}
                className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                style={{ background: busyWldStake ? 'rgba(59,130,246,0.3)' : '#2563eb', color: 'white', boxShadow: busyWldStake ? 'none' : '0 0 18px rgba(37,99,235,0.55)' }}
              >
                {busyWldStake ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpFromLine className="w-4 h-4" />}
                {busyWldStake ? 'Procesando…' : 'Depositar WLD'}
              </button>
            </div>
          </SectionCard>

          {/* ── WLD Withdrawal Request ─────────────────────────────────────── */}
          <SectionCard title="Solicitar Retiro WLD" collapsible defaultOpen={wldStaked > 0n}>
            <div className="flex flex-col gap-3">
              {!wldCanWithdraw && wldStaked > 0n && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock className="w-3 h-3 text-amber-400 shrink-0 animate-pulse" />
                    <p className="text-[9px] text-amber-300">
                      {wldUserInfo?.hasWithdraw ? 'Retiro ya en cola de espera.' : 'Un retiro por día.'}
                    </p>
                  </div>
                  {!wldUserInfo?.hasWithdraw && !wldWdCd.ready && (
                    <span className="text-[10px] font-mono font-bold text-amber-400 shrink-0">{wldWdCd.label}</span>
                  )}
                </div>
              )}
              {wldStaked === 0n && (
                <p className="text-[10px] text-[oklch(0.40_0.01_230)] text-center py-2">Sin saldo WLD stakeado</p>
              )}
              {wldStaked > 0n && (
                <InputRow
                  label={`Cantidad a retirar (comisión ${wldFeePct}%)`}
                  value={wldWdAmt}
                  onChange={setWldWdAmt}
                  max={fmtWld(wldStaked, 6)}
                  hint={wldWdAmt && parseWei(wldWdAmt) > 0n
                    ? `Recibirás ${fmtWld(parseWei(wldWdAmt) - parseWei(wldWdAmt) * BigInt(wldStats?.feeBps ?? 500) / 10_000n, 4)} WLD · Espera: 48h`
                    : 'El retiro se pone en la cola de espera de 48 horas'}
                />
              )}
              <button
                onClick={doWldWithdraw}
                disabled={busyWldWd || !wldCanWithdraw || !wldWdAmt}
                className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 border"
                style={{ borderColor: 'rgba(59,130,246,0.50)', color: '#60a5fa', background: 'rgba(59,130,246,0.10)' }}
              >
                {busyWldWd
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando…</>
                  : !wldCanWithdraw && !wldWdCd.ready && wldStaked > 0n && !wldUserInfo?.hasWithdraw
                    ? <><Clock className="w-4 h-4 animate-pulse" /> Disponible en {wldWdCd.label}</>
                    : <><ArrowDownToLine className="w-4 h-4" /> Solicitar Retiro WLD (48h)</>
                }
              </button>
            </div>
          </SectionCard>

          {/* ── WLD Claim Request ──────────────────────────────────────────── */}
          <SectionCard title="Solicitar Reclamo WLD" collapsible defaultOpen={wldRewards > 0n}>
            <div className="flex flex-col gap-3">
              {!wldCanClaim && wldRewards > 0n && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-purple-500/25 bg-purple-500/8 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Lock className="w-3 h-3 text-purple-400 shrink-0 animate-pulse" />
                    <p className="text-[9px] text-purple-300">
                      {wldUserInfo?.hasClaim ? 'Reclamo ya en cola de espera.' : 'Un reclamo por día.'}
                    </p>
                  </div>
                  {!wldUserInfo?.hasClaim && !wldClCd.ready && (
                    <span className="text-[10px] font-mono font-bold text-purple-400 shrink-0">{wldClCd.label}</span>
                  )}
                </div>
              )}
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-green-500/15 border border-green-500/25 flex items-center justify-center shrink-0">
                  <Gift className="w-4 h-4 text-green-400" />
                </div>
                <div>
                  <p className="text-[10px] text-[oklch(0.45_0.01_230)]">Recompensas WLD acumuladas</p>
                  <p className="text-base font-black font-mono text-green-400">{fmtWld(wldRewards, 6)} WLD</p>
                  {wldRewards > 0n && wldStats && (
                    <p className="text-[9px] text-[oklch(0.40_0.01_230)]">
                      Neto: {fmtWld(wldRewards - wldRewards * BigInt(wldStats.feeBps) / 10_000n, 4)} WLD
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={doWldClaim}
                disabled={busyWldClaim || !wldCanClaim}
                className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 border"
                style={{ borderColor: 'rgba(34,197,94,0.40)', color: '#22c55e', background: 'rgba(34,197,94,0.10)' }}
              >
                {busyWldClaim
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Procesando…</>
                  : !wldCanClaim && !wldClCd.ready && wldRewards > 0n && !wldUserInfo?.hasClaim
                    ? <><Clock className="w-4 h-4 animate-pulse" /> Disponible en {wldClCd.label}</>
                    : <><Gift className="w-4 h-4" /> Solicitar Reclamo WLD (24h) · {fmtWld(wldRewards, 2)} WLD</>
                }
              </button>
            </div>
          </SectionCard>

          {/* ── WLD Owner Panel ────────────────────────────────────────────── */}
          {isWldOwner2 && (
            <SectionCard title="Panel Owner — Fondear WLD" badge="OWNER">
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3 py-2 text-[10px] text-blue-300 flex items-start gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    <strong>Fondo WLD:</strong> {fmtWld(wldFundPool, 4)} WLD<br/>
                    <strong>Pendiente retiros:</strong> {fmtWld(wldPendingWithdraw, 4)} WLD<br/>
                    <strong>Pendiente reclamos:</strong> {fmtWld(wldPendingClaim, 4)} WLD
                  </div>
                </div>
                <InputRow label="Cantidad a fondear WLD (via Permit2)" value={wldFundAmt} onChange={setWldFundAmt} hint="Los WLD se transfieren al contrato para pagar la cola" />
                <button
                  onClick={doWldFund}
                  disabled={busyWldFund || !wldFundAmt}
                  className="w-full h-11 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: 'rgba(37,99,235,0.85)', color: 'white', boxShadow: '0 0 14px rgba(37,99,235,0.40)' }}
                >
                  {busyWldFund ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                  {busyWldFund ? 'Fondeando…' : 'Fondear Contrato WLD'}
                </button>
                <button
                  onClick={doWldTrigger}
                  disabled={busyWldTrig}
                  className="w-full h-9 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 border border-[oklch(0.30_0.025_245)]"
                  style={{ color: 'oklch(0.70 0.01 230)', background: 'oklch(0.14 0.018 245)' }}
                >
                  {busyWldTrig ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  {busyWldTrig ? 'Procesando cola…' : 'Procesar Cola WLD'}
                </button>
              </div>
            </SectionCard>
          )}

          {/* ── WLD Config ─────────────────────────────────────────────────── */}
          {isWldOwner2 && (
            <SectionCard title="Configurar APR & Comisiones WLD" collapsible defaultOpen={false} badge="OWNER">
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <InputRow label={`APR actual: ${wldAprPct}%`} value={newWldApr} onChange={setNewWldApr} symbol="%" hint="Ej: 100 para 100% APR" />
                  </div>
                  <button
                    onClick={doWldSetApr}
                    disabled={busyWldApr || !newWldApr}
                    className="self-end h-10 px-3 rounded-xl font-bold text-xs flex items-center gap-1 disabled:opacity-50 transition-all"
                    style={{ background: 'rgba(37,99,235,0.20)', color: '#60a5fa', border: '1px solid rgba(37,99,235,0.40)' }}
                  >
                    {busyWldApr ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                    Guardar
                  </button>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <InputRow label={`Comisión actual: ${wldFeePct}%`} value={newWldFee} onChange={setNewWldFee} symbol="%" hint="Ej: 5 para 5% comisión" />
                  </div>
                  <button
                    onClick={doWldSetFee}
                    disabled={busyWldFeeSet || !newWldFee}
                    className="self-end h-10 px-3 rounded-xl font-bold text-xs flex items-center gap-1 disabled:opacity-50 transition-all"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }}
                  >
                    {busyWldFeeSet ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
                    Guardar
                  </button>
                </div>
              </div>
            </SectionCard>
          )}

          {/* ── WLD Queues ─────────────────────────────────────────────────── */}
          <SectionCard title="Cola de Retiros WLD" collapsible defaultOpen={false}>
            <div className="flex flex-col">
              {wldWQueue.length === 0
                ? <p className="text-[10px] text-[oklch(0.40_0.01_230)] text-center py-2">Sin retiros WLD en cola</p>
                : wldWQueue.map((entry, i) => <QueueRow key={i} entry={entry} idx={i} type="withdraw" />)
              }
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[9px] text-[oklch(0.40_0.01_230)]">
                {wldStats?.withdrawQueueLen ?? 0} total · {Math.max(0, (wldStats?.withdrawQueueLen ?? 0) - (wldStats?.nextWithdrawIdx ?? 0))} pendientes
              </p>
              <button onClick={load} className="flex items-center gap-1 text-[9px] text-[oklch(0.45_0.01_230)] hover:text-foreground transition-colors">
                <RefreshCw className="w-2.5 h-2.5" /> Actualizar
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Cola de Reclamos WLD" collapsible defaultOpen={false}>
            <div className="flex flex-col">
              {wldCQueue.length === 0
                ? <p className="text-[10px] text-[oklch(0.40_0.01_230)] text-center py-2">Sin reclamos WLD en cola</p>
                : wldCQueue.map((entry, i) => <QueueRow key={i} entry={entry} idx={i} type="claim" />)
              }
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-[9px] text-[oklch(0.40_0.01_230)]">
                {wldStats?.claimQueueLen ?? 0} total · {Math.max(0, (wldStats?.claimQueueLen ?? 0) - (wldStats?.nextClaimIdx ?? 0))} pendientes
              </p>
              <button onClick={load} className="flex items-center gap-1 text-[9px] text-[oklch(0.45_0.01_230)] hover:text-foreground transition-colors">
                <RefreshCw className="w-2.5 h-2.5" /> Actualizar
              </button>
            </div>
          </SectionCard>
        </>
      )}

      {/* ── Info Footer ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-[oklch(0.22_0.025_245)] bg-[oklch(0.10_0.018_245)] px-4 py-3 flex flex-col gap-1.5">
        <p className="text-[9px] font-bold text-[oklch(0.50_0.01_230)] uppercase tracking-wider">Información del contrato</p>
        {[
          ['Token', 'SUSHI — World Chain'],
          ['APR', `${aprPct}% anual fijo (configurable)`],
          ['Comisión', `${feePct}% en depósito, retiro y reclamo`],
          ['Retiro', '48 horas de espera · 1 por día'],
          ['Reclamo', '24 horas de espera · 1 por día'],
          ['Pagos', 'Cola FIFO automática al fondear'],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="text-[9px] text-[oklch(0.40_0.01_230)] w-20 shrink-0">{k}</span>
            <span className="text-[9px] font-mono text-[oklch(0.60_0.01_230)]">{v}</span>
          </div>
        ))}
        <a
          href={`https://worldscan.org/address/${SUSHI_CONTRACT}`}
          target="_blank" rel="noreferrer"
          className="flex items-center gap-1 text-[9px] font-bold mt-1 hover:opacity-80 transition-opacity"
          style={{ color: SUSHI_COLOR }}
        >
          <ExternalLink className="w-2.5 h-2.5" />
          Ver contrato en WorldScan
        </a>
      </div>
    </div>
  )
}
