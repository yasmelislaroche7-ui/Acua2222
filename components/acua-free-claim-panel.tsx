'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Gift, RefreshCw, Shield, Plus, Settings, Trash2,
  Clock, CheckCircle2, XCircle, Loader2, Coins,
  Pause, Play, Fuel, Copy, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ACUA_FREE_CLAIM_ADDRESS,
  CLAIM_ABI_FRAG, ADD_POOL_ABI_FRAG, SET_POOL_ABI_FRAG,
  FUND_ABI_FRAG, WITHDRAW_ALL_ABI_FRAG,
  fetchClaimPools, type ClaimPool,
} from '@/lib/acua-free-claim'
import { randomNonce } from '@/lib/new-contracts'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt18(val: bigint, dp = 4): string {
  try { return Number(ethers.formatUnits(val, 18)).toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: dp }) }
  catch { return '—' }
}
function fmtSeconds(s: bigint): string {
  const n = Number(s)
  if (n < 60)         return `${n}s`
  if (n < 3600)       return `${Math.ceil(n / 60)}min`
  if (n < 86400)      return `${Math.ceil(n / 3600)}h`
  return `${Math.ceil(n / 86400)}d`
}
function parseMkErr(fp: any): string {
  if (!fp) return 'Sin respuesta'
  const d = fp.errorCode || fp.description || fp.error_code || ''
  if (typeof d === 'string' && d.includes('user_rejected')) return 'Cancelado por el usuario'
  return String(d) || 'Error desconocido'
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

// ─── Pool Card ────────────────────────────────────────────────────────────────
function PoolCard({ pool, onClaim, busy }: { pool: ClaimPool; onClaim: (id: number) => void; busy: boolean }) {
  const canClaim  = pool.active && pool.balance >= pool.amountPerClaim && pool.cooldownRemaining === 0n
  const onCooldown = pool.cooldownRemaining > 0n
  const noBalance  = pool.balance < pool.amountPerClaim

  return (
    <div className={cn('rounded-2xl border p-4 space-y-3',
      pool.active ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/10 bg-white/3 opacity-60')}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500/20 border border-emerald-500/30">
          <Coins className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-white truncate">{pool.name || pool.symbol || 'Token'}</p>
          <p className="text-[10px] font-mono text-muted-foreground truncate">{pool.token.slice(0, 10)}…{pool.token.slice(-6)}</p>
        </div>
        {!pool.active && (
          <span className="text-[9px] font-bold text-red-400 bg-red-500/15 border border-red-500/30 rounded-full px-2 py-0.5">
            INACTIVO
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
          <p className="text-[9px] text-muted-foreground">Por claim</p>
          <p className="text-xs font-black text-emerald-300">{fmt18(pool.amountPerClaim)} {pool.symbol}</p>
        </div>
        <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
          <p className="text-[9px] text-muted-foreground">Pool balance</p>
          <p className="text-xs font-black text-blue-300">{fmt18(pool.balance)} {pool.symbol}</p>
        </div>
      </div>

      {pool.cooldown > 0n && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Cooldown: {fmtSeconds(pool.cooldown)}
          {onCooldown && <span className="text-amber-400 font-bold"> · espera {fmtSeconds(pool.cooldownRemaining)}</span>}
        </p>
      )}

      <button
        onClick={() => onClaim(pool.index)}
        disabled={busy || !canClaim}
        className={cn('w-full flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-black border transition-all',
          canClaim
            ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200 hover:bg-emerald-500/35 active:scale-[.98]'
            : onCooldown
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : noBalance
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-white/5 border-white/10 text-muted-foreground',
          (busy || !canClaim) && 'opacity-60 cursor-not-allowed')}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
        {busy ? 'Reclamando…'
          : onCooldown ? `Espera ${fmtSeconds(pool.cooldownRemaining)}`
          : noBalance   ? 'Sin fondos'
          : !pool.active ? 'Inactivo'
          : `Reclamar ${pool.symbol}`}
      </button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  userAddress: string
  isAdmin?: boolean
}

type ViewTab = 'claim' | 'admin'

// Admin: addPool form state
interface NewPoolForm {
  token: string; amountPerClaim: string; cooldown: string
  tokenName: string; tokenSymbol: string
}
const EMPTY_FORM: NewPoolForm = { token: '', amountPerClaim: '', cooldown: '86400', tokenName: '', tokenSymbol: '' }

export function AcuaFreeClaimPanel({ userAddress, isAdmin = false }: Props) {
  const [view, setView]     = useState<ViewTab>('claim')
  const [pools, setPools]   = useState<ClaimPool[]>([])
  const [loading, setLoading] = useState(true)
  const [claimingId, setClaimingId] = useState<number | null>(null)
  const [msg, setMsg]       = useState<{ ok: boolean; text: string } | null>(null)

  // Admin state
  const [newPool, setNewPool] = useState<NewPoolForm>(EMPTY_FORM)
  const [adminBusy, setAdminBusy] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [fundId, setFundId]   = useState<number | null>(null)
  const [fundAmount, setFundAmount] = useState('')

  const load = useCallback(async () => {
    if (!userAddress) return
    try {
      setLoading(true)
      const data = await fetchClaimPools(userAddress)
      setPools(data)
    } catch (e: any) {
      console.error('fetchClaimPools:', e)
    } finally {
      setLoading(false)
    }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  // ─── Claim ────────────────────────────────────────────────────────────────
  async function handleClaim(id: number) {
    setClaimingId(id); setMsg(null)
    try {
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_FREE_CLAIM_ADDRESS, abi: CLAIM_ABI_FRAG, functionName: 'claim', args: [id.toString()] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: `✓ ¡Claim exitoso! Pool #${id}` })
        setTimeout(load, 8000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al reclamar' })
    } finally {
      setClaimingId(null)
    }
  }

  // ─── Admin: Add pool ──────────────────────────────────────────────────────
  async function handleAddPool() {
    if (!ethers.isAddress(newPool.token)) { setMsg({ ok: false, text: 'Dirección de token inválida' }); return }
    const amount = parseFloat(newPool.amountPerClaim)
    if (!amount || amount <= 0) { setMsg({ ok: false, text: 'Monto por claim inválido' }); return }
    setAdminBusy(true); setMsg(null)
    try {
      const amountWei = ethers.parseUnits(newPool.amountPerClaim, 18).toString()
      const cooldownSec = (parseInt(newPool.cooldown) || 0).toString()
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_FREE_CLAIM_ADDRESS, abi: ADD_POOL_ABI_FRAG, functionName: 'addPool',
          args: [newPool.token, amountWei, cooldownSec, newPool.tokenName, newPool.tokenSymbol] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: '✓ Pool creado.' })
        setNewPool(EMPTY_FORM)
        setTimeout(load, 8000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al crear pool' })
    } finally {
      setAdminBusy(false)
    }
  }

  // ─── Admin: Fund pool via Permit2 ─────────────────────────────────────────
  async function handleFundPool(id: number) {
    const amount = parseFloat(fundAmount)
    if (!amount || amount <= 0) { setMsg({ ok: false, text: 'Monto de fondeo inválido' }); return }
    setAdminBusy(true); setMsg(null)
    try {
      const pool = pools[id]
      const amountWei = ethers.parseUnits(fundAmount, 18)
      const nonce    = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_FREE_CLAIM_ADDRESS, abi: FUND_ABI_FRAG, functionName: 'fund',
          args: [id.toString(), { permitted: { token: pool.token, amount: amountWei.toString() }, nonce: nonce.toString(), deadline: deadline.toString() }, '0x'] }],
        permit2: [{ permitted: { token: pool.token, amount: amountWei.toString() }, nonce: nonce.toString(), deadline: deadline.toString(), spender: ACUA_FREE_CLAIM_ADDRESS }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: `✓ Pool #${id} fondeado con ${fundAmount} tokens.` })
        setFundId(null); setFundAmount('')
        setTimeout(load, 8000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al fondear' })
    } finally {
      setAdminBusy(false)
    }
  }

  // ─── Admin: Withdraw all ──────────────────────────────────────────────────
  async function handleWithdrawAll(id: number) {
    setAdminBusy(true); setMsg(null)
    try {
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_FREE_CLAIM_ADDRESS, abi: WITHDRAW_ALL_ABI_FRAG, functionName: 'withdrawAll', args: [id.toString()] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: `✓ Pool #${id} vaciado.` })
        setTimeout(load, 6000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error al retirar' })
    } finally {
      setAdminBusy(false)
    }
  }

  // ─── Admin: Toggle active ─────────────────────────────────────────────────
  async function handleToggleActive(pool: ClaimPool) {
    setAdminBusy(true); setMsg(null)
    try {
      const { commandsAsync } = MiniKit as any
      const { finalPayload } = await commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_FREE_CLAIM_ADDRESS, abi: SET_POOL_ABI_FRAG, functionName: 'setPoolInfo',
          args: [pool.index.toString(), pool.amountPerClaim.toString(), pool.cooldown.toString(), !pool.active, pool.name, pool.symbol] }],
      })
      if (finalPayload?.status === 'success' || finalPayload?.transaction_id) {
        setMsg({ ok: true, text: `✓ Pool #${pool.index} ${!pool.active ? 'activado' : 'desactivado'}` })
        setTimeout(load, 6000)
      } else {
        setMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Error' })
    } finally {
      setAdminBusy(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="rounded-3xl p-4 border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-teal-500/5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-500/20 border border-emerald-500/40">
            <Gift className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-black text-white">Free Claim</h2>
            <p className="text-[10px] text-emerald-400/80">Reclamar tokens gratuitos · Multi-token · Admin pools</p>
          </div>
          <button onClick={load} className="text-emerald-400/60 hover:text-emerald-400">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
        {!loading && (
          <p className="text-[10px] text-muted-foreground mt-2">
            {pools.filter(p => p.active).length} pool{pools.filter(p => p.active).length !== 1 ? 's' : ''} activo{pools.filter(p => p.active).length !== 1 ? 's' : ''} ·{' '}
            {pools.filter(p => p.active && p.balance >= p.amountPerClaim && p.cooldownRemaining === 0n).length} disponibles para reclamar
          </p>
        )}
      </div>

      {/* View tabs — show Admin only if isAdmin */}
      {isAdmin && (
        <div className="flex gap-1 bg-black/30 rounded-2xl p-1 border border-white/10">
          {[
            { id: 'claim' as ViewTab,  label: 'Claim', icon: <Gift className="w-3.5 h-3.5" /> },
            { id: 'admin' as ViewTab, label: 'Admin', icon: <Shield className="w-3.5 h-3.5" /> },
          ].map(t => (
            <button key={t.id} onClick={() => setView(t.id)}
              className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all',
                view === t.id
                  ? 'bg-emerald-500/25 border border-emerald-500/40 text-emerald-300'
                  : 'text-muted-foreground hover:text-white')}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      )}

      {msg && <Msg msg={msg} onClear={() => setMsg(null)} />}

      {/* ── Claim view ── */}
      {view === 'claim' && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            </div>
          ) : pools.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-black/10 p-8 text-center">
              <Gift className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No hay pools disponibles aún</p>
            </div>
          ) : (
            pools.map(pool => (
              <PoolCard
                key={pool.index}
                pool={pool}
                onClaim={handleClaim}
                busy={claimingId === pool.index}
              />
            ))
          )}
        </div>
      )}

      {/* ── Admin view ── */}
      {view === 'admin' && isAdmin && (
        <div className="space-y-4">
          {/* Create new pool */}
          <div className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-400" />
              <p className="text-xs font-bold text-blue-300">Crear nuevo pool</p>
            </div>
            <div className="space-y-2">
              <input value={newPool.token} onChange={e => setNewPool(p => ({ ...p, token: e.target.value }))}
                placeholder="Token ERC-20 (0x...)"
                className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none focus:border-blue-500/60" />
              <div className="grid grid-cols-2 gap-2">
                <input value={newPool.tokenName} onChange={e => setNewPool(p => ({ ...p, tokenName: e.target.value }))}
                  placeholder="Nombre (opcional)"
                  className="rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none" />
                <input value={newPool.tokenSymbol} onChange={e => setNewPool(p => ({ ...p, tokenSymbol: e.target.value }))}
                  placeholder="Símbolo (opcional)"
                  className="rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Monto por claim (tokens)</p>
                  <input value={newPool.amountPerClaim} onChange={e => setNewPool(p => ({ ...p, amountPerClaim: e.target.value }))}
                    placeholder="100"
                    className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Cooldown (segundos)</p>
                  <input value={newPool.cooldown} onChange={e => setNewPool(p => ({ ...p, cooldown: e.target.value }))}
                    placeholder="86400 = 24h"
                    className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder-muted-foreground outline-none" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Cooldown: 0=sin límite · 3600=1h · 86400=24h · 604800=7d</p>
              <button onClick={handleAddPool} disabled={adminBusy || !newPool.token || !newPool.amountPerClaim}
                className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black border bg-blue-500/25 border-blue-500/50 text-blue-200 hover:bg-blue-500/35 disabled:opacity-40 disabled:cursor-not-allowed">
                {adminBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {adminBusy ? 'Creando…' : 'Crear pool'}
              </button>
            </div>
          </div>

          {/* Manage existing pools */}
          {pools.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-muted-foreground">Pools existentes ({pools.length})</p>
              {pools.map(pool => (
                <div key={pool.index} className="rounded-2xl border border-white/10 bg-black/20 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-white">#{pool.index} {pool.name || pool.symbol || 'Pool'}</span>
                    <span className={cn('text-[9px] font-bold rounded-full px-2 py-0.5',
                      pool.active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>
                      {pool.active ? 'ACTIVO' : 'INACTIVO'}
                    </span>
                    <span className="text-[9px] text-muted-foreground ml-auto">{fmt18(pool.balance)} tokens</span>
                  </div>
                  <p className="text-[9px] font-mono text-muted-foreground truncate">{pool.token}</p>
                  <div className="flex gap-2">
                    {/* Fund */}
                    {fundId === pool.index ? (
                      <div className="flex flex-1 gap-1">
                        <input value={fundAmount} onChange={e => setFundAmount(e.target.value)}
                          placeholder="Monto"
                          className="flex-1 rounded-lg bg-black/40 border border-white/15 px-2 py-1.5 text-xs text-white placeholder-muted-foreground outline-none" />
                        <button onClick={() => handleFundPool(pool.index)} disabled={adminBusy}
                          className="px-3 rounded-lg text-xs font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">
                          {adminBusy ? '…' : 'OK'}
                        </button>
                        <button onClick={() => { setFundId(null); setFundAmount('') }}
                          className="px-2 rounded-lg text-xs text-muted-foreground hover:text-white">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setFundId(pool.index)}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25">
                        <Fuel className="w-3 h-3" /> Fondear
                      </button>
                    )}
                    {/* Toggle active */}
                    <button onClick={() => handleToggleActive(pool)} disabled={adminBusy}
                      className={cn('flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold border disabled:opacity-40',
                        pool.active
                          ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25'
                          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25')}>
                      {pool.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    </button>
                    {/* Withdraw all */}
                    {pool.balance > 0n && (
                      <button onClick={() => handleWithdrawAll(pool.index)} disabled={adminBusy}
                        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 disabled:opacity-40">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Contract info */}
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3 space-y-1">
            <p className="text-[9px] text-muted-foreground font-bold">Contrato AcuaFreeClaim</p>
            <p className="text-[9px] font-mono text-muted-foreground break-all">{ACUA_FREE_CLAIM_ADDRESS}</p>
          </div>
        </div>
      )}
    </div>
  )
}
