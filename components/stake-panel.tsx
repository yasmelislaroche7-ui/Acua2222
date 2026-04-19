'use client'

import { useState } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Button } from '@/components/ui/button'
import { Loader2, Lock, Unlock, Gift, ChevronRight } from 'lucide-react'
import { H2O_STAKING_ADDRESS, H2O_STAKING_ABI } from '@/lib/h2oStaking'
import { formatToken } from '@/lib/contract'

export function StakePanel({ userAddress, stakingInfo, onRefresh }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tab, setTab] = useState<'stake'|'unstake'|'claim'>('stake')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const decimals = 18 // H2O

  const balance = stakingInfo?.tokenBalance ?? 0n
  const staked = stakingInfo?.stakedAmount ?? 0n
  const pending = stakingInfo?.pendingRewards ?? 0n

  // Handlers
  async function doStake() {
    if (!amount || parseFloat(amount) <= 0) return setMsg('Ingresa monto válido')
    setLoading(true); setMsg('')
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
        setMsg('Stake realizado exitosamente')
        setAmount('')
        setTimeout(() => { setMsg(''); onRefresh() }, 2000)
      } else {
        setMsg(finalPayload.message || 'Transacción rechazada')
      }
    } catch(e: any) { setMsg(e.message || 'Error') }
    setLoading(false)
  }

  async function doUnstake() {
    setLoading(true); setMsg('')
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
        setMsg('Retiro realizado exitosamente')
        setTimeout(() => { setMsg(''); onRefresh() }, 2000)
      } else {
        setMsg(finalPayload.message || 'Transacción rechazada')
      }
    } catch(e: any) { setMsg(e.message || 'Error') }
    setLoading(false)
  }

  async function doClaim() {
    setLoading(true); setMsg('')
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
        setMsg('Rewards reclamados exitosamente')
        setTimeout(() => { setMsg(''); onRefresh() }, 2000)
      } else {
        setMsg(finalPayload.message || 'Transacción rechazada')
      }
    } catch(e: any) { setMsg(e.message || 'Error') }
    setLoading(false)
  }

  return (
    <>
      <div className="flex flex-col items-center space-y-4 px-1">
        <div className="w-full text-center text-xl font-bold mb-2">Staking H2O</div>
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

            {msg && (
              <p className={"text-xs mt-3 text-center " +
                (msg.startsWith('Stake') || msg.startsWith('Retiro') || msg.startsWith('Rewards')
                  ? 'text-green-400' : 'text-red-400')}>
                {msg}
              </p>
            )}
            <div className="w-full flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(false)} className="mt-6">Cerrar</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}