'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Shield, Plus, RefreshCw, Loader2, Settings,
  Coins, TrendingUp, Users, AlertTriangle, Wallet,
  Trash2, ChevronDown, ChevronUp, DollarSign, Lock, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ACUA_AUTOSTAKE_ADDRESS, DEPLOYED, H2O_TOKEN,
  ADD_TOKEN_ABI, SET_APR_ABI, SET_FEES_ABI,
  ADD_OWNER_ABI, REMOVE_OWNER_ABI, SET_OWNER2_ABI,
  FUND_PERMIT2_ABI, SET_MIN_STAKE_ABI, EMERGENCY_WITHDRAW_ABI,
  fetchContractStats, randomNonce, fmtToken, formatApr,
  type ContractStats, type TokenInfo,
} from '@/lib/autostake'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

function Section({ title, icon, accent = 'blue', children, defaultOpen = false, badge }: {
  title: string; icon: React.ReactNode; accent?: string; children: React.ReactNode
  defaultOpen?: boolean; badge?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const colors: Record<string, string> = {
    blue: '#3b82f6', violet: '#8b5cf6', emerald: '#10b981',
    amber: '#f59e0b', red: '#ef4444', slate: '#64748b', indigo: '#6366f1',
  }
  const c = colors[accent] ?? '#3b82f6'
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: c + '30' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 transition-colors hover:bg-white/5"
        style={{ background: c + '0c' }}>
        <span style={{ color: c }}>{icon}</span>
        <span className="text-xs font-bold text-foreground uppercase tracking-wide flex-1 text-left">{title}</span>
        {badge && <span className="text-[8px] px-1.5 py-0.5 rounded font-bold" style={{ background: c + '25', color: c }}>{badge}</span>}
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground/40" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/40" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', hint, mono = false }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; hint?: string; mono?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-mono text-muted-foreground/70 uppercase tracking-wide">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={cn('w-full rounded-xl border border-border/60 bg-black/30 px-3 py-2 text-xs outline-none focus:border-[oklch(0.65_0.22_255)]/50 placeholder:text-muted-foreground/30 transition-colors', mono && 'font-mono')} />
      {hint && <p className="text-[9px] text-muted-foreground/40 font-mono">{hint}</p>}
    </div>
  )
}

function Btn({ label, loading, disabled, onClick, color = '#3b82f6' }: {
  label: string; loading: boolean; disabled?: boolean; onClick: () => void; color?: string
}) {
  return (
    <button disabled={loading || disabled} onClick={onClick}
      className="w-full rounded-xl py-2.5 text-xs font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
      style={{ background: color + '22', border: `1px solid ${color}40`, color }}>
      {loading && <Loader2 className="w-3 h-3 animate-spin" />} {label}
    </button>
  )
}

export function AutoStakeOwnerPanel({ userAddress }: Props) {
  const [stats, setStats]         = useState<ContractStats | null>(null)
  const [loading, setLoading]     = useState(true)
  const [isOwner, setIsOwner]     = useState(false)
  const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  // add token
  const [newToken, setNewToken]   = useState('')
  const [newApr, setNewApr]       = useState('')
  const [newMin, setNewMin]       = useState('1000')
  const [addingToken, setAddingToken] = useState(false)
  // set APR
  const [aprToken, setAprToken]   = useState('')
  const [aprBps, setAprBps]       = useState('')
  const [settingApr, setSettingApr] = useState(false)
  // set min stake
  const [minToken, setMinToken]   = useState('')
  const [minAmt, setMinAmt]       = useState('1000')
  const [settingMin, setSettingMin] = useState(false)
  // fees
  const [feeStake, setFeeStake]   = useState('500')
  const [feeUnstk, setFeeUnstk]   = useState('500')
  const [feeClaim, setFeeClaim]   = useState('1000')
  const [settingFees, setSettingFees] = useState(false)
  // fund
  const [fundToken, setFundToken] = useState(H2O_TOKEN)
  const [fundAmt, setFundAmt]     = useState('')
  const [funding, setFunding]     = useState(false)
  // owners
  const [addOwner, setAddOwner]   = useState('')
  const [addingOwner, setAddingOwner] = useState(false)
  const [rmOwner, setRmOwner]     = useState('')
  const [removingOwner, setRemovingOwner] = useState(false)
  const [o2Addr, setO2Addr]       = useState('')
  const [settingO2, setSettingO2] = useState(false)
  // emergency
  const [emgToken, setEmgToken]   = useState('')
  const [emgAmt, setEmgAmt]       = useState('')
  const [emgLoading, setEmgLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await fetchContractStats()
      setStats(s)
      const isOw = s.owners.some(o => o.toLowerCase() === userAddress?.toLowerCase())
      setIsOwner(isOw)
      setFeeStake(String(Math.round(s.stakeFeePct * 100)))
      setFeeUnstk(String(Math.round(s.unstakeFeePct * 100)))
      setFeeClaim(String(Math.round(s.claimFeePct * 100)))
    } catch (e) { console.error('[AutoStakeOwner]', e) }
    finally { setLoading(false) }
  }, [userAddress])

  useEffect(() => { load() }, [load])

  function showMsg(ok: boolean, text: string) { setMsg({ ok, text }); setTimeout(() => setMsg(null), 7000) }

  async function sendTx(txObj: object, label: string) {
    const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: [txObj as any] })
    if (finalPayload.status === 'success') { showMsg(true, `✓ ${label}`); setTimeout(load, 2500); return true }
    showMsg(false, (finalPayload as any).message ?? 'Rechazado'); return false
  }

  async function doAddToken() {
    const aprV = Math.round(parseFloat(newApr) * 100)
    if (aprV > 10000) return showMsg(false, 'APR máximo 100%')
    const minV = ethers.parseUnits(newMin || '0', 18)
    setAddingToken(true)
    try { await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: ADD_TOKEN_ABI, functionName: 'addToken', args: [newToken, aprV.toString(), minV.toString()] }, `Token añadido (${newApr}% APR, mín ${newMin})`) }
    catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setAddingToken(false) }
  }
  async function doSetApr() {
    const v = parseInt(aprBps); if (v > 10000) return showMsg(false, 'Max 10000 BPS')
    setSettingApr(true)
    try { await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_APR_ABI, functionName: 'setApr', args: [aprToken, v.toString()] }, `APR → ${(v / 100).toFixed(2)}%`) }
    catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingApr(false) }
  }
  async function doSetMin() {
    const minV = ethers.parseUnits(minAmt || '0', 18)
    setSettingMin(true)
    try { await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_MIN_STAKE_ABI, functionName: 'setMinStake', args: [minToken, minV.toString()] }, `Mín stake → ${minAmt}`) }
    catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingMin(false) }
  }
  async function doSetFees() {
    const s = parseInt(feeStake), u = parseInt(feeUnstk), c = parseInt(feeClaim)
    if (s > 1000 || u > 1000 || c > 2000) return showMsg(false, 'Fees muy altos')
    setSettingFees(true)
    try { await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_FEES_ABI, functionName: 'setFees', args: [s.toString(), u.toString(), c.toString()] }, `Fees: ${s / 100}% / ${u / 100}% / ${c / 100}%`) }
    catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingFees(false) }
  }
  async function doFund() {
    if (!fundAmt || parseFloat(fundAmt) <= 0) return
    setFunding(true)
    try {
      const amtWei = ethers.parseUnits(fundAmt, 18)
      const nonce  = randomNonce(); const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_AUTOSTAKE_ADDRESS, abi: FUND_PERMIT2_ABI, functionName: 'fundRewardsPermit2',
          args: [fundToken, amtWei.toString(), { permitted: { token: fundToken, amount: amtWei.toString() }, nonce: nonce.toString(), deadline: deadline.toString() }, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'] }],
        permit2: [{ permitted: { token: fundToken, amount: amtWei.toString() }, spender: ACUA_AUTOSTAKE_ADDRESS, nonce: nonce.toString(), deadline: deadline.toString() }],
      })
      if (finalPayload.status === 'success') { showMsg(true, `✓ Pool fondeado con ${fundAmt}`); setFundAmt(''); setTimeout(load, 2500) }
      else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setFunding(false) }
  }
  async function doAddOwner() {
    setAddingOwner(true)
    try { await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: ADD_OWNER_ABI, functionName: 'addOwner', args: [addOwner] }, `Owner añadido: ${addOwner.slice(0, 12)}…`); setAddOwner('') }
    catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setAddingOwner(false) }
  }
  async function doRmOwner() {
    setRemovingOwner(true)
    try { await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: REMOVE_OWNER_ABI, functionName: 'removeOwner', args: [rmOwner] }, `Owner removido: ${rmOwner.slice(0, 12)}…`); setRmOwner('') }
    catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setRemovingOwner(false) }
  }
  async function doSetO2() {
    setSettingO2(true)
    try { await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_OWNER2_ABI, functionName: 'setOwner2', args: [o2Addr] }, 'Owner2 actualizado'); setO2Addr('') }
    catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingO2(false) }
  }
  async function doEmergency() {
    if (!emgToken || !emgAmt) return
    setEmgLoading(true)
    try {
      const amtWei = ethers.parseUnits(emgAmt, 18)
      await sendTx({ address: ACUA_AUTOSTAKE_ADDRESS, abi: EMERGENCY_WITHDRAW_ABI, functionName: 'emergencyWithdraw', args: [emgToken, amtWei.toString()] }, `Retiro emergencia: ${emgAmt}`)
      setEmgAmt('')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setEmgLoading(false) }
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center py-12 gap-3">
        <Loader2 className="w-8 h-8 text-[oklch(0.65_0.22_255)] animate-spin" />
        <p className="text-xs text-muted-foreground font-mono">Verificando acceso...</p>
      </div>
    )
  }

  // ── Not deployed ──
  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center py-12 px-4 space-y-3">
        <AlertTriangle className="w-7 h-7 text-yellow-400" />
        <p className="font-semibold text-center">Contrato pendiente de deploy</p>
      </div>
    )
  }

  // ── Not owner ──
  if (!isOwner) {
    return (
      <div className="flex flex-col items-center py-12 px-4 space-y-5">
        <div className="relative w-16 h-16 flex items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/5">
          <Lock className="w-8 h-8 text-red-400" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="font-black text-base text-foreground">Acceso Denegado</p>
          <p className="text-xs text-muted-foreground">Tu wallet no es owner de este contrato</p>
        </div>
        <div className="w-full max-w-xs rounded-xl border border-border bg-muted/10 p-3 space-y-2">
          <p className="text-[9px] font-mono font-bold text-muted-foreground uppercase">Tu wallet</p>
          <p className="font-mono text-[9px] text-foreground/70 break-all">{userAddress || '—'}</p>
          {stats && (
            <>
              <p className="text-[9px] font-mono font-bold text-muted-foreground uppercase mt-2">Owners autorizados</p>
              {stats.owners.map(o => (
                <p key={o} className="font-mono text-[9px] text-foreground/70 break-all">{o}</p>
              ))}
            </>
          )}
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <RefreshCw className="w-3.5 h-3.5" /> Recargar
        </button>
      </div>
    )
  }

  // ── Owner panel ──
  return (
    <div className="space-y-3 pb-6">

      {/* ── Admin header ── */}
      <div className="relative rounded-2xl border overflow-hidden"
        style={{ borderColor: '#8b5cf640', background: 'linear-gradient(135deg, #0f0a1a 0%, #080810 100%)' }}>
        <div className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, #8b5cf6, transparent)' }} />
        <div className="px-4 py-4 flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: '#8b5cf615', border: '1.5px solid #8b5cf640' }}>
            <Shield className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="font-black text-sm text-violet-300 tracking-wide uppercase">Admin Panel</h2>
            <p className="text-[9px] font-mono text-muted-foreground">{userAddress?.slice(0, 14)}… · OWNER ✓</p>
          </div>
          <button onClick={load} disabled={loading} className="ml-auto p-2 rounded-lg hover:bg-white/5">
            <RefreshCw className={cn('w-4 h-4 text-muted-foreground', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {msg && (
        <div className={cn('rounded-xl border px-4 py-2.5 text-xs font-mono font-bold',
          msg.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                 : 'border-red-500/30 bg-red-500/5 text-red-400')}>
          {msg.text}
        </div>
      )}

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: 'Fee Stake', v: `${stats.stakeFeePct}%`, c: '#f59e0b' },
            { l: 'Fee Unstake', v: `${stats.unstakeFeePct}%`, c: '#f97316' },
            { l: 'Fee Claim', v: `${stats.claimFeePct}%`, c: '#ef4444' },
          ].map(s => (
            <div key={s.l} className="rounded-xl border p-2.5 text-center"
              style={{ borderColor: s.c + '30', background: s.c + '08' }}>
              <p className="text-sm font-black" style={{ color: s.c }}>{s.v}</p>
              <p className="text-[8px] text-muted-foreground font-mono mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tokens overview */}
      {stats && stats.tokens.length > 0 && (
        <Section title="Tokens" icon={<Coins className="w-4 h-4" />} accent="blue" badge={`${stats.tokens.length}`} defaultOpen>
          <div className="space-y-2">
            {stats.tokens.map(tk => (
              <div key={tk.address} className="rounded-xl border border-border/40 bg-black/20 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-foreground">{tk.symbol}</span>
                  <span className="text-xs font-black text-emerald-400">{formatApr(tk.aprBps)}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 text-[9px]">
                  <span className="text-muted-foreground">Stakers: <span className="text-foreground">{tk.stakersCount.toString()}</span></span>
                  <span className="text-muted-foreground">Fondo: <span className="text-foreground">{fmtToken(tk.rewardFund, 18, 1)}</span></span>
                  <span className="text-muted-foreground">Mín: <span className="text-rose-400">{fmtToken(tk.minStake, 18, 0)}</span></span>
                </div>
                <p className="font-mono text-[8px] text-muted-foreground/40 truncate">{tk.address}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Owners */}
      {stats && (
        <Section title="Owners" icon={<Users className="w-4 h-4" />} accent="violet" badge={`${stats.owners.length}`} defaultOpen>
          <div className="space-y-1.5">
            {stats.owners.map(o => (
              <div key={o} className="flex items-center gap-2 rounded-xl bg-violet-500/5 border border-violet-500/20 px-3 py-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="font-mono text-[9px] flex-1 truncate">{o}</span>
                {o.toLowerCase() === userAddress?.toLowerCase() && (
                  <span className="text-[8px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded font-bold">TÚ</span>
                )}
              </div>
            ))}
            <div className="rounded-xl bg-muted/10 border border-border/30 px-3 py-2 mt-1">
              <p className="text-[8px] font-mono text-muted-foreground">OWNER2 (fees) → <span className="text-foreground/70">{stats.owner2.slice(0, 18)}…</span></p>
            </div>
          </div>
        </Section>
      )}

      {/* Add token */}
      <Section title="Añadir token" icon={<Plus className="w-4 h-4" />} accent="emerald">
        <Field label="Dirección" value={newToken} onChange={setNewToken} placeholder="0x..." mono />
        <div className="grid grid-cols-2 gap-2">
          <Field label="APR (%)" value={newApr} onChange={setNewApr} placeholder="50" type="number" />
          <Field label="Min stake" value={newMin} onChange={setNewMin} placeholder="1000" type="number" />
        </div>
        <Btn label="Añadir token al contrato" loading={addingToken} disabled={!newToken || !newApr} onClick={doAddToken} color="#10b981" />
        <p className="text-[8px] font-mono text-muted-foreground/50">H2O: {H2O_TOKEN.slice(0, 18)}…</p>
      </Section>

      {/* APR */}
      <Section title="Cambiar APR" icon={<TrendingUp className="w-4 h-4" />} accent="blue">
        <Field label="Token" value={aprToken} onChange={setAprToken} placeholder="0x..." mono />
        <Field label="APR en BPS (5000 = 50%)" value={aprBps} onChange={setAprBps} placeholder="5000" type="number" hint="Max 10000 = 100%" />
        {stats && stats.tokens.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.tokens.map(tk => (
              <button key={tk.address} onClick={() => setAprToken(tk.address)}
                className="text-[9px] px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 font-mono">
                {tk.symbol}
              </button>
            ))}
          </div>
        )}
        <Btn label="Actualizar APR" loading={settingApr} disabled={!aprToken || !aprBps} onClick={doSetApr} color="#3b82f6" />
      </Section>

      {/* Min stake */}
      <Section title="Stake mínimo por token" icon={<DollarSign className="w-4 h-4" />} accent="amber">
        <Field label="Token" value={minToken} onChange={setMinToken} placeholder="0x..." mono />
        <Field label="Mínimo (tokens)" value={minAmt} onChange={setMinAmt} placeholder="1000" type="number" hint="0 = sin mínimo" />
        {stats && stats.tokens.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.tokens.map(tk => (
              <button key={tk.address} onClick={() => { setMinToken(tk.address); setMinAmt(fmtToken(tk.minStake, 18, 0)) }}
                className="text-[9px] px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono">
                {tk.symbol}: {fmtToken(tk.minStake, 18, 0)}
              </button>
            ))}
          </div>
        )}
        <Btn label="Actualizar mínimo" loading={settingMin} disabled={!minToken} onClick={doSetMin} color="#f59e0b" />
      </Section>

      {/* Fees */}
      <Section title="Comisiones" icon={<Settings className="w-4 h-4" />} accent="slate">
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: 'Stake BPS', v: feeStake, s: setFeeStake, ph: '500' },
            { l: 'Unstake BPS', v: feeUnstk, s: setFeeUnstk, ph: '500' },
            { l: 'Claim BPS', v: feeClaim, s: setFeeClaim, ph: '1000' },
          ].map(f => (
            <div key={f.l} className="space-y-1">
              <label className="text-[8px] font-mono text-muted-foreground/60 uppercase">{f.l}</label>
              <input type="number" value={f.v} onChange={e => f.s(e.target.value)} placeholder={f.ph}
                className="w-full rounded-xl border border-border/60 bg-black/30 px-2 py-2 text-xs outline-none font-mono text-center" />
            </div>
          ))}
        </div>
        <p className="text-[8px] font-mono text-muted-foreground/40">100 BPS = 1% · Max stake/unstake 10% · Max claim 20%</p>
        <Btn label="Guardar fees" loading={settingFees} onClick={doSetFees} color="#64748b" />
      </Section>

      {/* Fund rewards */}
      <Section title="Fondear pool de rewards" icon={<Wallet className="w-4 h-4" />} accent="emerald">
        <Field label="Token a fondear" value={fundToken} onChange={setFundToken} placeholder="0x..." mono />
        {stats && stats.tokens.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.tokens.map(tk => (
              <button key={tk.address} onClick={() => setFundToken(tk.address)}
                className="text-[9px] px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                {tk.symbol}
              </button>
            ))}
          </div>
        )}
        <Field label="Cantidad" value={fundAmt} onChange={setFundAmt} placeholder="1000" type="number" />
        <Btn label="Fondear vía Permit2 (sin approve)" loading={funding} disabled={!fundAmt || parseFloat(fundAmt) <= 0} onClick={doFund} color="#10b981" />
        <p className="text-[8px] font-mono text-muted-foreground/40">World App firma. Sin aprobación previa.</p>
      </Section>

      {/* Owner management */}
      <Section title="Gestión de owners" icon={<Shield className="w-4 h-4" />} accent="violet">
        <Field label="Añadir owner" value={addOwner} onChange={setAddOwner} placeholder="0x..." mono />
        <Btn label="Añadir owner" loading={addingOwner} disabled={!addOwner} onClick={doAddOwner} color="#8b5cf6" />
        <div className="border-t border-border/20 pt-3">
          <Field label="Remover owner" value={rmOwner} onChange={setRmOwner} placeholder="0x..." mono />
          <Btn label="Remover owner" loading={removingOwner} disabled={!rmOwner} onClick={doRmOwner} color="#ef4444" />
        </div>
        <div className="border-t border-border/20 pt-3">
          <Field label="Cambiar owner2 (recibe fees)" value={o2Addr} onChange={setO2Addr} placeholder="0x..." mono hint="4% stake/unstake + 8% claim → owner2" />
          <Btn label="Actualizar owner2" loading={settingO2} disabled={!o2Addr} onClick={doSetO2} color="#64748b" />
        </div>
      </Section>

      {/* Emergency */}
      <Section title="⚠️ Retiro de emergencia" icon={<Trash2 className="w-4 h-4" />} accent="red">
        <Field label="Token" value={emgToken} onChange={setEmgToken} placeholder="0x..." mono />
        <Field label="Cantidad" value={emgAmt} onChange={setEmgAmt} placeholder="100" type="number" />
        <Btn label="RETIRAR (EMERGENCIA)" loading={emgLoading} disabled={!emgToken || !emgAmt} onClick={doEmergency} color="#ef4444" />
        <p className="text-[8px] font-mono text-red-400/50">Solo en casos de emergencia. Transfiere al owner.</p>
      </Section>
    </div>
  )
}
