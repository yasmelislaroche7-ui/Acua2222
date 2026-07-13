'use client'

import { useState, useEffect, useCallback } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  Shield, Plus, RefreshCw, Loader2, Settings,
  Coins, TrendingUp, Users, AlertTriangle, Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ACUA_AUTOSTAKE_ADDRESS, DEPLOYED, H2O_TOKEN,
  ADD_TOKEN_ABI, SET_APR_ABI, SET_FEES_ABI,
  ADD_OWNER_ABI, SET_OWNER2_ABI, FUND_PERMIT2_ABI,
  fetchContractStats, randomNonce, fmtToken, formatApr,
  type ContractStats, type TokenInfo,
} from '@/lib/autostake'
import { cn } from '@/lib/utils'

interface Props { userAddress: string }

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-muted/20">
        <span className="text-[oklch(0.65_0.22_255)]">{icon}</span>
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">{title}</span>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

function InputRow({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-xs outline-none focus:border-[oklch(0.65_0.22_255)]/60 placeholder:text-muted-foreground/40"
      />
    </div>
  )
}

export function AutoStakeOwnerPanel({ userAddress }: Props) {
  const [stats, setStats]         = useState<ContractStats | null>(null)
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  // Add token
  const [newToken, setNewToken]   = useState('')
  const [newApr, setNewApr]       = useState('')
  const [addingToken, setAddingToken] = useState(false)

  // Set APR
  const [aprToken, setAprToken]   = useState('')
  const [aprBps, setAprBps]       = useState('')
  const [settingApr, setSettingApr] = useState(false)

  // Set fees
  const [feeStake, setFeeStake]   = useState('')
  const [feeUnstake, setFeeUnstake] = useState('')
  const [feeClaim, setFeeClaim]   = useState('')
  const [settingFees, setSettingFees] = useState(false)

  // Fund rewards
  const [fundToken, setFundToken] = useState(H2O_TOKEN)
  const [fundAmount, setFundAmount] = useState('')
  const [funding, setFunding]     = useState(false)

  // Add owner
  const [newOwner, setNewOwner]   = useState('')
  const [addingOwner, setAddingOwner] = useState(false)

  // Set owner2
  const [owner2Addr, setOwner2Addr] = useState('')
  const [settingOwner2, setSettingOwner2] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await fetchContractStats()
      setStats(s)
      setFeeStake(String(Math.round(s.stakeFeePct * 100)))
      setFeeUnstake(String(Math.round(s.unstakeFeePct * 100)))
      setFeeClaim(String(Math.round(s.claimFeePct * 100)))
    } catch (e) { console.error('[AutoStakeOwner] load', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function showMsg(ok: boolean, text: string) {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 5000)
  }

  async function doAddToken() {
    if (!newToken || !newApr) return
    const aprBpsVal = Math.round(parseFloat(newApr) * 100)
    if (aprBpsVal > 10000) return showMsg(false, 'APR máximo 100%')
    setAddingToken(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: ADD_TOKEN_ABI,
          functionName: 'addToken',
          args: [newToken, aprBpsVal.toString()],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg(true, `✓ Token ${newToken.slice(0, 8)}… añadido con ${newApr}% APR`)
        setNewToken(''); setNewApr('')
        setTimeout(load, 2000)
      } else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setAddingToken(false) }
  }

  async function doSetApr() {
    if (!aprToken || !aprBps) return
    const bpsVal = parseInt(aprBps)
    if (bpsVal > 10000) return showMsg(false, 'APR máximo 100% (10000 BPS)')
    setSettingApr(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: SET_APR_ABI,
          functionName: 'setApr',
          args: [aprToken, bpsVal.toString()],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg(true, `✓ APR actualizado a ${(bpsVal / 100).toFixed(2)}%`)
        setTimeout(load, 2000)
      } else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingApr(false) }
  }

  async function doSetFees() {
    setSettingFees(true)
    try {
      const s = parseInt(feeStake), u = parseInt(feeUnstake), c = parseInt(feeClaim)
      if (s > 1000 || u > 1000 || c > 2000) return showMsg(false, 'Fees demasiado altos')
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: SET_FEES_ABI,
          functionName: 'setFees',
          args: [s.toString(), u.toString(), c.toString()],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg(true, `✓ Fees: stake ${s / 100}% | unstake ${u / 100}% | claim ${c / 100}%`)
        setTimeout(load, 2000)
      } else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
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
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: FUND_PERMIT2_ABI,
          functionName: 'fundRewardsPermit2',
          args: [
            fundToken,
            amtWei.toString(),
            {
              permitted: { token: fundToken, amount: amtWei.toString() },
              nonce: nonce.toString(),
              deadline: deadline.toString(),
            },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }],
        permit2: [{
          permitted: { token: fundToken, amount: amtWei.toString() },
          spender: ACUA_AUTOSTAKE_ADDRESS,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg(true, `✓ Pool fondeado con ${fundAmount} tokens`)
        setFundAmount('')
        setTimeout(load, 2000)
      } else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setFunding(false) }
  }

  async function doAddOwner() {
    if (!newOwner) return
    setAddingOwner(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: ADD_OWNER_ABI,
          functionName: 'addOwner',
          args: [newOwner],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg(true, `✓ Owner añadido: ${newOwner.slice(0, 10)}…`)
        setNewOwner('')
        setTimeout(load, 2000)
      } else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setAddingOwner(false) }
  }

  async function doSetOwner2() {
    if (!owner2Addr) return
    setSettingOwner2(true)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: ACUA_AUTOSTAKE_ADDRESS,
          abi: SET_OWNER2_ABI,
          functionName: 'setOwner2',
          args: [owner2Addr],
        }],
      })
      if (finalPayload.status === 'success') {
        showMsg(true, `✓ Owner2 actualizado`)
        setOwner2Addr('')
        setTimeout(load, 2000)
      } else showMsg(false, (finalPayload as any).message ?? 'Rechazado')
    } catch (e: any) { showMsg(false, e?.message ?? 'Error') }
    finally { setSettingOwner2(false) }
  }

  if (!DEPLOYED) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-yellow-400" />
        </div>
        <p className="font-semibold text-foreground">Contrato pendiente de deploy</p>
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          Despliega AcuaAutoStake en World Chain y actualiza la dirección en <code className="text-[oklch(0.65_0.22_255)]">lib/autostake.ts</code> para activar este panel.
        </p>
        <div className="w-full max-w-sm rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-3 font-mono text-xs break-all text-yellow-400/70">
          {ACUA_AUTOSTAKE_ADDRESS}
          <br />
          <span className="text-yellow-400/40">// Reemplaza con dirección real después del deploy</span>
        </div>
        <div className="w-full max-w-sm rounded-xl border border-border bg-muted/10 p-3 text-xs space-y-2 text-muted-foreground">
          <p className="font-semibold text-foreground text-[11px]">Pasos para deploy:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>cd contracts-hh && npm install</li>
            <li>Configura .env con PRIVATE_KEY + RPC World Chain</li>
            <li>npx hardhat run scripts/deployAutoStake.js --network worldchain</li>
            <li>Actualiza ACUA_AUTOSTAKE_ADDRESS en lib/autostake.ts</li>
            <li>Cambia DEPLOYED = true en lib/autostake.ts</li>
            <li>Llama addToken(H2O_TOKEN, 5000) para 50% APR inicial</li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
          <Shield className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="font-bold text-base text-foreground">AutoStake Admin</h2>
          <p className="text-[10px] text-muted-foreground">Gestión de tokens, fees, owners y fondos</p>
        </div>
        <button onClick={load} disabled={loading} className="ml-auto p-2 rounded-lg hover:bg-muted/60">
          <RefreshCw className={cn('w-4 h-4 text-muted-foreground', loading && 'animate-spin')} />
        </button>
      </div>

      {msg && (
        <div className={cn('rounded-xl border px-4 py-3 text-xs text-center font-medium',
          msg.ok
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
            : 'border-red-500/30 bg-red-500/5 text-red-400'
        )}>
          {msg.text}
        </div>
      )}

      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Fee Stake', value: `${stats.stakeFeePct}%`, color: 'text-amber-400' },
            { label: 'Fee Unstake', value: `${stats.unstakeFeePct}%`, color: 'text-orange-400' },
            { label: 'Fee Claim', value: `${stats.claimFeePct}%`, color: 'text-red-400' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-muted/20 p-2.5 text-center">
              <p className={cn('text-sm font-bold', s.color)}>{s.value}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Token overview */}
      {stats && stats.tokens.length > 0 && (
        <Section title="Tokens en stake" icon={<Coins className="w-4 h-4" />}>
          <div className="space-y-2">
            {stats.tokens.map(tk => (
              <div key={tk.address} className="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-foreground">{tk.symbol}</p>
                  <p className="text-[9px] text-muted-foreground font-mono">{tk.address.slice(0, 14)}…</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-emerald-400">{formatApr(tk.aprBps)} APR</p>
                  <p className="text-[9px] text-muted-foreground">{tk.stakersCount.toString()} stakers</p>
                </div>
                <div className="text-right ml-3">
                  <p className="text-xs text-amber-400">{fmtToken(tk.rewardFund, 18, 2)}</p>
                  <p className="text-[9px] text-muted-foreground">en fondo</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Owners */}
      {stats && (
        <Section title="Owners" icon={<Users className="w-4 h-4" />}>
          <div className="space-y-1.5">
            {stats.owners.map(o => (
              <div key={o} className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="font-mono text-[10px] text-foreground flex-1">{o}</span>
                {o.toLowerCase() === userAddress.toLowerCase() && (
                  <span className="text-[9px] bg-[oklch(0.65_0.22_255)]/20 text-[oklch(0.65_0.22_255)] px-1.5 py-0.5 rounded">Tú</span>
                )}
              </div>
            ))}
            <div className="text-[10px] text-muted-foreground">
              Owner2 (comisiones): <span className="font-mono text-foreground">{stats.owner2.slice(0, 14)}…</span>
            </div>
          </div>
        </Section>
      )}

      {/* Add token */}
      <Section title="Añadir token" icon={<Plus className="w-4 h-4" />}>
        <InputRow label="Dirección del token" value={newToken} onChange={setNewToken} placeholder="0x..." />
        <InputRow label="APR (%, máximo 100)" value={newApr} onChange={setNewApr} placeholder="50" type="number" />
        <Button
          size="sm" className="w-full text-xs bg-[oklch(0.65_0.22_255)] hover:bg-[oklch(0.60_0.22_255)]"
          disabled={addingToken || !newToken || !newApr}
          onClick={doAddToken}
        >
          {addingToken ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
          Añadir token
        </Button>
      </Section>

      {/* Set APR */}
      <Section title="Cambiar APR" icon={<TrendingUp className="w-4 h-4" />}>
        <InputRow label="Token (dirección)" value={aprToken} onChange={setAprToken} placeholder="0x..." />
        <InputRow label="APR en BPS (10000 = 100%)" value={aprBps} onChange={setAprBps} placeholder="5000" type="number" />
        <Button
          size="sm" className="w-full text-xs bg-violet-600 hover:bg-violet-700"
          disabled={settingApr || !aprToken || !aprBps}
          onClick={doSetApr}
        >
          {settingApr ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <TrendingUp className="w-3 h-3 mr-1" />}
          Actualizar APR
        </Button>
        {stats && stats.tokens.length > 0 && (
          <div className="mt-2 space-y-1">
            {stats.tokens.map(tk => (
              <button
                key={tk.address}
                className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/40"
                onClick={() => setAprToken(tk.address)}
              >
                ↳ {tk.symbol}: {tk.address}
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* Set fees */}
      <Section title="Comisiones" icon={<Settings className="w-4 h-4" />}>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Stake (BPS)</label>
            <input type="number" value={feeStake} onChange={e => setFeeStake(e.target.value)}
              className="w-full rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none" placeholder="500" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Unstake (BPS)</label>
            <input type="number" value={feeUnstake} onChange={e => setFeeUnstake(e.target.value)}
              className="w-full rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none" placeholder="500" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Claim (BPS)</label>
            <input type="number" value={feeClaim} onChange={e => setFeeClaim(e.target.value)}
              className="w-full rounded-lg border border-border bg-background/60 px-2 py-1.5 text-xs outline-none" placeholder="1000" />
          </div>
        </div>
        <p className="text-[9px] text-muted-foreground">100 BPS = 1% · máx stake/unstake 1000 (10%) · máx claim 2000 (20%)</p>
        <Button
          size="sm" className="w-full text-xs bg-amber-600 hover:bg-amber-700"
          disabled={settingFees}
          onClick={doSetFees}
        >
          {settingFees ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Settings className="w-3 h-3 mr-1" />}
          Guardar fees
        </Button>
      </Section>

      {/* Fund rewards */}
      <Section title="Fondear pool de recompensas" icon={<Wallet className="w-4 h-4" />}>
        <InputRow label="Token a fondear" value={fundToken} onChange={setFundToken} placeholder="0x..." />
        <InputRow label="Cantidad" value={fundAmount} onChange={setFundAmount} placeholder="1000" type="number" />
        <Button
          size="sm" className="w-full text-xs bg-emerald-600 hover:bg-emerald-700"
          disabled={funding || !fundAmount || parseFloat(fundAmount) <= 0}
          onClick={doFundRewards}
        >
          {funding ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wallet className="w-3 h-3 mr-1" />}
          Fondear via Permit2
        </Button>
        <p className="text-[9px] text-muted-foreground">Sin approve previo. Firma desde World App.</p>
      </Section>

      {/* Owner management */}
      <Section title="Gestión de owners" icon={<Shield className="w-4 h-4" />}>
        <InputRow label="Añadir owner (dirección)" value={newOwner} onChange={setNewOwner} placeholder="0x..." />
        <Button
          size="sm" className="w-full text-xs bg-violet-600 hover:bg-violet-700"
          disabled={addingOwner || !newOwner}
          onClick={doAddOwner}
        >
          {addingOwner ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
          Añadir owner
        </Button>
        <div className="border-t border-border/40 pt-3 mt-1 space-y-2">
          <InputRow label="Cambiar owner2 (recibe 8% claim + 4% stake/unstake)" value={owner2Addr} onChange={setOwner2Addr} placeholder="0x..." />
          <Button
            size="sm" className="w-full text-xs bg-slate-600 hover:bg-slate-700"
            disabled={settingOwner2 || !owner2Addr}
            onClick={doSetOwner2}
          >
            {settingOwner2 ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Shield className="w-3 h-3 mr-1" />}
            Actualizar owner2
          </Button>
        </div>
      </Section>
    </div>
  )
}
