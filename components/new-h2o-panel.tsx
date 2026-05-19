'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Droplets, Zap, Users, Copy, Check, Gift,
  ArrowDownToLine, ArrowUpFromLine, Coins, RefreshCw,
  ChevronRight, Star, Shield, TrendingUp, Sparkles, Heart,
  ExternalLink, Loader2, AlertCircle, CheckCircle2, Lock,
  Info, Crown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  H2O_STAKING_ADDRESS, H2O_TOKEN, H2O_VIP_ADDRESS,
  PERMIT_TUPLE_INPUT, STAKE_ABI_FRAG, UNSTAKE_ABI_FRAG,
  CLAIM_ABI_FRAG, CLAIM_REF_ABI_FRAG, REGISTER_REF_ABI_FRAG,
  BUY_VIP_PERMIT2_ABI_FRAG,
  fetchH2OStakeInfo, calcAPY, formatToken, shortenAddress, randomNonce,
  type H2OStakeInfo,
} from '@/lib/h2oStaking'

const WORLDSCAN = 'https://worldscan.org'
const CYAN = 'oklch(0.72 0.20 195)'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtH2O(amount: bigint, prec = 4) {
  return formatToken(amount, 18, prec)
}

function bpsPct(bps: bigint) {
  return (Number(bps) / 100).toFixed(2) + '%'
}

function makeDeadline(secs = 3600) {
  return BigInt(Math.floor(Date.now() / 1000) + secs)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('rounded animate-pulse bg-white/8', className)} />
}

function StatRow({ label, value, sub, loading }: {
  label: string; value: string; sub?: string; loading?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-xs text-white/50">{label}</span>
      {loading
        ? <Skeleton className="h-4 w-20" />
        : (
          <div className="text-right">
            <span className="text-xs font-bold text-white">{value}</span>
            {sub && <p className="text-[10px] text-white/30">{sub}</p>}
          </div>
        )}
    </div>
  )
}

function StatusBar({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium',
      ok
        ? 'bg-green-500/10 text-green-300 border border-green-500/20'
        : 'bg-red-500/10 text-red-300 border border-red-500/20'
    )}>
      {ok
        ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
      {text}
    </div>
  )
}

// Live ticking earned counter
function EarnedCounter({ base, rewardRate, totalStaked, periodFinish, loading }: {
  base: bigint; rewardRate: bigint; totalStaked: bigint; periodFinish: bigint; loading: boolean
}) {
  const [display, setDisplay] = useState(parseFloat(ethers.formatEther(base)))
  const baseRef = useRef(base)
  baseRef.current = base

  useEffect(() => {
    setDisplay(parseFloat(ethers.formatEther(base)))
  }, [base])

  useEffect(() => {
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (rewardRate === 0n || totalStaked === 0n || periodFinish < now) return
    const perSec = Number(rewardRate) / Number(totalStaked)
    const id = setInterval(() => {
      setDisplay(p => p + perSec)
    }, 1000)
    return () => clearInterval(id)
  }, [rewardRate, totalStaked, periodFinish])

  if (loading) return <Skeleton className="h-8 w-28" />
  if (display <= 0) return <span className="text-2xl font-black text-white/30">0</span>
  return (
    <span className="text-2xl font-black text-cyan-300 font-mono tabular-nums">
      {display < 0.000001 ? '< 0.000001' : display.toFixed(8)}
    </span>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function NewH2OPanel({ userAddress }: { userAddress: string }) {
  const [info, setInfo]           = useState<H2OStakeInfo | null>(null)
  const [loading, setLoading]     = useState(false)
  const [stakeAmt, setStakeAmt]   = useState('')
  const [unstakeAmt, setUnstakeAmt] = useState('')
  const [refAddr, setRefAddr]     = useState('')
  const [vipMonths, setVipMonths] = useState('1')
  const [busy, setBusy]           = useState(false)
  const [status, setStatus]       = useState<{ ok: boolean; text: string } | null>(null)
  const [tab, setTab]             = useState<'stake' | 'vip' | 'ref'>('stake')
  const [copied, setCopied]       = useState(false)

  const load = useCallback(async () => {
    if (!userAddress) return
    setLoading(true)
    try {
      const d = await fetchH2OStakeInfo(userAddress)
      setInfo(d)
    } catch (e) {
      console.error('[H2O-V2] fetch error', e)
    } finally {
      setLoading(false)
    }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  const showStatus = (ok: boolean, text: string) => {
    setStatus({ ok, text })
    setTimeout(() => setStatus(null), 5000)
  }

  // ── Stake ──
  async function doStake() {
    if (!stakeAmt || parseFloat(stakeAmt) <= 0) return showStatus(false, 'Ingresa monto a stakear')
    if (!MiniKit.isInstalled()) return showStatus(false, 'Abre en World App para hacer stake')
    setBusy(true)
    try {
      const amtWei = ethers.parseEther(stakeAmt)
      const nonce = randomNonce()
      const deadline = makeDeadline()
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: STAKE_ABI_FRAG,
          functionName: 'stake',
          args: [
            {
              permitted: { token: H2O_TOKEN, amount: amtWei.toString() },
              nonce: nonce.toString(),
              deadline: deadline.toString(),
            },
            'PERMIT2_SIGNATURE_PLACEHOLDER_DO_NOT_MODIFY',
          ],
        }],
        permit2: [{
          permitted: { token: H2O_TOKEN, amount: amtWei.toString() },
          spender: H2O_STAKING_ADDRESS,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      if (finalPayload.status === 'success') {
        showStatus(true, 'Stake enviado')
        setStakeAmt('')
        setTimeout(load, 3000)
      } else {
        showStatus(false, (finalPayload as any).error_code ?? 'Error en stake')
      }
    } catch (e: any) {
      showStatus(false, e?.message ?? 'Error inesperado')
    } finally {
      setBusy(false)
    }
  }

  // ── Unstake ──
  async function doUnstake() {
    if (!unstakeAmt || parseFloat(unstakeAmt) <= 0) return showStatus(false, 'Ingresa monto a retirar')
    if (!MiniKit.isInstalled()) return showStatus(false, 'Abre en World App para hacer unstake')
    setBusy(true)
    try {
      const amtWei = ethers.parseEther(unstakeAmt)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: UNSTAKE_ABI_FRAG,
          functionName: 'unstake',
          args: [amtWei.toString()],
        }],
      })
      if (finalPayload.status === 'success') {
        showStatus(true, 'Unstake enviado')
        setUnstakeAmt('')
        setTimeout(load, 3000)
      } else {
        showStatus(false, (finalPayload as any).error_code ?? 'Error en unstake')
      }
    } catch (e: any) {
      showStatus(false, e?.message ?? 'Error inesperado')
    } finally {
      setBusy(false)
    }
  }

  // ── Claim Rewards ──
  async function doClaim() {
    if (!MiniKit.isInstalled()) return showStatus(false, 'Abre en World App para reclamar')
    setBusy(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: CLAIM_ABI_FRAG,
          functionName: 'claimRewards',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        showStatus(true, 'Recompensas reclamadas')
        setTimeout(load, 3000)
      } else {
        showStatus(false, (finalPayload as any).error_code ?? 'Error al reclamar')
      }
    } catch (e: any) {
      showStatus(false, e?.message ?? 'Error inesperado')
    } finally {
      setBusy(false)
    }
  }

  // ── Claim Referral ──
  async function doClaimRef() {
    if (!MiniKit.isInstalled()) return showStatus(false, 'Abre en World App para reclamar')
    setBusy(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: CLAIM_REF_ABI_FRAG,
          functionName: 'claimRefRewards',
          args: [],
        }],
      })
      if (finalPayload.status === 'success') {
        showStatus(true, 'Recompensas de referidos reclamadas')
        setTimeout(load, 3000)
      } else {
        showStatus(false, (finalPayload as any).error_code ?? 'Error al reclamar')
      }
    } catch (e: any) {
      showStatus(false, e?.message ?? 'Error inesperado')
    } finally {
      setBusy(false)
    }
  }

  // ── Register Referrer ──
  async function doRegisterRef() {
    if (!refAddr || !ethers.isAddress(refAddr)) return showStatus(false, 'Dirección inválida')
    if (!MiniKit.isInstalled()) return showStatus(false, 'Abre en World App')
    setBusy(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: REGISTER_REF_ABI_FRAG,
          functionName: 'registerReferrer',
          args: [refAddr],
        }],
      })
      if (finalPayload.status === 'success') {
        showStatus(true, 'Referrer registrado')
        setRefAddr('')
        setTimeout(load, 3000)
      } else {
        showStatus(false, (finalPayload as any).error_code ?? 'Error al registrar')
      }
    } catch (e: any) {
      showStatus(false, e?.message ?? 'Error inesperado')
    } finally {
      setBusy(false)
    }
  }

  // ── Buy VIP ──
  async function doBuyVIP() {
    const months = parseInt(vipMonths) || 1
    if (!MiniKit.isInstalled()) return showStatus(false, 'Abre en World App para comprar VIP')
    if (!info) return
    setBusy(true)
    try {
      const priceWei = info.vipPrice * BigInt(months)
      const nonce = randomNonce()
      const deadline = makeDeadline()
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_VIP_ADDRESS,
          abi: BUY_VIP_PERMIT2_ABI_FRAG,
          functionName: 'buyVIPWithPermit2',
          args: [
            months.toString(),
            {
              permitted: { token: H2O_TOKEN, amount: priceWei.toString() },
              nonce: nonce.toString(),
              deadline: deadline.toString(),
            },
            'PERMIT2_SIGNATURE_PLACEHOLDER_DO_NOT_MODIFY',
          ],
        }],
        permit2: [{
          permitted: { token: H2O_TOKEN, amount: priceWei.toString() },
          spender: H2O_VIP_ADDRESS,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      if (finalPayload.status === 'success') {
        showStatus(true, `VIP activado por ${months} mes(es)`)
        setTimeout(load, 3000)
      } else {
        showStatus(false, (finalPayload as any).error_code ?? 'Error al comprar VIP')
      }
    } catch (e: any) {
      showStatus(false, e?.message ?? 'Error inesperado')
    } finally {
      setBusy(false)
    }
  }

  const apy = info ? calcAPY(info.rewardRate, info.totalStaked, info.periodFinish) : '—'
  const vipActive = info && info.vipExpiry > BigInt(Math.floor(Date.now() / 1000))
  const refLink = `https://acua.app/stake?ref=${userAddress}`

  const handleCopyRef = () => {
    navigator.clipboard.writeText(refLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-6">

      {/* ── HERO — Balances Card ────────────────────────────────────────── */}
      <div className="relative rounded-3xl overflow-hidden border border-cyan-500/30">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-teal-900/80 to-blue-950" />
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-32 h-32 rounded-full bg-teal-400/10 blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <div className="relative z-10 p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-cyan-400/20 border border-cyan-400/40 flex items-center justify-center">
                <Droplets className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <p className="text-sm font-black text-white tracking-wide">H2O 2.0</p>
                <p className="text-[10px] text-cyan-300/60">Stake · Referidos · VIP</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {vipActive && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/30">
                  <Crown className="w-3 h-3 text-amber-400" />
                  <span className="text-[9px] font-bold text-amber-400">VIP</span>
                </div>
              )}
              <button
                onClick={load}
                disabled={loading}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              >
                <RefreshCw className={cn('w-3.5 h-3.5 text-cyan-400', loading && 'animate-spin')} />
              </button>
            </div>
          </div>

          {/* Main stats grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* Staked */}
            <div className="rounded-2xl bg-black/30 border border-cyan-400/20 p-3">
              <p className="text-[9px] text-cyan-400/60 uppercase font-semibold tracking-wider mb-1">H2O Stakeado</p>
              {loading && !info
                ? <Skeleton className="h-7 w-24 mb-1" />
                : <p className="text-xl font-black text-white font-mono">{fmtH2O(info?.staked ?? 0n)}</p>}
              <p className="text-[9px] text-white/30">H2O</p>
            </div>
            {/* Wallet balance */}
            <div className="rounded-2xl bg-black/30 border border-cyan-400/20 p-3">
              <p className="text-[9px] text-cyan-400/60 uppercase font-semibold tracking-wider mb-1">Balance H2O</p>
              {loading && !info
                ? <Skeleton className="h-7 w-24 mb-1" />
                : <p className="text-xl font-black text-white font-mono">{fmtH2O(info?.h2oBalance ?? 0n)}</p>}
              <p className="text-[9px] text-white/30">disponible</p>
            </div>
          </div>

          {/* Earned */}
          <div className="rounded-2xl bg-black/30 border border-cyan-400/20 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider">Para reclamar</span>
              </div>
              <a href={`${WORLDSCAN}/address/${H2O_STAKING_ADDRESS}`} target="_blank" rel="noopener noreferrer"
                className="text-[9px] font-mono text-cyan-400/40 hover:text-cyan-300 flex items-center gap-0.5">
                contrato <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <EarnedCounter
              base={info?.earned ?? 0n}
              rewardRate={info?.rewardRate ?? 0n}
              totalStaked={info?.totalStaked ?? 0n}
              periodFinish={info?.periodFinish ?? 0n}
              loading={loading && !info}
            />
            <p className="text-[9px] text-white/30 mt-1">H2O · APY: {apy}</p>
          </div>

          {/* Claim button */}
          <button
            onClick={doClaim}
            disabled={busy || !info || info.earned === 0n}
            className={cn(
              'mt-3 w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all',
              info && info.earned > 0n
                ? 'bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 active:scale-95'
                : 'bg-white/5 border border-white/10 text-white/30 cursor-not-allowed'
            )}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
            Reclamar Recompensas
            {info && <span className="text-[10px] opacity-60">({bpsPct(info.claimFeeBps)} fee)</span>}
          </button>
        </div>
      </div>

      {/* ── STATUS BAR ──────────────────────────────────────────────────── */}
      {status && <StatusBar ok={status.ok} text={status.text} />}

      {/* ── TABS ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl bg-black/30 border border-white/8">
        {([
          { id: 'stake', label: 'Stake / Unstake', icon: <Droplets className="w-3.5 h-3.5" /> },
          { id: 'vip',   label: 'VIP',             icon: <Crown className="w-3.5 h-3.5" /> },
          { id: 'ref',   label: 'Referidos',        icon: <Users className="w-3.5 h-3.5" /> },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all',
              tab === t.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-white/40 hover:text-white/60'
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: STAKE / UNSTAKE ─────────────────────────────────────────── */}
      {tab === 'stake' && (
        <div className="space-y-3">
          {/* Info row */}
          <div className="rounded-xl border border-white/8 bg-white/4 divide-y divide-white/5">
            <StatRow label="Total stakeado en pool" value={fmtH2O(info?.totalStaked ?? 0n) + ' H2O'} loading={loading && !info} />
            <StatRow label="APY actual" value={apy} loading={loading && !info} />
            <StatRow label="Fee depósito" value={info ? bpsPct(info.depositFeeBps) : '—'} loading={loading && !info} />
            <StatRow label="Fee retiro" value={info ? bpsPct(info.withdrawFeeBps) : '—'} loading={loading && !info} />
          </div>

          {/* Stake input */}
          <div className="rounded-xl border border-cyan-500/20 bg-black/20 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-bold text-cyan-300">Depositar H2O</span>
            </div>
            <div className="relative">
              <input
                type="number"
                placeholder="0.0"
                value={stakeAmt}
                onChange={e => setStakeAmt(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 pr-16"
              />
              <button
                onClick={() => info && setStakeAmt(ethers.formatEther(info.h2oBalance))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-cyan-400 hover:text-cyan-300"
              >
                MAX
              </button>
            </div>
            <p className="text-[10px] text-white/30">
              Disponible: {fmtH2O(info?.h2oBalance ?? 0n)} H2O
            </p>
            <button
              onClick={doStake}
              disabled={busy || !stakeAmt}
              className={cn(
                'w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all',
                stakeAmt
                  ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/30 active:scale-95'
                  : 'bg-white/5 border border-white/10 text-white/25 cursor-not-allowed'
              )}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              Stake H2O
            </button>
          </div>

          {/* Unstake input */}
          {info && info.staked > 0n && (
            <div className="rounded-xl border border-violet-500/20 bg-black/20 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <ArrowUpFromLine className="w-3.5 h-3.5 text-violet-400" />
                <span className="text-xs font-bold text-violet-300">Retirar H2O</span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  placeholder="0.0"
                  value={unstakeAmt}
                  onChange={e => setUnstakeAmt(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 pr-16"
                />
                <button
                  onClick={() => info && setUnstakeAmt(ethers.formatEther(info.staked))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-violet-400 hover:text-violet-300"
                >
                  MAX
                </button>
              </div>
              <p className="text-[10px] text-white/30">
                Stakeado: {fmtH2O(info.staked)} H2O · Fee retiro: {bpsPct(info.withdrawFeeBps)}
              </p>
              <button
                onClick={doUnstake}
                disabled={busy || !unstakeAmt}
                className={cn(
                  'w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all',
                  unstakeAmt
                    ? 'bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 active:scale-95'
                    : 'bg-white/5 border border-white/10 text-white/25 cursor-not-allowed'
                )}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpFromLine className="w-4 h-4" />}
                Unstake H2O
              </button>
            </div>
          )}

          {/* No wallet / not in World App notice */}
          {!MiniKit.isInstalled() && (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-amber-500/8 border border-amber-500/20 text-amber-300/70 text-xs">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              Abre en World App para stake · Balances visibles en modo lectura
            </div>
          )}
        </div>
      )}

      {/* ── TAB: VIP ─────────────────────────────────────────────────────── */}
      {tab === 'vip' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-500/20 bg-black/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-amber-300">Estado VIP</span>
            </div>
            <div className="divide-y divide-white/5">
              <StatRow
                label="Estado"
                value={vipActive ? '✅ Activo' : '❌ Inactivo'}
                sub={vipActive && info ? `Expira: ${new Date(Number(info.vipExpiry) * 1000).toLocaleDateString()}` : undefined}
                loading={loading && !info}
              />
              <StatRow
                label="Precio VIP (1 mes)"
                value={info ? fmtH2O(info.vipPrice) + ' H2O' : '—'}
                loading={loading && !info}
              />
              <StatRow
                label="VIP Recompensas pendientes"
                value={info ? fmtH2O(info.ownerVipPending) + ' H2O' : '—'}
                loading={loading && !info}
              />
            </div>
          </div>

          {info && info.vipPrice > 0n && (
            <div className="rounded-xl border border-amber-500/20 bg-black/20 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-white/60">Meses a comprar:</span>
                <div className="flex gap-1">
                  {[1, 3, 6, 12].map(m => (
                    <button
                      key={m}
                      onClick={() => setVipMonths(m.toString())}
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors',
                        vipMonths === m.toString()
                          ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                          : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60'
                      )}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-white/40">
                Total: <span className="text-amber-300 font-bold">{fmtH2O(info.vipPrice * BigInt(vipMonths))} H2O</span>
              </p>
              <button
                onClick={doBuyVIP}
                disabled={busy}
                className="w-full py-2.5 rounded-xl font-bold text-sm bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                Activar VIP · {vipMonths} mes(es)
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: REFERIDOS ───────────────────────────────────────────────── */}
      {tab === 'ref' && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="rounded-xl border border-violet-500/20 bg-black/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-bold text-violet-300">Mis Referidos</span>
            </div>
            <div className="divide-y divide-white/5">
              <StatRow label="Referidos activos" value={info ? info.refCount.toString() : '—'} loading={loading && !info} />
              <StatRow
                label="Recompensas referido"
                value={info ? fmtH2O(info.refPending) + ' H2O' : '—'}
                loading={loading && !info}
              />
              <StatRow
                label="Mi referrer"
                value={info && info.referrer !== ethers.ZeroAddress ? shortenAddress(info.referrer) : 'Ninguno'}
                loading={loading && !info}
              />
            </div>

            {info && info.refPending > 0n && (
              <button
                onClick={doClaimRef}
                disabled={busy}
                className="mt-3 w-full py-2 rounded-xl font-bold text-xs bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />}
                Reclamar recompensas de referidos
              </button>
            )}
          </div>

          {/* Register referrer */}
          {info && info.referrer === ethers.ZeroAddress && (
            <div className="rounded-xl border border-violet-500/20 bg-black/20 p-4 space-y-3">
              <p className="text-xs font-semibold text-violet-300">Registrar tu referrer</p>
              <input
                type="text"
                placeholder="0x..."
                value={refAddr}
                onChange={e => setRefAddr(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-white/20 focus:outline-none focus:border-violet-500/50 font-mono"
              />
              <button
                onClick={doRegisterRef}
                disabled={busy || !refAddr}
                className={cn(
                  'w-full py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all',
                  refAddr
                    ? 'bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 active:scale-95'
                    : 'bg-white/5 border-white/10 text-white/25 cursor-not-allowed'
                )}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Registrar referrer
              </button>
            </div>
          )}

          {/* Share link */}
          <div className="rounded-xl border border-violet-500/20 bg-black/20 p-4">
            <p className="text-xs font-semibold text-violet-300 mb-2">Tu link de referido</p>
            <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 p-3">
              <span className="flex-1 text-[11px] font-mono text-white/50 truncate">
                acua.app/stake?ref={userAddress ? userAddress.slice(0, 10) + '…' : '0x…'}
              </span>
              <button
                onClick={handleCopyRef}
                className="shrink-0 flex items-center gap-1 text-xs font-bold text-violet-400 hover:text-violet-300 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="text-[9px] text-white/25 mt-2 text-center">Ganas 10% de los claims de tus referidos</p>
          </div>
        </div>
      )}

      {/* ── CONTRACT INFO ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 rounded-xl px-3 py-2 bg-black/20 border border-white/8">
        <Shield className="w-3 h-3 text-green-400 shrink-0" />
        <span className="text-[9px] text-white/30 font-mono truncate">
          {H2O_STAKING_ADDRESS}
        </span>
        <a href={`${WORLDSCAN}/address/${H2O_STAKING_ADDRESS}`} target="_blank" rel="noopener noreferrer"
          className="shrink-0 text-cyan-400/50 hover:text-cyan-300">
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

    </div>
  )
}
