'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Shield, Plus, RefreshCw, Loader2, Settings,
  Coins, TrendingUp, Users, AlertTriangle, Wallet,
  Trash2, ChevronDown, ChevronUp, DollarSign,
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

// ─── Collapsible section ─────────────────────────────────────────────────────
function Section({ title, icon, accent = 'blue', children, defaultOpen = false }: {
  title: string; icon: React.ReactNode; accent?: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const colors: Record<string, string> = {
    blue: 'text-[oklch(0.65_0.22_255)]', violet: 'text-violet-400',
    emerald: 'text-emerald-400', amber: 'text-amber-400',
    red: 'text-red-400', slate: 'text-slate-400',
  }
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors"
      >
        <span className={colors[accent] ?? 'text-foreground'}>{icon}</span>
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide flex-1 text-left">{title}</span>
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

function InputRow({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; hint?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs outline-none focus:border-[oklch(0.65_0.22_255)]/60 placeholder:text-muted-foreground/40"
      />
      {hint && <p className="text-[9px] text-muted-foreground/70">{hint}</p>}
    </div>
  )
}

function ActionBtn({ label, loading, disabled, onClick, variant = 'blue' }: {
  label: string; loading: boolean; disabled?: boolean; onClick: () => void; variant?: string
}) {
  const cls: Record<string, string> = {
    blue: 'bg-[oklch(0.65_0.22_255)] hover:bg-[oklch(0.60_0.22_255)]',
    violet: 'bg-violet-600 hover:bg-violet-700', emerald: 'bg-emerald-600 hover:bg-emerald-700',
    amber: 'bg-amber-600 hover:bg-amber-700', red: 'bg-red-600 hover:bg-red-700',
    slate: 'bg-slate-600 hover:bg-slate-700',
  }
  return (
    <Button size="sm" className={cn('w-full text-xs', cls[variant])} disabled={loading || disabled} onClick={onClick}>
      {loading && <Loader2 className="w-3 h-3 animate-spin mr-1" />} {label}
    </Button>
  )
}

export function AutoStakeOwnerPanel({ userAddress }: Props) {
  const [stats, setStats]   = useState<ContractStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]       = useState<{ ok: boolean; text: string } | null>(null)

  // add token
  const [newToken, setNewToken]     = useState('')
  const [newApr, setNewApr]         = useState('')
  const [newMin, setNewMin]         = useState('1000')
  const [addingToken, setAddingToken] = useState(false)

  // set APR
  const [aprToken, setAprToken]     = useState('')
  const [aprBps, setAprBps]         = useState('')
  const [settingApr, setSettingApr] = useState(false)

  // set min stake
  const [minToken, setMinToken]     = useState('')
  const [minAmount, setMinAmount]   = useState('1000')
  const [settingMin, setSettingMin] = useState(false)

  // set fees
  const [feeStake, setFeeStake]     = useState('500')
  const [feeUnstake, setFeeUnstake] = useState('500')
  const [feeClaim, setFeeClaim]     = useState('1000')
  const [settingFees, setSettingFees] = useState(false)

  // fund rewards
  const [fundToken, setFundToken]   = useState(H2O_TOKEN)
  const [fundAmount, setFundAmount] = useState('')
  const [funding, setFunding]       = useState(false)

  // owners
  const [newOwner, setNewOwner]     = useState('')
  const [addingOwner, setAddingOwner] = useState(false)
  const [rmOwner, setRmOwner]       = useState('')
  const [removingOwner, setRemovingOwner] = useState(false)
  const [owner2Addr, setOwner2Addr] = useState('')
  const [settingOwner2, setSettingOwner2] = useState(false)

  // emergency
  const [emgToken, setEmgToken]     = useState('')
  const [emgAmount, setEmgAmount]   = useState('')
  const [emgLoading, setEmgLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await fetchContractStats()
      setStats(s)
      setFeeStake(String(Math.round(s.stakeFeePct * 100)))
      setFeeUnstake(String(Math.round(s.unstakeFeePct * 100)))
      setFeeClaim(String(Math.round(s.claimFeePct * 100)))
    } catch (e) { console.error('[AutoStakeOwner]', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function showMsg(ok: boolean, text: string) {
    setMsg({ ok, text }); setTimeout(() => setMsg(null), 6000)
  }

  async function sendTx(txObj: object, label: string) {
    const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
      transaction: [txObj as any],
    })
    if (finalPayload.status === 'success') {
      showMsg(true, `✓ ${label}`)
      setTimeout(load, 2000)
      return true
    }
    showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    return false
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function doAddToken() {
    if (!newToken || !newApr) return
    const aprV = Math.round(parseFloat(newApr) * 100)
    const minV = ethers.parseUnits(newMin || '0', 18)
    if (aprV > 10000) return showMsg(false, 'APR máximo 100%')
    setAddingToken(true)
    try {
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: ADD_TOKEN_ABI,
        functionName: 'addToken', args: [newToken, aprV.toString(), minV.toString()],
      }, `Token ${newToken.slice(0, 10)}… añadido (${newApr}% APR, min ${newMin})`)
      setNewToken(''); setNewApr(''); setNewMin('1000')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setAddingToken(false) }
  }

  async function doSetApr() {
    if (!aprToken || !aprBps) return
    const v = parseInt(aprBps)
    if (v > 10000) return showMsg(false, 'Max 10000 BPS (100%)')
    setSettingApr(true)
    try {
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_APR_ABI,
        functionName: 'setApr', args: [aprToken, v.toString()],
      }, `APR → ${(v / 100).toFixed(2)}%`)
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingApr(false) }
  }

  async function doSetMinStake() {
    if (!minToken) return
    const minV = ethers.parseUnits(minAmount || '0', 18)
    setSettingMin(true)
    try {
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_MIN_STAKE_ABI,
        functionName: 'setMinStake', args: [minToken, minV.toString()],
      }, `Stake mínimo → ${minAmount} tokens`)
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingMin(false) }
  }

  async function doSetFees() {
    const s = parseInt(feeStake), u = parseInt(feeUnstake), c = parseInt(feeClaim)
    if (s > 1000 || u > 1000 || c > 2000) return showMsg(false, 'Fees muy altos')
    setSettingFees(true)
    try {
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_FEES_ABI,
        functionName: 'setFees', args: [s.toString(), u.toString(), c.toString()],
      }, `Fees: stake ${s / 100}% | unstake ${u / 100}% | claim ${c / 100}%`)
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingFees(false) }
  }

  async function doFundRewards() {
    if (!fundToken || !fundAmount || parseFloat(fundAmount) <= 0) return
    setFunding(true)
    try {
      const amtWei   = ethers.parseUnits(fundAmount, 18)
      const nonce    = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS, abi: FUND_PERMIT2_ABI,
          functionName: 'fundRewardsPermit2',
          args: [
            fundToken, amtWei.toString(),
            { permitted: { token: fundToken, amount: amtWei.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }],
        permit2: [{
          permitted: { token: fundToken, amount: amtWei.toString() },
          spender: ACUA_AUTOSTAKE_ADDRESS, nonce: nonce.toString(), deadline: deadline.toString(),
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg(true, `✓ Pool fondeado con ${fundAmount} tokens`)
        setFundAmount(''); setTimeout(load, 2000)
      } else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setFunding(false) }
  }

  async function doAddOwner() {
    if (!newOwner) return
    setAddingOwner(true)
    try {
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: ADD_OWNER_ABI,
        functionName: 'addOwner', args: [newOwner],
      }, `Owner añadido: ${newOwner.slice(0, 12)}…`)
      setNewOwner('')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setAddingOwner(false) }
  }

  async function doRemoveOwner() {
    if (!rmOwner) return
    setRemovingOwner(true)
    try {
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: REMOVE_OWNER_ABI,
        functionName: 'removeOwner', args: [rmOwner],
      }, `Owner removido: ${rmOwner.slice(0, 12)}…`)
      setRmOwner('')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setRemovingOwner(false) }
  }

  async function doSetOwner2() {
    if (!owner2Addr) return
    setSettingOwner2(true)
    try {
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: SET_OWNER2_ABI,
        functionName: 'setOwner2', args: [owner2Addr],
      }, 'Owner2 actualizado')
      setOwner2Addr('')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingOwner2(false) }
  }

  async function doEmergencyWithdraw() {
    if (!emgToken || !emgAmount) return
    setEmgLoading(true)
    try {
      const amtWei = ethers.parseUnits(emgAmount, 18)
      await sendTx({
        address: ACUA_AUTOSTAKE_ADDRESS, abi: EMERGENCY_WITHDRAW_ABI,
        functionName: 'emergencyWithdraw', args: [emgToken, amtWei.toString()],
      }, `Retiro de emergencia: ${emgAmount} tokens`)
      setEmgAmount('')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setEmgLoading(false) }
  }

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-yellow-400" />
        </div>
        <p className="font-semibold text-foreground text-center">Contrato pendiente de deploy</p>
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Despliega AcuaAutoStake y actualiza <code className="text-[oklch(0.65_0.22_255)]">lib/autostake.ts</code>
        </p>
        <div className="w-full max-w-sm rounded-xl border border-border bg-muted/10 p-3 text-xs space-y-1.5 text-muted-foreground">
          <p className="font-semibold text-foreground text-[11px]">Pasos:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>cd contracts-hh</li>
            <li>npx hardhat run scripts/deploy-autostake.js --network worldchain</li>
            <li>Actualiza ACUA_AUTOSTAKE_ADDRESS en lib/autostake.ts</li>
            <li>Pon DEPLOYED = true en lib/autostake.ts</li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
          <Shield className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="font-bold text-base text-foreground">AutoStake Admin</h2>
          <p className="text-[10px] text-muted-foreground">Panel completo de gestión</p>
        </div>
        <button onClick={load} disabled={loading} className="ml-auto p-2 rounded-lg hover:bg-muted/60">
          <RefreshCw className={cn('w-4 h-4 text-muted-foreground', loading && 'animate-spin')} />
        </button>
      </div>

      {msg && (
        <div className={cn('rounded-xl border px-4 py-2.5 text-xs font-medium',
          msg.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                 : 'border-red-500/30 bg-red-500/5 text-red-400')}>
          {msg.text}
        </div>
      )}

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: 'Stake fee', v: `${stats.stakeFeePct}%`, c: 'text-amber-400' },
            { l: 'Unstake fee', v: `${stats.unstakeFeePct}%`, c: 'text-orange-400' },
            { l: 'Claim fee', v: `${stats.claimFeePct}%`, c: 'text-red-400' },
          ].map(s => (
            <div key={s.l} className="rounded-xl border border-border bg-muted/20 p-2.5 text-center">
              <p className={cn('text-sm font-bold', s.c)}>{s.v}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tokens overview */}
      {stats && stats.tokens.length > 0 && (
        <Section title="Tokens registrados" icon={<Coins className="w-4 h-4" />} accent="blue" defaultOpen>
          <div className="space-y-2">
            {stats.tokens.map(tk => (
              <div key={tk.address} className="rounded-lg border border-border bg-muted/10 px-3 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-foreground">{tk.symbol}</span>
                  <span className="text-xs font-bold text-emerald-400">{formatApr(tk.aprBps)} APR</span>
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>Stakers: {tk.stakersCount.toString()}</span>
                  <span>Fondo: {fmtToken(tk.rewardFund, 18, 2)} {tk.symbol}</span>
                  <span>Min: {fmtToken(tk.minStake, 18, 0)} {tk.symbol}</span>
                </div>
                <p className="font-mono text-[8px] text-muted-foreground/50 mt-1 truncate">{tk.address}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Owners */}
      {stats && (
        <Section title={`Owners (${stats.owners.length})`} icon={<Users className="w-4 h-4" />} accent="violet" defaultOpen>
          <div className="space-y-1">
            {stats.owners.map(o => (
              <div key={o} className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="font-mono text-[10px] flex-1 truncate">{o}</span>
                {o.toLowerCase() === userAddress.toLowerCase() && (
                  <span className="text-[9px] bg-[oklch(0.65_0.22_255)]/20 text-[oklch(0.65_0.22_255)] px-1.5 py-0.5 rounded">Tú</span>
                )}
              </div>
            ))}
            <p className="text-[9px] text-muted-foreground pt-1">
              Owner2 (fees): <span className="font-mono">{stats.owner2.slice(0, 18)}…</span>
            </p>
          </div>
        </Section>
      )}

      {/* ── Add token */}
      <Section title="Añadir token" icon={<Plus className="w-4 h-4" />} accent="emerald">
        <InputRow label="Dirección del token" value={newToken} onChange={setNewToken} placeholder="0x..." />
        <div className="grid grid-cols-2 gap-2">
          <InputRow label="APR (%)" value={newApr} onChange={setNewApr} placeholder="50" type="number" />
          <InputRow label="Min stake (tokens)" value={newMin} onChange={setNewMin} placeholder="1000" type="number" />
        </div>
        <ActionBtn label="Añadir token" loading={addingToken} disabled={!newToken || !newApr} onClick={doAddToken} variant="emerald" />
        <p className="text-[9px] text-muted-foreground">H2O: {H2O_TOKEN}</p>
      </Section>

      {/* ── Set APR */}
      <Section title="Cambiar APR" icon={<TrendingUp className="w-4 h-4" />} accent="blue">
        <InputRow label="Token (dirección)" value={aprToken} onChange={setAprToken} placeholder="0x..." />
        <InputRow label="APR en BPS (5000 = 50%)" value={aprBps} onChange={setAprBps} placeholder="5000" type="number" hint="Max 10000 BPS = 100% APR" />
        {stats && stats.tokens.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.tokens.map(tk => (
              <button key={tk.address} onClick={() => setAprToken(tk.address)}
                className="text-[9px] px-2 py-1 rounded bg-muted/40 hover:bg-muted/70 text-muted-foreground">
                {tk.symbol}
              </button>
            ))}
          </div>
        )}
        <ActionBtn label="Actualizar APR" loading={settingApr} disabled={!aprToken || !aprBps} onClick={doSetApr} />
      </Section>

      {/* ── Set min stake */}
      <Section title="Stake mínimo por token" icon={<DollarSign className="w-4 h-4" />} accent="amber">
        <InputRow label="Token (dirección)" value={minToken} onChange={setMinToken} placeholder="0x..." />
        <InputRow label="Mínimo (tokens, ej: 1000)" value={minAmount} onChange={setMinAmount} placeholder="1000" type="number" hint="0 = sin mínimo" />
        {stats && stats.tokens.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.tokens.map(tk => (
              <button key={tk.address} onClick={() => { setMinToken(tk.address); setMinAmount(fmtToken(tk.minStake, 18, 0)) }}
                className="text-[9px] px-2 py-1 rounded bg-muted/40 hover:bg-muted/70 text-muted-foreground">
                {tk.symbol}: {fmtToken(tk.minStake, 18, 0)}
              </button>
            ))}
          </div>
        )}
        <ActionBtn label="Actualizar mínimo" loading={settingMin} disabled={!minToken} onClick={doSetMinStake} variant="amber" />
      </Section>

      {/* ── Fees */}
      <Section title="Comisiones" icon={<Settings className="w-4 h-4" />} accent="slate">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Stake (BPS)', val: feeStake, set: setFeeStake, ph: '500' },
            { label: 'Unstake (BPS)', val: feeUnstake, set: setFeeUnstake, ph: '500' },
            { label: 'Claim (BPS)', val: feeClaim, set: setFeeClaim, ph: '1000' },
          ].map(f => (
            <div key={f.label} className="space-y-1">
              <label className="text-[9px] text-muted-foreground">{f.label}</label>
              <input type="number" value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                className="w-full rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none" />
            </div>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground">100 BPS = 1% · Max stake/unstake 1000 · Max claim 2000</p>
        <ActionBtn label="Guardar fees" loading={settingFees} onClick={doSetFees} variant="slate" />
      </Section>

      {/* ── Fund rewards (Permit2) */}
      <Section title="Fondear pool de recompensas" icon={<Wallet className="w-4 h-4" />} accent="emerald">
        <InputRow label="Token a fondear" value={fundToken} onChange={setFundToken} placeholder="0x..." />
        {stats && stats.tokens.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {stats.tokens.map(tk => (
              <button key={tk.address} onClick={() => setFundToken(tk.address)}
                className="text-[9px] px-2 py-1 rounded bg-muted/40 hover:bg-muted/70 text-muted-foreground">
                {tk.symbol}
              </button>
            ))}
          </div>
        )}
        <InputRow label="Cantidad (tokens)" value={fundAmount} onChange={setFundAmount} placeholder="1000" type="number" />
        <ActionBtn label="Fondear vía Permit2 (sin approve)" loading={funding} disabled={!fundAmount || parseFloat(fundAmount) <= 0} onClick={doFundRewards} variant="emerald" />
        <p className="text-[9px] text-muted-foreground">Sin approve previo. World App firma la transferencia.</p>
      </Section>

      {/* ── Owner management */}
      <Section title="Gestión de owners" icon={<Shield className="w-4 h-4" />} accent="violet">
        <div className="space-y-2">
          <InputRow label="Añadir owner" value={newOwner} onChange={setNewOwner} placeholder="0x..." />
          <ActionBtn label="Añadir owner" loading={addingOwner} disabled={!newOwner} onClick={doAddOwner} variant="violet" />
        </div>
        <div className="border-t border-border/30 pt-3 space-y-2">
          <InputRow label="Remover owner" value={rmOwner} onChange={setRmOwner} placeholder="0x..." />
          <ActionBtn label="Remover owner" loading={removingOwner} disabled={!rmOwner} onClick={doRemoveOwner} variant="red" />
        </div>
        <div className="border-t border-border/30 pt-3 space-y-2">
          <InputRow label="Cambiar owner2 (recibe fees)" value={owner2Addr} onChange={setOwner2Addr} placeholder="0x..." hint="Owner2 recibe 8% claim + 4% stake/unstake" />
          <ActionBtn label="Actualizar owner2" loading={settingOwner2} disabled={!owner2Addr} onClick={doSetOwner2} variant="slate" />
        </div>
      </Section>

      {/* ── Emergency withdraw */}
      <Section title="Retiro de emergencia" icon={<Trash2 className="w-4 h-4" />} accent="red">
        <InputRow label="Token" value={emgToken} onChange={setEmgToken} placeholder="0x..." />
        <InputRow label="Cantidad" value={emgAmount} onChange={setEmgAmount} placeholder="100" type="number" />
        <ActionBtn label="⚠️ Retirar fondos (emergencia)" loading={emgLoading} disabled={!emgToken || !emgAmount} onClick={doEmergencyWithdraw} variant="red" />
        <p className="text-[9px] text-red-400/70">Solo usar en caso de emergencia. Transfiere tokens al owner.</p>
      </Section>
    </div>
  )
}
