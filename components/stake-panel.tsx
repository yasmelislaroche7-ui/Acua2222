'use client'
import { useState } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import { Button } from '@/components/ui/button'
import {
  Loader2, ChevronRight, Lock, Unlock, Gift, Link as LinkIcon
} from 'lucide-react'

function formatToken(value: bigint = 0n, decimals = 18, maxDec = 4) {
  let float = Number(ethers.formatUnits(value, decimals))
  return float.toLocaleString(undefined, { maximumFractionDigits: maxDec })
}
function formatAPY(bps: bigint = 0n) {
  return `${(Number(bps) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

interface StakingInfo {
  tokenBalance: bigint
  stakedAmount: bigint
  pendingRewards: bigint
  apyBps?: bigint
  stakeFeeBps?: bigint
  unstakeFeeBps?: bigint
  claimFeeBps?: bigint
}

interface StakePanelProps {
  userAddress: string
  info: StakingInfo
  oldInfo?: { stakedAmount: bigint, pendingRewards: bigint }
  onRefresh: () => void
}

const H2O_STAKING_ADDRESS = "0x7730583E492D520CcBb3C06325A77EccAbAFa98e"
const H2O_STAKING_ABI = [
  {
    name: "stake", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "permit", type: "tuple", components: [
        { name: "permitted", type: "tuple", components: [
          { name: "token", type: "address" }, { name: "amount", type: "uint256" }
        ]},
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }
      ]},
      { name: "signature", type: "bytes" }
    ], outputs: []
  },
  { name: "unstake", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { name: "claimRewards", type: "function", inputs: [], outputs: [], stateMutability: "nonpayable" },
]

const ACUA_BLUE = "#3B7ACB"
const ACUA_SKY = "#e6f1fb"
const ACUA_BORDER = "#93c5fd"
const ACUA_GRAD = "linear-gradient(90deg,#a2bfff,#eaf6ff 90%)"
const ACUA_LINK = "#1976d2"
const ACUA_GREEN = "#3BCB8B"

// --- PANEL ---
export function StakePanel({ userAddress, info, oldInfo, onRefresh }: StakePanelProps) {
  // Migración
  const [loadingOld, setLoadingOld] = useState('')
  const [msgOld, setMsgOld] = useState('')
  const [errOld, setErrOld] = useState('')

  // Nuevo staking
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tab, setTab] = useState<'stake'|'unstake'|'claim'>('stake')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  // --- Migración TXs
  async function handleOldUnstake() {
    setLoadingOld('unstake'); setMsgOld(''); setErrOld('')
    try {
      await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: H2O_STAKING_ABI,
          functionName: 'unstake',
          args: [],
        }]
      })
      setMsgOld("¡Retiro realizado!"); onRefresh()
    } catch (e: any) { setErrOld(e?.message ?? e) }
    setLoadingOld('')
  }
  async function handleOldClaim() {
    setLoadingOld('claim'); setMsgOld(''); setErrOld('')
    try {
      await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: H2O_STAKING_ABI,
          functionName: 'claimRewards',
          args: [],
        }]
      })
      setMsgOld("¡Rewards reclamados!"); onRefresh()
    } catch (e: any) { setErrOld(e?.message ?? e) }
    setLoadingOld('')
  }

  // --- Nuevo staking TXs
  async function doStake() {
    if (!amount || parseFloat(amount) <= 0) return setMsg("Ingresa monto válido")
    setLoading('stake'); setMsg(''); setErr('')
    try {
      const amtWei = ethers.parseUnits(amount, 18)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const nonce = Math.floor(Math.random() * 1e12).toString()
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: [H2O_STAKING_ABI[0]],
          functionName: 'stake',
          args: [
            { permitted: { token: H2O_STAKING_ADDRESS, amount: amtWei.toString() }, nonce, deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0'
          ],
        }],
        permit2: [{
          permitted: { token: H2O_STAKING_ADDRESS, amount: amtWei.toString() },
          spender: H2O_STAKING_ADDRESS, nonce, deadline: deadline.toString(),
        }]
      })
      if (finalPayload.status === 'success') {
        setMsg("Stake realizado exitosamente")
        setAmount('')
        setTimeout(() => { setMsg(''); onRefresh() }, 1600)
      } else {
        setErr(finalPayload.message || "Transacción rechazada")
      }
    } catch (e: any) { setErr(e.message || "Error") }
    setLoading('')
  }
  async function doUnstake() {
    setLoading('unstake'); setMsg(''); setErr('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: [H2O_STAKING_ABI[1]],
          functionName: 'unstake',
          args: [],
        }]
      })
      if (finalPayload.status === 'success') {
        setMsg("Retiro exitoso")
        setTimeout(() => { setMsg(''); onRefresh() }, 1600)
      } else setErr(finalPayload.message || "Transacción rechazada")
    } catch(e: any) { setErr(e.message || "Error") }
    setLoading('')
  }
  async function doClaim() {
    setLoading('claim'); setMsg(''); setErr('')
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: H2O_STAKING_ADDRESS,
          abi: [H2O_STAKING_ABI[2]],
          functionName: 'claimRewards',
          args: [],
        }]
      })
      if (finalPayload.status === 'success') {
        setMsg("Rewards reclamados exitosamente")
        setTimeout(() => { setMsg(''); onRefresh() }, 1600)
      } else setErr(finalPayload.message || "Transacción rechazada")
    } catch(e: any) { setErr(e.message || "Error") }
    setLoading('')
  }

  function handleCopyRef() {
    navigator.clipboard.writeText(`https://worldcoin.org/mini-app?app_id=app_60f2dc429532dcfa014c16d52ddc00fe&app_mode=mini-app&ref=${userAddress}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // ¿Migración pendiente?
  const mustMigrate = !!oldInfo && (oldInfo.stakedAmount > 0n || oldInfo.pendingRewards > 0n)

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-8 pt-4 px-2">

      {/* ==== MIGRACIÓN ==== */}
      {mustMigrate && (
        <div
          className="border-l-4 rounded-lg p-4 shadow"
          style={{ borderColor: ACUA_LINK, background: "#e3f2ff" }}
        >
          <h2 className="font-bold text-base text-blue-900 mb-1">Migración de staking</h2>
          <div className="text-blue-800 mb-3">
            Antes de usar el nuevo stake, primero <b>retira y reclama tus recompensas</b> del sistema anterior.
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between bg-blue-100 px-3 py-2 rounded">
              <span>H2O pendiente:</span>
              <span style={{ color: ACUA_GREEN, fontWeight: 'bold' }}>{formatToken(oldInfo.stakedAmount, 18, 4)} H2O</span>
              <Button onClick={handleOldUnstake}
                      disabled={loadingOld === 'unstake' || oldInfo.stakedAmount === 0n}
                      className="ml-2">{loadingOld === 'unstake' ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" /> : <Lock className="w-4 h-4 mr-1 inline" />}Retirar</Button>
            </div>
            <div className="flex items-center justify-between bg-blue-100 px-3 py-2 rounded">
              <span>Rewards:</span>
              <span style={{ color: ACUA_GREEN, fontWeight: 'bold' }}>{formatToken(oldInfo.pendingRewards, 18, 4)} H2O</span>
              <Button onClick={handleOldClaim}
                      disabled={loadingOld === 'claim' || oldInfo.pendingRewards === 0n}
                      className="ml-2">{loadingOld === 'claim' ? <Loader2 className="w-4 h-4 animate-spin mr-1 inline" /> : <Gift className="w-4 h-4 mr-1 inline" />}Reclamar</Button>
            </div>
            {msgOld && <div className="text-green-700 bg-green-100 border border-green-300 rounded px-3 py-2 mt-1">{msgOld}</div>}
            {errOld && <div className="text-red-600 bg-red-100 border border-red-300 rounded px-3 py-2 mt-1">{errOld}</div>}
          </div>
          <div className="text-xs mt-2 text-blue-600">Cuando termines, tendrás acceso al nuevo staking, referidos y pase VIP.</div>
        </div>
      )}

      {/* ==== PANEL NUEVO ==== */}
      {!mustMigrate && (
        <div className="flex flex-col gap-4">
          {/* REFERIDO */}
          <div className="rounded-lg border border-blue-400 bg-blue-50 p-3 flex flex-col gap-1">
            <span className="flex items-center gap-2 mb-1 font-bold text-blue-900">
              <LinkIcon size={18} className="text-blue-400" /> Enlace de referido
            </span>
            <div className="flex items-center gap-2 bg-blue-100 px-2 py-1 rounded text-base">
              <span className="font-mono truncate flex-1 select-all" style={{ color: ACUA_LINK, fontWeight: 700 }}>
                https://worldcoin.org/mini-app?app_id=app_60f2dc429532dcfa014c16d52ddc00fe&app_mode=mini-app&ref={userAddress}
              </span>
              <Button size="sm" variant="outline" onClick={handleCopyRef}>{copied ? '¡Copiado!' : 'Copiar'}</Button>
            </div>
            <span className="text-xs mt-1 text-blue-800">Invita a tus amigos y ambos ganan <b>5%</b> extra en sus reclamos.</span>
          </div>
          {/* VIP */}
          <div className="p-3 rounded-lg border border-blue-300 bg-gradient-to-b from-blue-50 via-white to-acua-skydark flex items-center">
            <div>
              <div className="font-bold text-[#174178] flex items-center gap-2"><Star size={18} className="text-blue-400" /> Pase VIP</div>
              <div className="text-xs text-blue-800">
                Precio: <b>1 UTH2</b> al mes · Gana entre <b>3 y 5 dólares en H2O</b> y parte del <b>5%</b> de todas las comisiones.
              </div>
            </div>
          </div>
          {/* PANEL */}
          <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4 flex flex-col gap-4 shadow"
            style={{ background: ACUA_GRAD }}>
            <div className="flex flex-col justify-center items-center gap-2 mb-3">
              <div className="font-bold text-xl mb-1" style={{ color: ACUA_BLUE }}>Staking H2O</div>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-8 text-base justify-center items-center">
                <span className="text-xs text-blue-800">En cartera:
                  <span style={{ color: ACUA_GREEN, fontWeight: 700, marginLeft: 8 }}>
                    {formatToken(info.tokenBalance, 18, 4)} H2O
                  </span>
                </span>
                <span className="text-xs text-blue-800">Staked:
                  <span style={{ color: ACUA_GREEN, fontWeight: 700, marginLeft: 8 }}>
                    {formatToken(info.stakedAmount, 18, 4)} H2O
                  </span>
                </span>
                <span className="text-xs text-blue-800">Rewards:
                  <span style={{ color: ACUA_GREEN, fontWeight: 700, marginLeft: 8 }}>
                    {formatToken(info.pendingRewards, 18, 4)} H2O
                  </span>
                </span>
              </div>
              {/* Stats */}
              <div className="flex gap-6 text-xs mt-2 mb-3">
                <span className="font-bold" style={{ color: 'green' }}>
                  APY: {formatAPY(info.apyBps)}
                </span>
                <span style={{ color: '#23615e' }}>Fee: {(Number(info.stakeFeeBps ?? 200n) / 100) || 2}%</span>
              </div>
            </div>
            <div className="flex flex-row flex-wrap gap-3 items-end">
              <input
                type="number"
                placeholder="Cantidad H2O"
                value={amount}
                min={0}
                step="any"
                onChange={e => setAmount(e.target.value)}
                className="flex-1 p-2 rounded border border-blue-300 bg-white font-mono text-base outline-blue-400"
              />
              <Button onClick={() => setAmount(formatToken(info.tokenBalance, 18, 4))} size="sm" variant="secondary" className="rounded">MAX</Button>
              <Button className="font-bold px-6 py-2 rounded-lg" style={{
                background: ACUA_BLUE,
                color: 'white'
              }}
                onClick={doStake} disabled={loading === 'stake' || !amount}>
                {loading === 'stake' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Lock className="w-4 h-4 mr-2" />}
                Stakear H2O
              </Button>
              <Button onClick={doUnstake}
                className="font-bold bg-white border border-blue-400 text-blue-700 px-4 py-2 rounded-lg hover:bg-blue-50"
                style={{}}
                disabled={loading === 'unstake' || info.stakedAmount === 0n}>
                {loading === 'unstake' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Unlock className="w-4 h-4 mr-2" />}
                Retirar
              </Button>
              <Button onClick={doClaim}
                className="font-bold bg-green-600 hover:bg-green-700 text-white border border-green-700 px-4 py-2 rounded-lg"
                disabled={loading === 'claim' || info.pendingRewards === 0n}>
                {loading === 'claim' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
                Reclamar
              </Button>
            </div>
            {msg && (
              <div className="text-green-700 bg-green-100 border border-green-300 rounded px-3 py-2 mt-1">{msg}</div>
            )}
            {err && (
              <div className="text-red-600 bg-red-100 border border-red-300 rounded px-3 py-2 mt-1">{err}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}