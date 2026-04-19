'use client'

import { useState, useEffect } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Button } from '@/components/ui/button'
import { Loader2, Lock, Unlock, Gift, ChevronRight, Users, Star, Link as LinkIcon } from 'lucide-react'
import { H2O_STAKING_ADDRESS, H2O_STAKING_ABI } from '@/lib/h2oStaking'
import { getOldStakingInfo, withdrawOld, claimOld } from '@/lib/oldStakingService'
import { formatToken } from '@/lib/contract'

const REF_BASE = "https://worldcoin.org/mini-app?app_id=app_60f2dc429532dcfa014c16d52ddc00fe&app_mode=mini-app"

export function StakePanel({ userAddress, stakingInfo = {}, onRefresh }) {
  // Estado para migración
  const [oldBalance, setOldBalance] = useState<bigint>(0n)
  const [oldRewards, setOldRewards] = useState<bigint>(0n)
  const [loadingOld, setLoadingOld] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  // Estado para referido y VIP
  const [copied, setCopied] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tab, setTab] = useState<'stake'|'unstake'|'claim'>('stake')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [msgNew, setMsgNew] = useState('')

  // Balances H2O del contrato nuevo
  const decimals = 18 // H2O
  const balance = stakingInfo?.tokenBalance ?? 0n
  const staked = stakingInfo?.stakedAmount ?? 0n
  const pending = stakingInfo?.pendingRewards ?? 0n

  // --- MIGRACIÓN: Consulta saldo/pendiente del contrato viejo ---

  useEffect(() => {
    let active = true;
    async function loadOld() {
      try {
        const { balance, rewards } = await getOldStakingInfo(userAddress)
        if (active) { setOldBalance(balance); setOldRewards(rewards) }
      } catch {}
    }
    loadOld()
    return () => { active = false }
  }, [userAddress, msg, error])

  // --- Acciones migración ---

  async function handleOldUnstake() {
    setLoadingOld('unstake'); setMsg(''); setError('')
    try {
      await withdrawOld()
      setMsg('¡Retiro realizado! Revisa tu wallet.')
    } catch (e: any) {
      setError(e?.message ?? e)
    }
    setLoadingOld('')
  }
  async function handleOldClaim() {
    setLoadingOld('claim'); setMsg(''); setError('')
    try {
      await claimOld()
      setMsg('¡Rewards reclamados!')
    } catch (e: any) {
      setError(e?.message ?? e)
    }
    setLoadingOld('')
  }

  // --- Acciones staking H2O nuevo ---
  async function doStake() {
    if (!amount || parseFloat(amount) <= 0) return setMsgNew('Ingresa monto válido')
    setLoading(true); setMsgNew('')
    try {
      const amtWei = ethers.parseUnits(amount, decimals)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const nonce = Math.floor(Math.random() * 1e12).toString()
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: [{
            name: 'stake',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: "permit", type: "tuple", components: [
                { name: "permitted", type: "tuple", components: [ { name: "token", type: "address" }, { name: "amount", type: "uint256" } ] },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" }
              ] },
              { name: 'signature', type: 'bytes' }
            ],
            outputs: [],
          }],
          functionName: 'stake',
          args: [
            { permitted: { token: H2O_STAKING_ADDRESS, amount: amtWei.toString() }, nonce, deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0'
          ],
        }],
        permit2: [{
          permitted: { token: H2O_STAKING_ADDRESS, amount: amtWei.toString() },
          spender: H2O_STAKING_ADDRESS,
          nonce,
          deadline: deadline.toString(),
        }]
      })
      if (finalPayload.status === 'success') {
        setMsgNew('Stake realizado exitosamente')
        setAmount('')
        setTimeout(() => { setMsgNew(''); onRefresh() }, 2000)
      } else {
        setMsgNew(finalPayload.message || 'Transacción rechazada')
      }
    } catch(e: any) { setMsgNew(e.message || 'Error') }
    setLoading(false)
  }

  async function doUnstake() {
    setLoading(true); setMsgNew('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: [{ name: 'unstake', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }],
          functionName: 'unstake',
          args: [],
        }]
      })
      if (finalPayload.status === 'success') {
        setMsgNew('Retiro realizado exitosamente')
        setTimeout(() => { setMsgNew(''); onRefresh() }, 2000)
      } else {
        setMsgNew(finalPayload.message || 'Transacción rechazada')
      }
    } catch(e: any) { setMsgNew(e.message || 'Error') }
    setLoading(false)
  }

  async function doClaim() {
    setLoading(true); setMsgNew('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: [{ name: 'claimRewards', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] }],
          functionName: 'claimRewards',
          args: [],
        }]
      })
      if (finalPayload.status === 'success') {
        setMsgNew('Rewards reclamados exitosamente')
        setTimeout(() => { setMsgNew(''); onRefresh() }, 2000)
      } else {
        setMsgNew(finalPayload.message || 'Transacción rechazada')
      }
    } catch(e: any) { setMsgNew(e.message || 'Error') }
    setLoading(false)
  }

  // Referido UX
  function handleCopyRef() {
    navigator.clipboard.writeText(`${REF_BASE}&ref=${userAddress}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // Panel migración solo cuando el usuario tiene saldo/rewards en el anterior
  const mustMigrate = oldBalance > 0n || oldRewards > 0n

  return (
    <div className="max-w-md w-full mx-auto flex flex-col gap-6 pt-4 px-2">
      {/* == MIGRACIÓN DEL SISTEMA VIEJO == */}
      {mustMigrate && (
        <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded-lg">
          <h2 className="text-yellow-800 font-bold mb-2">Migración de staking</h2>
          <div className="text-yellow-900 mb-2">
            Antes de usar el nuevo stake, primero <b>retira y reclama tus recompensas</b> del sistema anterior.
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-yellow-100 px-3 py-2 rounded">
              <span>H2O pendiente:</span>
              <b>{formatToken(oldBalance, decimals, 4)} H2O</b>
              <Button onClick={handleOldUnstake} disabled={loadingOld === 'unstake' || oldBalance === 0n} className="ml-2" variant="secondary">
                {loadingOld === 'unstake' ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" /> : <Lock className="w-4 h-4 mr-1 inline" />}
                Retirar
              </Button>
            </div>
            <div className="flex items-center justify-between bg-yellow-100 px-3 py-2 rounded">
              <span>Rewards:</span>
              <b>{formatToken(oldRewards, decimals, 4)} H2O</b>
              <Button onClick={handleOldClaim} disabled={loadingOld === 'claim' || oldRewards === 0n} className="ml-2" variant="outline">
                {loadingOld === 'claim' ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" /> : <Gift className="w-4 h-4 mr-1 inline" />}
                Reclamar
              </Button>
            </div>
            {msg && <div className="text-green-700 bg-green-100 border border-green-300 rounded px-3 py-2 mt-1">{msg}</div>}
            {error && <div className="text-red-600 bg-red-100 border border-red-300 rounded px-3 py-2 mt-1">{error}</div>}
          </div>
          <div className="text-xs mt-2 text-yellow-600">
            Cuando termines, tendrás acceso al nuevo Staking, referidos y VIP.
          </div>
        </div>
      )}

      {/* == REFERIDO + VIP (si ya migró)== */}
      {!mustMigrate && (
        <div className="flex flex-col gap-6">
          {/* REFERIDO */}
          <div className="rounded-lg border border-blue-400 bg-blue-50 p-3">
            <b className="flex items-center gap-2 mb-2">
              <LinkIcon size={18} className="text-blue-400" /> Enlace de referido
            </b>
            <div className="flex items-center gap-2 bg-blue-100 px-2 py-1 rounded">
              <span className="font-mono text-sm truncate flex-1 select-all">{REF_BASE}&ref={userAddress}</span>
              <Button size="sm" variant="outline" onClick={handleCopyRef}>{copied ? '¡Copiado!' : 'Copiar'}</Button>
            </div>
            <div className="text-xs mt-1 text-blue-800">
              Invita a tus amigos y ambos ganan <b>5% extra</b> en sus reclamos de rewards.
            </div>
          </div>
          {/* VIP */}
          <div className="p-3 rounded-lg border border-purple-400 bg-purple-50 mt-1 flex items-center">
            <Star className="text-purple-400 mr-2" /> 
            <div>
              <div className="font-bold text-purple-800">Pase VIP</div>
              <div className="text-xs text-purple-800">Precio: <b>1 UTH2</b> al mes · Gana entre <b>3 y 5 dólares en H2O</b> y parte del <b>5% de todas las comisiones</b>.</div>
            </div>
          </div>
        </div>
      )}

      {/* == PANEL STAKING == */}
      {!mustMigrate && (
        <>
          <div className="flex flex-col items-center space-y-4 px-1">
            <div className="w-full text-center text-xl font-bold mb-2 mt-4">Staking H2O</div>
            <div className="w-full flex items-center gap-2">
              <div className="flex-1 text-xs text-muted-foreground">
                Balance: {formatToken(balance, decimals)} H2O
              </div>
              <Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
                <ChevronRight className="w-4 h-4 mr-2" />
                Gestionar Stake
              </Button>
            </div>
          </div>

          {/* Dialog modal */}
          {dialogOpen && (
            <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end justify-center">
              <div className="w-full max-w-md bg-background border-t border-border rounded-t-2xl p-4 pb-8 max-h-[85vh] overflow-y-auto">
                {/* Tabs */}
                <div className="flex border border-border rounded-lg mb-4 overflow-hidden">
                  {(['stake', 'unstake', 'claim'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                      className={"flex-1 py-2 text-xs font-medium capitalize transition-colors " +
                        (tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                      {t === 'stake' ? 'Stake' : t === 'unstake' ? 'Unstake' : 'Claim'}
                    </button>
                  ))}
                </div>

                {tab === 'stake' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Balance: {formatToken(balance, decimals)} H2O</span>
                      <button onClick={() => setAmount(ethers.formatUnits(balance, decimals))} className="text-primary">MAX</button>
                    </div>
                    <input
                      type="number" value={amount} onChange={e => setAmount(e.target.value)}
                      placeholder={`Cantidad de H2O`}
                      className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                    />
                    <div className="text-xs text-muted-foreground">Fee: 2%</div>
                    <Button className="w-full" onClick={doStake} disabled={loading || !amount}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                      Stake H2O
                    </Button>
                  </div>
                )}

                {tab === 'unstake' && (
                  <div className="space-y-3">
                    <div className="bg-surface-2 border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground mb-1">Tu stake</p>
                      <p className="text-lg font-bold text-foreground">{formatToken(staked, decimals)} H2O</p>
                    </div>
                    <div className="text-xs text-muted-foreground">Fee: 2%</div>
                    <Button className="w-full" variant="destructive" onClick={doUnstake} disabled={loading || staked === 0n}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
                      Unstake H2O
                    </Button>
                  </div>
                )}

                {tab === 'claim' && (
                  <div className="space-y-3">
                    <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                      <p className="text-xs text-green-400 mb-1">Rewards pendientes</p>
                      <p className="text-lg font-bold text-green-300">{formatToken(pending, decimals)} H2O</p>
                      <p className="text-xs text-muted-foreground mt-1">Se acumulan cada segundo - 24/7</p>
                    </div>
                    <div className="text-xs text-muted-foreground">Fee: 2%</div>
                    <Button className="w-full bg-green-600 hover:bg-green-700"
                      onClick={doClaim} disabled={loading || pending === 0n}>
                      {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
                      {pending === 0n ? 'Sin rewards' : `Reclamar ${formatToken(pending, decimals)} H2O`}
                    </Button>
                  </div>
                )}

                {msgNew && (
                  <p className={"text-xs mt-3 text-center " +
                    (msgNew.startsWith('Stake') || msgNew.startsWith('Retiro') || msgNew.startsWith('Rewards')
                      ? 'text-green-400' : 'text-red-400')}>
                    {msgNew}
                  </p>
                )}
                <div className="w-full flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setDialogOpen(false)} className="mt-6">Cerrar</Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}