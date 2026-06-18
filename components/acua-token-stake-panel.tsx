'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Coins, TrendingUp, ArrowDownToLine, ArrowUpFromLine, Gift,
  Clock, RefreshCw, Shield, Copy, Check, Loader2, CheckCircle2,
  XCircle, Users, Fuel, Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ACUA_TOKEN_STAKE_ADDRESS, ACUA_STAKE_TOKEN,
  STAKE_ABI_FRAG, WITHDRAW_ABI_FRAG, TRIGGER_QUEUE_ABI_FRAG,
  CLAIM_ABI_FRAG, REGISTER_ABI_FRAG,
  fetchAcuaStakeInfo, type AcuaStakeInfo,
} from '@/lib/acua-token-stake'
import { randomNonce } from '@/lib/new-contracts'

// ─── Constants ────────────────────────────────────────────────────────────────
const DECIMALS = 18
const PERMIT2  = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const TOKEN_SYMBOL = 'ACUA'

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const ABI_APPROVE = ['function approve(address,uint256) nonpayable returns (bool)']
const ABI_ALLOWANCE = ['function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']
// Admin: fund(permit, sig, amount)
const ABI_FUND: any[] = [{
  name: 'fund', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'permit', type: 'tuple', components: [
      { name: 'permitted', type: 'tuple', components: [
        { name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' },
      ]},
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ]},
    { name: 'sig', type: 'bytes' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [],
}]
const ABI_SET_APR = [{ name: 'setApr', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newAprBps', type: 'uint256' }], outputs: [] }]
const ABI_SET_PAUSED = [{ name: 'setPaused', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'val', type: 'bool' }], outputs: [] }]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(val: bigint, dp = 4): string {
  return Number(ethers.formatUnits(val, DECIMALS)).toLocaleString('es', {
    minimumFractionDigits: 0, maximumFractionDigits: dp,
  })
}
function shortAddr(a: string) { return !a || a === ethers.ZeroAddress ? '—' : a.slice(0, 6) + '…' + a.slice(-4) }
function parseMkErr(fp: any): string {
  if (!fp) return 'Sin respuesta'
  if (fp.status === 'error') {
    const d = fp.errorCode || fp.description || fp.error_code || ''
    if (typeof d === 'string' && d.includes('user_rejected')) return 'Cancelado por el usuario'
    return String(d) || 'Error desconocido'
  }
  return 'Error desconocido'
}
function Msg({ msg, onClear }: { msg: { ok: boolean; text: string }; onClear: () => void }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-2xl p-3 border',
      msg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300')}>
      {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span className="flex-1 text-xs leading-relaxed break-words">{msg.text}</span>
      <button onClick={onClear} className="shrink-0 text-xs opacity-60 hover:opacity-100">✕</button>
    </div>
  )
}
function StatBox({ label, value, sub, c = 'text-violet-400' }: { label: string; value: string; sub?: string; c?: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <span className={cn('text-base font-black truncate', c)}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
    </div>
  )
}
function CopyBtn({ value }: { value: string }) {
  const [cp, setCp] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(value); setCp(true); setTimeout(() => setCp(false), 2000) }}
      className="shrink-0 text-violet-400 hover:text-violet-300">
      {cp ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  userAddress: string
  walletMode?: string
  importedSigner?: ethers.Signer | null
  isAdmin?: boolean
}

type PanelTab = 'stake' | 'withdraw' | 'rewards' | 'referral' | 'admin'

export function AcuaTokenStakePanel({ userAddress, isAdmin = false }: Props) {
  const [tab, setTab]       = useState<PanelTab>('stake')
  const [info, setInfo]     = useState<AcuaStakeInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(false)
  const [msg, setMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const [amount, setAmount] = useState('')
  const [refInput, setRefInput] = useState('')
  const [aprInput, setAprInput] = useState('')

  const load = useCallback(async () => {
    if (!userAddress) return
    try {
      setLoading(true)
      const d = await fetchAcuaStakeInfo(userAddress)
      setInfo(d)
    } catch (e: any) {
      console.error('fetchAcuaStakeInfo:', e)
    } finally {
      setLoading(false)
    }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  // ─── URL referral ────────────────────────────────────────────────────────
  const refFromUrl = (() => {
    if (typeof window === 'undefined') return ''
    const p = new URLSearchParams(window.location.search)
    return p.get('acua_ref') || p.get('ref') || ''
  })()

  // ─── Deposit via Permit2 ─────────────────────────────────────────────────
  async function handleStake() {
    const val = parseFloat(amount)
    if (!val || val <= 0) { setMsg({ ok: false, text: 'Ingresa un monto válido' }); return }
    setBusy(true); setMsg(null)
    try {
      const gross   = ethers.parseUnits(amount, DECIMALS)
      const nonce   = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const referrer = (ethers.isAddress(refFromUrl) ? refFromUrl : ethers.ZeroAddress)

      const iface = new ethers.Interface(STAKE_ABI_FRAG as any)
      const calldata = iface.encodeFunctionData('stake', [
        { permitted: { token: ACUA_STAKE_TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
        '0x', gross.toString(), referrer,
      ])

      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_TOKEN_STAKE_ADDRESS, abi: STAKE_ABI_FRAG, functionName: 'stake', args: [
          { permitted: { token: ACUA_STAKE_TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
          '0x', gross.toString(), referrer,
        ]}],
        permit2: [{ permitted: { token: ACUA_STAKE_TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString(), spender: ACUA_TOKEN_STAKE_ADDRESS }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: `✓ Depósito enviado. TX: ${finalPayload.transaction_id ?? 'OK'}` })
        setAmount('')
        setTimeout(load, 8000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al hacer stake' })
    } finally {
      setBusy(false)
    }
  }

  // ─── Request withdrawal ─────────────────────────────────────────────────
  async function handleRequestWithdraw() {
    const val = parseFloat(amount)
    if (!val || val <= 0) { setMsg({ ok: false, text: 'Ingresa un monto válido' }); return }
    setBusy(true); setMsg(null)
    try {
      const wAmount = ethers.parseUnits(amount, DECIMALS)
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_TOKEN_STAKE_ADDRESS, abi: WITHDRAW_ABI_FRAG, functionName: 'requestWithdrawal', args: [wAmount.toString()] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: '✓ Retiro solicitado. Cola de 48h iniciada.' })
        setAmount('')
        setTimeout(load, 8000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al solicitar retiro' })
    } finally {
      setBusy(false)
    }
  }

  // ─── Trigger queue ──────────────────────────────────────────────────────
  async function handleTriggerQueue() {
    setBusy(true); setMsg(null)
    try {
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_TOKEN_STAKE_ADDRESS, abi: TRIGGER_QUEUE_ABI_FRAG, functionName: 'triggerQueue', args: [] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: '✓ Cola procesada. Tokens liberados.' })
        setTimeout(load, 6000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al procesar cola' })
    } finally {
      setBusy(false)
    }
  }

  // ─── Claim rewards ──────────────────────────────────────────────────────
  async function handleClaim() {
    setBusy(true); setMsg(null)
    try {
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_TOKEN_STAKE_ADDRESS, abi: CLAIM_ABI_FRAG, functionName: 'claimRewards', args: [] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: '✓ Recompensas reclamadas.' })
        setTimeout(load, 6000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al reclamar' })
    } finally {
      setBusy(false)
    }
  }

  // ─── Register referrer ──────────────────────────────────────────────────
  async function handleRegisterRef() {
    if (!ethers.isAddress(refInput)) { setMsg({ ok: false, text: 'Dirección de referido inválida' }); return }
    setBusy(true); setMsg(null)
    try {
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_TOKEN_STAKE_ADDRESS, abi: REGISTER_ABI_FRAG, functionName: 'register', args: [refInput] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: '✓ Referido registrado.' })
        setTimeout(load, 6000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al registrar' })
    } finally {
      setBusy(false)
    }
  }

  // ─── Admin: set APR ─────────────────────────────────────────────────────
  async function handleSetApr() {
    const bps = parseInt(aprInput)
    if (isNaN(bps) || bps <= 0 || bps > 100000) { setMsg({ ok: false, text: 'APR inválido (ej: 1200 = 12%)' }); return }
    setBusy(true); setMsg(null)
    try {
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_TOKEN_STAKE_ADDRESS, abi: ABI_SET_APR, functionName: 'setApr', args: [bps.toString()] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: `✓ APR actualizado a ${bps / 100}%` })
        setTimeout(load, 5000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al cambiar APR' })
    } finally {
      setBusy(false)
    }
  }

  // ─── Admin: pause/unpause ───────────────────────────────────────────────
  async function handleTogglePause() {
    setBusy(true); setMsg(null)
    try {
      const newPaused = !info?.paused
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_TOKEN_STAKE_ADDRESS, abi: ABI_SET_PAUSED, functionName: 'setPaused', args: [newPaused] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: `✓ Contrato ${newPaused ? 'pausado' : 'reanudado'}` })
        setTimeout(load, 5000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error' })
    } finally {
      setBusy(false)
    }
  }

  // ─── Withdraw queue status ───────────────────────────────────────────────
  const now = BigInt(Math.floor(Date.now() / 1000))
  const withdrawReady = info && info.withdrawAmount > 0n && !info.withdrawProcessed && now >= info.withdrawUnlockAt
  const withdrawPending = info && info.withdrawAmount > 0n && !info.withdrawProcessed && now < info.withdrawUnlockAt
  const secLeft = withdrawPending && info ? Number(info.withdrawUnlockAt - now) : 0
  const hoursLeft = Math.ceil(secLeft / 3600)

  const referralLink = typeof window !== 'undefined'
    ? `${window.location.origin}?acua_ref=${userAddress}`
    : ''

  // ─── Render ──────────────────────────────────────────────────────────────
  const TABS: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'stake',    label: 'Depositar', icon: <ArrowDownToLine className="w-3.5 h-3.5" /> },
    { id: 'withdraw', label: 'Retirar',   icon: <ArrowUpFromLine className="w-3.5 h-3.5" /> },
    { id: 'rewards',  label: 'Rewards',   icon: <Gift className="w-3.5 h-3.5" /> },
    { id: 'referral', label: 'Referidos', icon: <Users className="w-3.5 h-3.5" /> },
    ...(isAdmin ? [{ id: 'admin' as PanelTab, label: 'Admin', icon: <Shield className="w-3.5 h-3.5" /> }] : []),
  ]

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="rounded-3xl p-4 border border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-purple-500/5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-violet-500/20 border border-violet-500/40">
            <Coins className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white">ACUA Stake</h2>
            <p className="text-[10px] text-violet-400/80">Staking H2O Acua Company · Permit2 · 48h cola</p>
          </div>
          <button onClick={load} className="ml-auto text-violet-400/60 hover:text-violet-400">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Stats */}
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
          </div>
        ) : info ? (
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Mi stake" value={`${fmt(info.staked)} ${TOKEN_SYMBOL}`} c="text-violet-300" />
            <StatBox label="APR" value={`${Number(info.aprBps) / 100}%`} c="text-emerald-400" />
            <StatBox label="Pool total" value={`${fmt(info.fundPool)} ${TOKEN_SYMBOL}`} c="text-blue-400"
              sub={`${fmt(info.totalStaked)} staked`} />
            <StatBox label="Rewards" value={`${fmt(info.pendingRewards)} ${TOKEN_SYMBOL}`} c="text-amber-400" />
          </div>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-black/30 rounded-2xl p-1 border border-white/10">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex-1 flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-bold transition-all',
              tab === t.id
                ? 'bg-violet-500/30 border border-violet-500/50 text-violet-300'
                : 'text-muted-foreground hover:text-white')}>
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {msg && <Msg msg={msg} onClear={() => setMsg(null)} />}

      {/* ── Depositar ── */}
      {tab === 'stake' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-violet-300">Depositar {TOKEN_SYMBOL}</span>
              <span className="text-[10px] text-muted-foreground">
                Balance: {info ? fmt(info.tokenBalance) : '—'} {TOKEN_SYMBOL}
              </span>
            </div>
            <input
              type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.000"
              className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2.5 text-sm text-white placeholder-muted-foreground outline-none focus:border-violet-500/60"
            />
            {info && (
              <div className="flex gap-2">
                {[25, 50, 75, 100].map(pct => (
                  <button key={pct} onClick={() => setAmount(fmt(info.tokenBalance * BigInt(pct) / 100n, 6))}
                    className="flex-1 text-[10px] font-bold rounded-lg py-1 bg-violet-500/15 border border-violet-500/30 text-violet-400 hover:bg-violet-500/25">
                    {pct}%
                  </button>
                ))}
              </div>
            )}
            <button onClick={handleStake} disabled={busy || !amount}
              className={cn('w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black border transition-all',
                'bg-violet-500/25 border-violet-500/50 text-violet-200 hover:bg-violet-500/35 active:scale-[.98]',
                (busy || !amount) && 'opacity-40 cursor-not-allowed')}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              {busy ? 'Procesando…' : `Depositar ${TOKEN_SYMBOL}`}
            </button>
            <p className="text-[10px] text-muted-foreground text-center">
              15% fee en claims: 5% referrer · 5% bonus · 5% owner
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
            <p className="text-[10px] text-violet-400 font-bold mb-1">Contrato</p>
            <div className="flex items-center gap-2">
              <code className="text-[9px] text-muted-foreground font-mono flex-1 truncate">{ACUA_TOKEN_STAKE_ADDRESS}</code>
              <CopyBtn value={ACUA_TOKEN_STAKE_ADDRESS} />
            </div>
          </div>
        </div>
      )}

      {/* ── Retirar ── */}
      {tab === 'withdraw' && (
        <div className="space-y-3">
          {info && info.staked > 0n && (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
              <span className="text-xs font-bold text-violet-300">Solicitar retiro (48h cola)</span>
              <input
                type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="0.000"
                className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2.5 text-sm text-white placeholder-muted-foreground outline-none focus:border-violet-500/60"
              />
              <button onClick={handleRequestWithdraw} disabled={busy || !amount}
                className={cn('w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black border',
                  'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30 active:scale-[.98]',
                  (busy || !amount) && 'opacity-40 cursor-not-allowed')}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                {busy ? 'Procesando…' : 'Solicitar retiro'}
              </button>
            </div>
          )}

          {/* Queue status */}
          {info && info.withdrawAmount > 0n && !info.withdrawProcessed && (
            <div className={cn('rounded-2xl border p-3 space-y-2',
              withdrawReady ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
              <p className={cn('text-xs font-bold', withdrawReady ? 'text-emerald-300' : 'text-amber-300')}>
                {withdrawReady ? '✓ Retiro listo' : `⏳ En cola — ${hoursLeft}h restantes`}
              </p>
              <p className="text-xs text-muted-foreground">
                Monto: <span className="text-white font-bold">{fmt(info.withdrawAmount)} {TOKEN_SYMBOL}</span>
              </p>
              {withdrawReady && (
                <button onClick={handleTriggerQueue} disabled={busy}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black border bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpFromLine className="w-4 h-4" />}
                  {busy ? 'Procesando…' : 'Procesar y retirar'}
                </button>
              )}
            </div>
          )}

          {info && info.staked === 0n && info.withdrawAmount === 0n && (
            <div className="rounded-2xl border border-white/10 bg-black/10 p-6 text-center">
              <p className="text-sm text-muted-foreground">No tienes tokens en stake</p>
            </div>
          )}
        </div>
      )}

      {/* ── Rewards ── */}
      {tab === 'rewards' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
            <div className="text-center space-y-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recompensas pendientes</p>
              <p className="text-3xl font-black text-amber-400">
                {info ? fmt(info.pendingRewards) : '—'}
              </p>
              <p className="text-xs text-muted-foreground">{TOKEN_SYMBOL}</p>
            </div>
            <button onClick={handleClaim} disabled={busy || !info || info.pendingRewards === 0n}
              className={cn('w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-black border',
                'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30 active:scale-[.98]',
                (busy || !info || info.pendingRewards === 0n) && 'opacity-40 cursor-not-allowed')}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
              {busy ? 'Procesando…' : 'Reclamar rewards'}
            </button>
            <p className="text-[10px] text-muted-foreground text-center">
              Fee de claim 15%: 5% va a tu referrer · 5% bonus si tienes referido · 5% al owner
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Total depositado" value={`${info ? fmt(info.totalStaked) : '—'}`} sub="en el contrato" c="text-violet-300" />
            <StatBox label="Pool de rewards" value={`${info ? fmt(info.fundPool) : '—'}`} sub={TOKEN_SYMBOL} c="text-blue-300" />
          </div>
        </div>
      )}

      {/* ── Referidos ── */}
      {tab === 'referral' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-3">
            <p className="text-xs font-bold text-violet-300">Sistema de referidos</p>
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Mis referidos" value={String(info?.refCount ?? '—')} c="text-violet-300" />
              <StatBox label="Ganancias ref" value={`${info ? fmt(info.refEarnings) : '—'}`} sub={TOKEN_SYMBOL} c="text-amber-400" />
            </div>
            {info && info.referredBy !== ethers.ZeroAddress && (
              <div className="rounded-xl bg-black/30 border border-white/10 p-2.5 flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Mi referrer:</span>
                <span className="font-mono text-[10px] text-violet-300">{shortAddr(info.referredBy)}</span>
              </div>
            )}
            {info && info.referredBy === ethers.ZeroAddress && !info.registered && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">Registra un referrer para activar los bonos de referido:</p>
                <input value={refInput} onChange={e => setRefInput(e.target.value)}
                  placeholder="0x... dirección del referrer"
                  className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none focus:border-violet-500/60"
                />
                <button onClick={handleRegisterRef} disabled={busy || !refInput}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black border bg-violet-500/20 border-violet-500/40 text-violet-300 hover:bg-violet-500/30 disabled:opacity-40">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                  {busy ? 'Registrando…' : 'Registrar referrer'}
                </button>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-bold">Tu link de referido</p>
              <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 p-2.5">
                <code className="flex-1 text-[9px] font-mono text-violet-300 truncate">
                  {referralLink || `${typeof window !== 'undefined' ? window.location.origin : ''}?acua_ref=${userAddress}`}
                </code>
                <CopyBtn value={referralLink || `?acua_ref=${userAddress}`} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin ── */}
      {tab === 'admin' && isAdmin && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-400" />
              <p className="text-xs font-bold text-blue-300">Admin AcuaTokenStake</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Stakers" value={String(info?.stakerCount ?? '—')} c="text-blue-300" />
              <StatBox label="Estado" value={info?.paused ? 'PAUSADO' : 'Activo'} c={info?.paused ? 'text-red-400' : 'text-emerald-400'} />
            </div>

            {/* Set APR */}
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground font-bold">Cambiar APR (bps, ej: 1200 = 12%)</p>
              <p className="text-[10px] text-blue-400">APR actual: {info ? Number(info.aprBps) / 100 : '—'}%</p>
              <div className="flex gap-2">
                <input value={aprInput} onChange={e => setAprInput(e.target.value)} placeholder="1200"
                  className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none" />
                <button onClick={handleSetApr} disabled={busy}
                  className="px-4 rounded-xl text-xs font-black bg-blue-500/20 border border-blue-500/40 text-blue-300 hover:bg-blue-500/30 disabled:opacity-40">
                  {busy ? '…' : 'SET'}
                </button>
              </div>
            </div>

            {/* Pause/Unpause */}
            <button onClick={handleTogglePause} disabled={busy}
              className={cn('w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black border',
                info?.paused
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30'
                  : 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30',
                busy && 'opacity-40 cursor-not-allowed')}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Settings className="w-3 h-3" />}
              {info?.paused ? 'Reanudar contrato' : 'Pausar contrato'}
            </button>

            {/* Contract info */}
            <div className="rounded-xl bg-black/30 border border-white/10 p-2.5 space-y-1">
              <p className="text-[9px] text-muted-foreground font-mono">Contrato: {ACUA_TOKEN_STAKE_ADDRESS}</p>
              <p className="text-[9px] text-muted-foreground font-mono">Token: {ACUA_STAKE_TOKEN}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
