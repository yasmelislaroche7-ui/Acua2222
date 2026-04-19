'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatToken } from '@/lib/contract' // Usa tu helper de formato
import { H2O_STAKING_ADDRESS, H2O_STAKING_ABI } from '@/lib/h2oStaking'
// Importa aquí tu contrato viejo, helpers y address:
import { STAKING_CONTRACT as OLD_CONTRACT, getOldStakingInfo, withdrawOld, claimOld } from '@/lib/oldStakingService'
import {
  buyVIP, claimRewards, registerReferrer, claimRefRewards, getMyRewards, unstake
} from '@/lib/stakingService'

const APP_LINK = "https://worldcoin.org/mini-app?app_id=app_60f2dc429532dcfa014c16d52ddc00fe&app_mode=mini-app"

export function StakePanel({ userAddress }: { userAddress: string }) {
  // Datos del contrato viejo
  const [oldBalance, setOldBalance] = useState<bigint>(0n)
  const [oldRewards, setOldRewards] = useState<bigint>(0n)
  const [loadingOld, setLoadingOld] = useState(false)
  // Datos del nuevo contrato
  const [h2oBalance, setH2oBalance] = useState('')
  const [newRewards, setNewRewards] = useState('')
  const [loading, setLoading] = useState('')
  const [txMsg, setTxMsg] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  // Para detectar referido en url:
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref && ref.toLowerCase() !== userAddress.toLowerCase()) {
      registerReferrer(ref)
    }
  }, [userAddress])

  // Cargar balances contrato viejo y nuevo
  useEffect(() => {
    let ignore = false
    async function loadData() {
      // Contrato viejo
      const infoOld = await getOldStakingInfo(userAddress)
      if (!ignore) {
        setOldBalance(infoOld.balance)
        setOldRewards(infoOld.rewards)
      }
      // Contrato nuevo
      const contract = new ethers.Contract(H2O_STAKING_ADDRESS, H2O_STAKING_ABI, ethers.getDefaultProvider())
      const bal = await contract.balanceOf(userAddress)
      setH2oBalance(formatToken(bal))
      getMyRewards(userAddress).then(val => setNewRewards(formatToken(val)))
    }
    loadData()
    return () => { ignore = true }
  }, [userAddress])

  // Funciones para contrato viejo
  async function handleOldWithdraw() {
    setLoadingOld(true)
    setError('')
    try {
      await withdrawOld()
      setTxMsg('¡Retiro completado!')
    } catch (e: any) {
      setError(e.message ?? e)
    }
    setLoadingOld(false)
  }
  async function handleOldClaim() {
    setLoadingOld(true)
    setError('')
    try {
      await claimOld()
      setTxMsg('¡Rewards reclamados!')
    } catch (e: any) {
      setError(e.message ?? e)
    }
    setLoadingOld(false)
  }

  // Funciones para nuevo staking/vip
  async function handleStakeH2O(amount: string) {
    setLoading('stake')
    setError('')
    try {
      // Aquí deberías armar el permit2 con MiniKit/ethers y firmar
      // Ejemplo: await staking.stake(permit, signature)
      setTxMsg('Stake realizado') // Cambia por la TX real
    } catch (e: any) {
      setError(e.message ?? e)
    }
    setLoading('')
  }
  async function handleUnstake(amount: string) {
    setLoading('unstake')
    setError('')
    try {
      await unstake(amount)
      setTxMsg('Unstake realizado')
    } catch (e: any) {
      setError(e.message ?? e)
    }
    setLoading('')
  }
  async function handleClaimNew() {
    setLoading('claim')
    setError('')
    try {
      await claimRewards()
      setTxMsg('Rewards nuevos reclamados')
    } catch (e: any) {
      setError(e.message ?? e)
    }
    setLoading('')
  }
  async function handleBuyVip() {
    setLoading('vip')
    setError('')
    try {
      await buyVIP(1)
      setTxMsg('VIP comprado')
    } catch (e: any) {
      setError(e.message ?? e)
    }
    setLoading('')
  }
  async function handleClaimRef() {
    setLoading('ref')
    setError('')
    try {
      await claimRefRewards()
      setTxMsg('Rewards de referido reclamados')
    } catch (e: any) {
      setError(e.message ?? e)
    }
    setLoading('')
  }

  // Copiar link de referido
  function copyLink() {
    navigator.clipboard.writeText(APP_LINK + `&ref=${userAddress}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // Mostrar UI: contrato viejo primero si hay saldo, luego el nuevo si no
  const hasOld = oldBalance > 0n || oldRewards > 0n

  return (
    <div className="flex flex-col gap-6">

      {/* --- MIGRACIÓN --- */}
      {hasOld && (
        <div className="p-4 border-l-4 border-yellow-400 bg-yellow-100 rounded-lg space-y-2">
          <b>🚨 Migración: Retira tus H2O y/o reclama tus recompensas del sistema anterior antes de continuar.</b>
          <div>
            {oldBalance > 0n && (
              <div className="flex items-center justify-between">
                <div>H2O Pendiente: <span className="font-mono">{formatToken(oldBalance)}</span></div>
                <Button onClick={handleOldWithdraw} disabled={loadingOld}>
                  {loadingOld ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Retirar
                </Button>
              </div>
            )}
            {oldRewards > 0n && (
              <div className="flex items-center justify-between mt-2">
                <div>Rewards Pendientes: <span className="font-mono">{formatToken(oldRewards)}</span></div>
                <Button onClick={handleOldClaim} disabled={loadingOld}>
                  {loadingOld && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Reclamar rewards
                </Button>
              </div>
            )}
          </div>
          {txMsg && <div className="text-green-600 text-xs mt-1">{txMsg}</div>}
          {error && <div className="text-red-600 text-xs mt-1">{error}</div>}
          <div className="text-xs text-gray-700 mt-1">
            Una vez retires y reclames, tu acceso al nuevo sistema estará habilitado.
          </div>
        </div>
      )}

      {/* --- NUEVO STAKE Y BENEFICIOS --- */}
      {!hasOld && (
        <>
          {/* REFERIDOS */}
          <div className="rounded-lg border border-blue-400 bg-blue-50 p-3 mb-1">
            <b>🎉 Invita a tu amigo y ambos ganan el 5% de sus reclamos</b>
            <div className="flex items-center gap-2 text-xs mt-2">
              <span className="font-mono bg-blue-100 px-2 py-1 rounded">{APP_LINK + `&ref=${userAddress}`}</span>
              <Button variant="outline" size="sm" onClick={copyLink}>{copied ? 'Copiado' : 'Copiar link'}</Button>
            </div>
          </div>
          {/* VIP */}
          <div className="rounded-lg border border-purple-400 bg-purple-50 p-3 mb-4">
            <b className="block">🔥 Pase VIP: 1 UTH2/mes</b>
            <span className="block text-xs mb-2">Ganancias estimadas entre 3 y 5 dólares en H2O.<br />Hazte socio de la app y recibe parte del 5% de todas las comisiones del stake.</span>
            <Button className="mt-1" onClick={handleBuyVip} disabled={loading === 'vip'}>
              {loading === 'vip' && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Activar pase VIP
            </Button>
          </div>
          {/* NUEVO STAKING */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col gap-4">
            <div>
              <b className="text-base text-primary">Staking H2O</b>
              <div>En tu cartera: <span className="font-mono">{h2oBalance} H2O</span></div>
              <div>Rewards pendientes: <span className="font-mono">{newRewards} H2O</span></div>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Cantidad H2O"
                className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2"
                min={0}
                onChange={e => setH2oBalance(e.target.value)}
              />
              <Button onClick={() => handleStakeH2O(h2oBalance)} disabled={loading === 'stake'}>
                {loading === 'stake' && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Stakear H2O
              </Button>
              <Button onClick={handleClaimNew} disabled={loading === 'claim'}>
                {loading === 'claim' && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Reclamar Rewards
              </Button>
              <Button onClick={() => handleUnstake(h2oBalance)} disabled={loading === 'unstake'}>
                {loading === 'unstake' && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Retirar
              </Button>
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={handleClaimRef} disabled={loading === 'ref'}>
                {loading === 'ref' && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                Reclamar rewards de referido
              </Button>
            </div>
            {txMsg && <div className="text-green-600 text-xs mt-1">{txMsg}</div>}
            {error && <div className="text-red-600 text-xs mt-1">{error}</div>}
          </div>
        </>
      )}
    </div>
  )
}