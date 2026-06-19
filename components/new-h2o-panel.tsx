'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Droplets, Zap, Users, Gift, Copy, Check, ExternalLink,
  TrendingUp, ArrowDownToLine, ArrowUpFromLine, RefreshCw,
  Shield, Info, Loader2, CheckCircle2, XCircle,
  Fuel, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { WORLD_CHAIN_RPC, randomNonce } from '@/lib/new-contracts'

// ─── Contract Config ──────────────────────────────────────────────────────────
const CONTRACT = '0x357EE95386a7a07418731F8688BAF62582E4cf51'
const TOKEN    = '0x08131A6f780AEF79E86518c4A10c06387Ec74636'
const DECIMALS = 18
const APP_BASE_URL = 'https://worldcoin.org/mini-app?app_id=app_60f2dc429532dcfa014c16d52ddc00fe&app_mode=mini-app'

// ─── ABIs (NewH2OStaking v2) ──────────────────────────────────────────────────
const ABI_READ = [
  'function getStakeInfo(address user) view returns (uint256 staked, uint256 pendingReward, uint256 poolBalance, uint256 currentRewardRate)',
  'function earned(address account) view returns (uint256)',
  'function stakedBalance(address) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function rewardPool() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function depositFeeBps() view returns (uint256)',
  'function withdrawFeeBps() view returns (uint256)',
  'function claimFeeBps() view returns (uint256)',
  'function feeToPoolBps() view returns (uint256)',
  'function paused() view returns (bool)',
  'function getOwners() view returns (address[])',
  'function contractBalance() view returns (uint256)',
  // Referral v2
  'function getReferralInfo(address user) view returns (address myReferrer, uint256 myReferralCount, uint256 myReferralEarnings)',
  'function referredBy(address) view returns (address)',
  'function referralCount(address) view returns (uint256)',
  'function referralEarnings(address) view returns (uint256)',
  'function totalReferralsPaid() view returns (uint256)',
  'function REF_REFERRER_BPS() view returns (uint256)',
  'function REF_BONUS_BPS() view returns (uint256)',
  'function REF_OWNER_BPS() view returns (uint256)',
]
// register(address referrer)
const ABI_REGISTER: any[] = [{
  name: 'register', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'referrer', type: 'address' }], outputs: [],
}]
const ABI_ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) nonpayable returns (bool)',
]
const PERMIT2_TUPLE = {
  name: 'permit', type: 'tuple', components: [
    { name: 'permitted', type: 'tuple', components: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
    ]},
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}
// stake(PermitTransferFrom permit, bytes signature)
const ABI_STAKE: any[] = [{
  name: 'stake', type: 'function', stateMutability: 'nonpayable',
  inputs: [PERMIT2_TUPLE, { name: 'signature', type: 'bytes' }],
  outputs: [],
}]
// stakeNormal(uint256 amount) y stakeNormal(uint256 amount, address referrer)
const ABI_STAKE_NORMAL: any[] = [{
  name: 'stakeNormal', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256' }], outputs: [],
}]
const ABI_STAKE_NORMAL_REF: any[] = [{
  name: 'stakeNormal', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256' }, { name: 'referrer', type: 'address' }], outputs: [],
}]
// unstake(uint256 amount)
const ABI_UNSTAKE: any[] = [{
  name: 'unstake', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256' }], outputs: [],
}]
// claimRewards()
const ABI_CLAIM: any[] = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}]
// fundRewardPoolPermit2(PermitTransferFrom permit, bytes signature)
const ABI_FUND_PERMIT2: any[] = [{
  name: 'fundRewardPoolPermit2', type: 'function', stateMutability: 'nonpayable',
  inputs: [PERMIT2_TUPLE, { name: 'signature', type: 'bytes' }],
  outputs: [],
}]
// fundRewardPool(uint256 amount)
const ABI_FUND_DIRECT: any[] = [{
  name: 'fundRewardPool', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256' }], outputs: [],
}]

// ─── Types ────────────────────────────────────────────────────────────────────
interface GlobalStats {
  totalStaked: bigint
  rewardPool: bigint
  rewardRate: bigint
  depositFeeBps: bigint
  withdrawFeeBps: bigint
  claimFeeBps: bigint
  feeToPoolBps: bigint
  contractBalance: bigint
  paused: boolean
}
interface UserInfo {
  staked: bigint
  pendingReward: bigint
  poolBalance: bigint
  currentRewardRate: bigint
}
interface RefInfo {
  myReferrer: string
  myReferralCount: bigint
  myReferralEarnings: bigint
}
interface MsgState { ok: boolean; text: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(val: bigint, dec = 18, dp = 3): string {
  return Number(ethers.formatUnits(val, dec)).toLocaleString('es', {
    minimumFractionDigits: 0, maximumFractionDigits: dp,
  })
}
function calcApr(rewardRate: bigint, totalStaked: bigint): string {
  if (totalStaked === 0n || rewardRate === 0n) return '—'
  const YEAR = 365n * 24n * 3600n
  const annualReward = rewardRate * YEAR
  const apr = Number(annualReward * 10000n / totalStaked) / 100
  return apr.toFixed(2) + '%'
}
function shortAddr(addr: string): string {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}
const MK_ERR: Record<string, string> = {
  user_rejected:                    'Cancelado por el usuario.',
  simulation_failed:                'La simulación falló. Verifica tu saldo y que el contrato esté autorizado en World App.',
  transaction_failed:               'La transacción falló en cadena.',
  invalid_contract:                 'Contrato no reconocido por World App. Agrégalo en developer.worldcoin.org.',
  disallowed_operation:             'Contrato no autorizado en World App. Agrégalo en developer.worldcoin.org.',
  malicious_operation:              'Operación bloqueada por seguridad de World App.',
  input_error:                      'Datos de transacción inválidos. Intenta de nuevo.',
  validation_error:                 'Error de validación. Verifica el monto e intenta de nuevo.',
  insufficient_allowance:           'Allowance insuficiente. Aprueba el token e intenta de nuevo.',
  daily_tx_limit_reached:           'Límite diario de transacciones alcanzado.',
  unauthorized:                     'No autorizado.',
  timeout:                          'Tiempo de espera agotado. Intenta de nuevo.',
  network_error:                    'Error de red. Verifica tu conexión.',
  generic_error:                    'Error inesperado. Intenta de nuevo.',
}
function parseMkErr(payload: any): string {
  if (!payload) return 'Sin respuesta de World App. Intenta de nuevo.'
  // MiniKit devuelve error_code (snake_case) o errorCode (camelCase)
  const code: string = payload.error_code ?? payload.errorCode ?? ''
  if (code && MK_ERR[code]) return MK_ERR[code]
  // Detalles adicionales
  const details = payload.details
  if (details) {
    if (typeof details === 'string' && details.length > 0) return details
    if (typeof details === 'object') {
      try { const s = JSON.stringify(details); if (s !== '{}') return s } catch { /* skip */ }
    }
  }
  if (typeof payload.message === 'string' && payload.message.length > 0) return payload.message
  if (typeof payload.reason  === 'string' && payload.reason.length  > 0) return payload.reason
  if (code) return `Error de World App: ${code}`
  if (payload.status === 'error') return 'Transacción rechazada. Intenta de nuevo.'
  return 'Error desconocido. Intenta de nuevo.'
}
function provider() { return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC) }

// ─── Sub-components ──────────────────────────────────────────────────────────
function Stat({ label, value, sub, c = 'text-cyan-400' }: { label: string; value: string; sub?: string; c?: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <span className={cn('text-base font-black truncate', c)}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
    </div>
  )
}
function Msg({ msg, onClear }: { msg: MsgState; onClear: () => void }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-2xl p-3 border',
      msg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300')}>
      {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span className="flex-1 text-xs leading-relaxed break-words">{msg.text}</span>
      <button onClick={onClear} className="shrink-0 text-xs opacity-60 hover:opacity-100">✕</button>
    </div>
  )
}
function CopyRow({ label, value }: { label: string; value: string }) {
  const [cp, setCp] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 p-2.5">
      <span className="flex-1 text-xs font-mono text-muted-foreground truncate">{label}</span>
      <button onClick={() => { navigator.clipboard.writeText(value); setCp(true); setTimeout(() => setCp(false), 2000) }}
        className="shrink-0 flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300">
        {cp ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {cp ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}
function Btn({ onClick, loading, disabled, label, icon, color = 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' }: {
  onClick: () => void; loading?: boolean; disabled?: boolean; label: string; icon: React.ReactNode; color?: string
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={cn('flex items-center gap-2 w-full rounded-2xl px-4 py-3 text-sm font-bold border transition-opacity', color,
        (disabled || loading) ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-80 active:scale-[.98]')}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : icon}
      <span>{loading ? 'Procesando…' : label}</span>
    </button>
  )
}
function RegisterRefForm({ urlRef, loading, onRegister }: { urlRef: string; loading: boolean; onRegister: (r: string) => void }) {
  const [val, setVal] = React.useState(urlRef)
  React.useEffect(() => { if (urlRef) setVal(urlRef) }, [urlRef])
  return (
    <div className="flex gap-2">
      <input value={val} onChange={e => setVal(e.target.value)}
        placeholder="0x… dirección del referrer"
        className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-amber-500/50" />
      <button onClick={() => onRegister(val)} disabled={!val || loading}
        className={cn('shrink-0 px-3 rounded-xl bg-amber-500/20 border border-amber-500/30 text-xs font-bold text-amber-300',
          (!val || loading) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-500/30')}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Registrar'}
      </button>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props { userAddress: string; walletMode?: 'minikit' | 'imported' | null; importedSigner?: ethers.Signer | null }

export function NewH2OPanel({ userAddress, walletMode, importedSigner }: Props) {
  const [tab, setTab] = useState<'stake' | 'stats' | 'ref' | 'fondear'>('stake')
  const [global, setGlobal]   = useState<GlobalStats | null>(null)
  const [user, setUser]       = useState<UserInfo | null>(null)
  const [refInfo, setRefInfo] = useState<RefInfo | null>(null)
  const [h2oBalance, setH2oBal] = useState(0n)
  const [loading, setLoading] = useState(false)
  const [isOwner, setIsOwner] = useState(false)

  const [stakeAmt, setStakeAmt]     = useState('')
  const [unstakeAmt, setUnstakeAmt] = useState('')
  const [fundAmt, setFundAmt]       = useState('')

  const [stakeMsg, setStakeMsg]     = useState<MsgState | null>(null)
  const [unstakeMsg, setUMsg]       = useState<MsgState | null>(null)
  const [claimMsg, setClaimMsg]     = useState<MsgState | null>(null)
  const [claimRefMsg, setClaimRefMsg] = useState<MsgState | null>(null)
  const [fundMsg, setFundMsg]       = useState<MsgState | null>(null)
  const [regMsg, setRegMsg]         = useState<MsgState | null>(null)

  const [lStake, setLS]    = useState(false)
  const [lUnstake, setLU]  = useState(false)
  const [lClaim, setLC]    = useState(false)
  const [lClaimRef, setLCR] = useState(false)
  const [lFund, setLF]     = useState(false)
  const [lReg, setLReg]    = useState(false)

  // Referrer desde URL (?ref=0x...)
  const [urlRef, setUrlRef] = useState<string>('')

  const addr = userAddress || ''
  const isMK = walletMode === 'minikit' || MiniKit.isInstalled()

  // Leer ref param de URL al montar
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const r = params.get('ref') || ''
      if (r && ethers.isAddress(r)) setUrlRef(r)
    }
  }, [])

  // ── Load data ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!addr) return
    setLoading(true)
    try {
      const prov = provider()
      const c = new ethers.Contract(CONTRACT, ABI_READ, prov)
      const t = new ethers.Contract(TOKEN, ABI_ERC20, prov)

      const [stakeInfo, bal, totalStaked, rewardPool, rewardRate,
             depFee, witFee, clmFee, feePool, owners, cBal, refData, isPaused] = await Promise.all([
        c.getStakeInfo(addr),
        t.balanceOf(addr),
        c.totalStaked(),
        c.rewardPool(),
        c.rewardRate(),
        c.depositFeeBps(),
        c.withdrawFeeBps(),
        c.claimFeeBps(),
        c.feeToPoolBps(),
        c.getOwners(),
        c.contractBalance(),
        c.getReferralInfo(addr),
        c.paused(),
      ])

      setUser({
        staked: stakeInfo[0],
        pendingReward: stakeInfo[1],
        poolBalance: stakeInfo[2],
        currentRewardRate: stakeInfo[3],
      })
      setGlobal({
        totalStaked, rewardPool, rewardRate,
        depositFeeBps: depFee, withdrawFeeBps: witFee, claimFeeBps: clmFee,
        feeToPoolBps: feePool, contractBalance: cBal, paused: isPaused,
      })
      setRefInfo({
        myReferrer: refData[0],
        myReferralCount: refData[1],
        myReferralEarnings: refData[2],
      })
      setH2oBal(bal)
      const addrLow = addr.toLowerCase()
      setIsOwner((owners as string[]).map((o: string) => o.toLowerCase()).includes(addrLow))
    } catch (e) { console.error('NewH2OStaking load:', e) }
    finally { setLoading(false) }
  }, [addr])

  useEffect(() => { loadData() }, [loadData])
  const refresh = () => setTimeout(loadData, 4000)

  // ── STAKE ────────────────────────────────────────────────────────────────
  const doStake = async () => {
    const s = stakeAmt.replace(',', '.')
    let gross: bigint
    try { gross = ethers.parseUnits(s, DECIMALS) } catch { return }
    if (!gross) return
    if (h2oBalance < gross) { setStakeMsg({ ok: false, text: 'Balance insuficiente' }); return }
    setLS(true); setStakeMsg(null)

    // Determinar si hay referrer a pasar en este TX
    const noRef = !refInfo?.myReferrer || refInfo.myReferrer === ethers.ZeroAddress
    const refToPass = (noRef && urlRef && urlRef.toLowerCase() !== addr.toLowerCase()) ? urlRef : ''

    try {
      if (isMK) {
        const nonce = randomNonce()
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_STAKE, functionName: 'stake', args: [
            { permitted: { token: TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ]}],
          permit2: [{ permitted: { token: TOKEN, amount: gross.toString() }, spender: CONTRACT, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') {
          setStakeMsg({ ok: true, text: `✓ ${s} H2O 2.0 stakeados` }); setStakeAmt(''); refresh()
        } else setStakeMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const tc = new ethers.Contract(TOKEN, ABI_ERC20, importedSigner)
        const allow = await tc.allowance(addr, CONTRACT)
        if (allow < gross) await (await tc.approve(CONTRACT, gross * 100n)).wait()
        if (refToPass) {
          const sc = new ethers.Contract(CONTRACT, ABI_STAKE_NORMAL_REF, importedSigner)
          await (await sc['stakeNormal(uint256,address)'](gross, refToPass)).wait()
        } else {
          const sc = new ethers.Contract(CONTRACT, ABI_STAKE_NORMAL, importedSigner)
          await (await sc.stakeNormal(gross)).wait()
        }
        setStakeMsg({ ok: true, text: `✓ ${s} H2O 2.0 stakeados${refToPass ? ' (referido registrado)' : ''}` })
        setStakeAmt(''); refresh()
      } else setStakeMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setStakeMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLS(false) }
  }

  // ── REGISTER referrer (manual) ──────────────────────────────────────────
  const doRegister = async (referrer: string) => {
    if (!referrer || !ethers.isAddress(referrer)) { setRegMsg({ ok: false, text: 'Dirección inválida' }); return }
    if (referrer.toLowerCase() === addr.toLowerCase()) { setRegMsg({ ok: false, text: 'No puedes referirte a ti mismo' }); return }
    if (refInfo?.myReferrer && refInfo.myReferrer !== ethers.ZeroAddress) {
      setRegMsg({ ok: false, text: 'Ya tienes un referido registrado' }); return
    }
    setLReg(true); setRegMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_REGISTER, functionName: 'register', args: [referrer] }],
        })
        if (finalPayload.status === 'success') {
          setRegMsg({ ok: true, text: '✓ Referido registrado' }); refresh()
        } else setRegMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(CONTRACT, ABI_REGISTER, importedSigner)
        await (await sc.register(referrer)).wait()
        setRegMsg({ ok: true, text: '✓ Referido registrado' }); refresh()
      } else setRegMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setRegMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLReg(false) }
  }

  // ── UNSTAKE ──────────────────────────────────────────────────────────────
  const doUnstake = async () => {
    if (!user || user.staked === 0n) { setUMsg({ ok: false, text: 'Sin stake activo' }); return }
    let amount: bigint
    try { amount = unstakeAmt ? ethers.parseUnits(unstakeAmt.replace(',', '.'), DECIMALS) : user.staked }
    catch { return }
    if (!amount || amount > user.staked) { setUMsg({ ok: false, text: 'Cantidad inválida' }); return }
    setLU(true); setUMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_UNSTAKE, functionName: 'unstake', args: [amount.toString()] }],
        })
        if (finalPayload.status === 'success') {
          setUMsg({ ok: true, text: '✓ Retiro exitoso' }); setUnstakeAmt(''); refresh()
        } else setUMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(CONTRACT, ABI_UNSTAKE, importedSigner)
        await (await sc.unstake(amount)).wait()
        setUMsg({ ok: true, text: '✓ Retiro exitoso' }); setUnstakeAmt(''); refresh()
      } else setUMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setUMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLU(false) }
  }

  // ── CLAIM STAKE ──────────────────────────────────────────────────────────
  const doClaim = async () => {
    if (!user || user.pendingReward === 0n) { setClaimMsg({ ok: false, text: 'Sin recompensas de stake pendientes' }); return }
    setLC(true); setClaimMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_CLAIM, functionName: 'claimRewards', args: [] }],
        })
        if (finalPayload.status === 'success') {
          setClaimMsg({ ok: true, text: '✓ Recompensas de stake reclamadas' }); refresh()
        } else setClaimMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(CONTRACT, ABI_CLAIM, importedSigner)
        await (await sc.claimRewards()).wait()
        setClaimMsg({ ok: true, text: '✓ Recompensas de stake reclamadas' }); refresh()
      } else setClaimMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setClaimMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLC(false) }
  }

  // ── CLAIM REFERRAL (bonus 5% que regresa al usuario cuando sus referidos reclaman)
  // El contrato acumula el bonus en pendingReward; claimRewards() lo incluye.
  // Los earnings del referrer (5% de cada claim del referido) se auto-envían al wallet.
  const doClaimRef = async () => {
    const pending = user?.pendingReward ?? 0n
    const refEarned = refInfo?.myReferralEarnings ?? 0n
    if (pending === 0n && refEarned === 0n) {
      setClaimRefMsg({ ok: false, text: 'Sin recompensas de referido pendientes' }); return
    }
    setLCR(true); setClaimRefMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_CLAIM, functionName: 'claimRewards', args: [] }],
        })
        if (finalPayload.status === 'success') {
          setClaimRefMsg({ ok: true, text: '✓ Recompensas de referido reclamadas' }); refresh()
        } else setClaimRefMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(CONTRACT, ABI_CLAIM, importedSigner)
        await (await sc.claimRewards()).wait()
        setClaimRefMsg({ ok: true, text: '✓ Recompensas de referido reclamadas' }); refresh()
      } else setClaimRefMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setClaimRefMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLCR(false) }
  }

  // ── FUND (owner) ──────────────────────────────────────────────────────────
  const doFund = async () => {
    const s = fundAmt.replace(',', '.')
    let amount: bigint
    try { amount = ethers.parseUnits(s, DECIMALS) } catch { return }
    if (!amount) return
    setLF(true); setFundMsg(null)
    try {
      if (isMK) {
        const nonce = randomNonce()
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_FUND_PERMIT2, functionName: 'fundRewardPoolPermit2', args: [
            { permitted: { token: TOKEN, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ]}],
          permit2: [{ permitted: { token: TOKEN, amount: amount.toString() }, spender: CONTRACT, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') {
          setFundMsg({ ok: true, text: `✓ Pool fondeado con ${s} H2O 2.0` }); setFundAmt(''); refresh()
        } else setFundMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const tc = new ethers.Contract(TOKEN, ABI_ERC20, importedSigner)
        const allow = await tc.allowance(addr, CONTRACT)
        if (allow < amount) await (await tc.approve(CONTRACT, amount * 100n)).wait()
        const sc = new ethers.Contract(CONTRACT, ABI_FUND_DIRECT, importedSigner)
        await (await sc.fundRewardPool(amount)).wait()
        setFundMsg({ ok: true, text: `✓ Pool fondeado con ${s} H2O 2.0` }); setFundAmt(''); refresh()
      } else setFundMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setFundMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLF(false) }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const apr = (global && global.totalStaked > 0n)
    ? calcApr(global.rewardRate, global.totalStaked)
    : '—'

  const TABS = [
    { id: 'stake'   as const, icon: <Zap className="w-3.5 h-3.5" />,       label: 'Stake' },
    { id: 'ref'     as const, icon: <Users className="w-3.5 h-3.5" />,      label: 'Referidos' },
    { id: 'stats'   as const, icon: <TrendingUp className="w-3.5 h-3.5" />, label: 'Stats' },
    ...(isOwner ? [{ id: 'fondear' as const, icon: <Fuel className="w-3.5 h-3.5" />, label: 'Fondear' }] : []),
  ]

  const refLink = addr ? `${APP_BASE_URL}&ref=${addr}` : ''
  const hasReferrer = refInfo && refInfo.myReferrer && refInfo.myReferrer !== ethers.ZeroAddress

  return (
    <div className="space-y-4 pb-8">

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <div className="relative rounded-3xl overflow-hidden border border-cyan-500/30">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-950 via-teal-900/80 to-blue-950" />
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-48 h-48 rounded-full bg-cyan-500/10 blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-32 h-32 rounded-full bg-teal-400/10 blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
        <div className="relative z-10 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl overflow-hidden border border-cyan-400/40">
                  <img src="/tokens/h2o2.webp" className="w-full h-full object-cover" alt="H2O 2.0" />
                </div>
                <span className="text-sm font-black text-foreground">H2O 2.0 Staking</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-400/20 border border-cyan-400/30 text-cyan-400">LIVE</span>
              </div>
              <p className="text-xs text-cyan-300/70 ml-10">APR dinámico · Retiro inmediato · 15% fee claim</p>
            </div>
            <button onClick={loadData} disabled={loading}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10">
              <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', loading && 'animate-spin')} />
            </button>
          </div>

          {/* APR + pool row */}
          <div className="flex items-center gap-4 mb-4">
            <div>
              <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-teal-400">{apr}</span>
              <span className="text-lg font-bold text-cyan-300/70 ml-1">APR</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">sube con más pool, baja con más stakers</p>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-xs font-bold text-foreground">{global ? fmt(global.totalStaked) : '…'}</div>
                <div className="text-[10px] text-muted-foreground">Total staked</div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-xs font-bold text-foreground">{global ? fmt(global.rewardPool) : '…'}</div>
                <div className="text-[10px] text-muted-foreground">Pool H2O</div>
              </div>
            </div>
          </div>

          {/* Contract paused warning */}
          {global?.paused && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/30 p-2.5 mb-3">
              <Shield className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-300 font-semibold">El contrato está pausado — retiros y claims desactivados temporalmente.</span>
            </div>
          )}

          {/* User position */}
          {addr && (
            <div className="rounded-2xl bg-black/30 border border-cyan-400/20 p-3 grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-xs font-black text-cyan-300">{user ? fmt(user.staked) : '…'}</div>
                <div className="text-[10px] text-muted-foreground">Mi stake</div>
              </div>
              <div className="text-center border-x border-white/10">
                <div className="text-xs font-black text-amber-300">{user ? fmt(user.pendingReward) : '…'}</div>
                <div className="text-[10px] text-muted-foreground">Pendiente</div>
              </div>
              <div className="text-center">
                <div className="text-xs font-black text-emerald-300">{fmt(h2oBalance)}</div>
                <div className="text-[10px] text-muted-foreground">Balance</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── TABS ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-2xl bg-white/5 p-1 border border-white/10">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-colors',
              tab === t.id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-muted-foreground hover:text-foreground')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════ TAB: STAKE ═══════════════════════════════════ */}
      {tab === 'stake' && (
        <div className="space-y-3">

          {/* Comisiones info */}
          <div className="rounded-2xl bg-white/5 border border-white/10 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-foreground">Comisiones del contrato</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-black/30 p-2">
                <div className="text-sm font-black text-amber-300">
                  {global ? Number(global.depositFeeBps) / 100 + '%' : '5%'}
                </div>
                <div className="text-[10px] text-muted-foreground">Depósito</div>
              </div>
              <div className="rounded-xl bg-black/30 p-2">
                <div className="text-sm font-black text-amber-300">
                  {global ? Number(global.withdrawFeeBps) / 100 + '%' : '5%'}
                </div>
                <div className="text-[10px] text-muted-foreground">Retiro</div>
              </div>
              <div className="rounded-xl bg-black/30 p-2">
                <div className="text-sm font-black text-amber-300">
                  {global ? Number(global.claimFeeBps) / 100 + '%' : '15%'}
                </div>
                <div className="text-[10px] text-muted-foreground">Claim → owner</div>
              </div>
            </div>
          </div>

          {/* STAKE FORM */}
          <div className="rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/60 to-teal-950/60 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-black text-foreground">Depositar H2O 2.0</span>
              <span className="ml-auto text-[10px] text-muted-foreground">Bal: {fmt(h2oBalance)}</span>
            </div>
            <div className="flex gap-2">
              <input value={stakeAmt} onChange={e => setStakeAmt(e.target.value)} placeholder="0.00"
                className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-cyan-500/50" />
              <button onClick={() => setStakeAmt(fmt(h2oBalance, 18, 6).replace(/\./g, '.').replace(/,/g, ''))}
                className="px-3 rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-xs font-bold text-cyan-400 hover:bg-cyan-500/25">MAX</button>
            </div>
            {global && global.depositFeeBps > 0n && (
              <p className="text-[10px] text-amber-400/80">⚠ Fee entrada: {Number(global.depositFeeBps)/100}% → recibes {(100 - Number(global.depositFeeBps)/100).toFixed(0)}% neto</p>
            )}
            {stakeMsg && <Msg msg={stakeMsg} onClear={() => setStakeMsg(null)} />}
            <Btn onClick={doStake} loading={lStake} disabled={!stakeAmt || !addr}
              label="Stakear H2O 2.0" icon={<ArrowDownToLine className="w-4 h-4 shrink-0" />}
              color="bg-cyan-500/20 border-cyan-500/40 text-cyan-300" />
          </div>

          {/* UNSTAKE */}
          <div className="rounded-3xl border border-violet-500/25 bg-gradient-to-br from-violet-950/50 to-purple-950/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ArrowUpFromLine className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-black text-foreground">Retirar H2O 2.0</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                <CheckCircle2 className="w-3 h-3" /> Inmediato
              </span>
            </div>
            <div className="flex gap-2">
              <input value={unstakeAmt} onChange={e => setUnstakeAmt(e.target.value)}
                placeholder={user ? fmt(user.staked, 18, 4) : '0.00'}
                className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-violet-500/50" />
              <button onClick={() => user && setUnstakeAmt(ethers.formatUnits(user.staked, DECIMALS))}
                className="px-3 rounded-xl bg-violet-500/15 border border-violet-500/25 text-xs font-bold text-violet-400 hover:bg-violet-500/25">MAX</button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Stakeado: <span className="text-foreground font-bold">{user ? fmt(user.staked) : '…'} H2O</span>
              {global && global.withdrawFeeBps > 0n && (
                <span className="text-amber-400 ml-2">· Fee retiro: {Number(global.withdrawFeeBps)/100}%</span>
              )}
            </div>
            {unstakeMsg && <Msg msg={unstakeMsg} onClear={() => setUMsg(null)} />}
            <Btn onClick={doUnstake} loading={lUnstake} disabled={!user || user.staked === 0n || !addr}
              label="Retirar al instante" icon={<ArrowUpFromLine className="w-4 h-4 shrink-0" />}
              color="bg-violet-500/20 border-violet-500/40 text-violet-300" />
          </div>

          {/* CLAIM */}
          <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-950/50 to-orange-950/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-black text-foreground">Reclamar Recompensas</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                <CheckCircle2 className="w-3 h-3" /> Inmediato
              </span>
            </div>
            <div className="rounded-xl bg-black/20 border border-amber-500/20 p-3 text-center">
              <div className="text-2xl font-black text-amber-300">
                {user ? fmt(user.pendingReward) : '…'} <span className="text-base font-bold text-amber-400/70">H2O</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Recompensas acumuladas</div>
            </div>
            {/* Claim fee breakdown */}
            <div className="rounded-xl bg-black/20 border border-amber-500/15 p-2.5 space-y-1">
              <div className="text-[10px] font-bold text-amber-400/80 uppercase tracking-wider mb-1">Fee claim (15% siempre)</div>
              {hasReferrer ? (
                <>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">→ Referrer ({shortAddr(refInfo!.myReferrer)})</span>
                    <span className="text-violet-400 font-bold">5%</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">→ Owner</span>
                    <span className="text-amber-400 font-bold">5%</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">→ Bonus devuelto a ti</span>
                    <span className="text-emerald-400 font-bold">+5%</span>
                  </div>
                  <div className="flex justify-between text-[10px] border-t border-white/10 pt-1">
                    <span className="text-foreground font-bold">Tú recibes</span>
                    <span className="text-emerald-300 font-black">90%</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">→ Owner (sin referido)</span>
                    <span className="text-amber-400 font-bold">15%</span>
                  </div>
                  <div className="flex justify-between text-[10px] border-t border-white/10 pt-1">
                    <span className="text-foreground font-bold">Tú recibes</span>
                    <span className="text-yellow-300 font-black">85%</span>
                  </div>
                  <div className="text-[10px] text-violet-300/80 pt-0.5">
                    💡 Con referido recibirías 90% — ve a la pestaña Referidos
                  </div>
                </>
              )}
            </div>
            {/* Pool vacío warning */}
            {global && global.rewardPool === 0n && global.rewardRate === 0n && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/25 p-2.5">
                <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px] text-amber-300/90">El pool de recompensas está vacío — las recompensas se activarán cuando el owner fondee el contrato.</span>
              </div>
            )}
            {claimMsg && <Msg msg={claimMsg} onClear={() => setClaimMsg(null)} />}
            <Btn onClick={doClaim} loading={lClaim} disabled={!user || user.pendingReward === 0n || !addr}
              label="Reclamar recompensas" icon={<Gift className="w-4 h-4 shrink-0" />}
              color="bg-amber-500/20 border-amber-500/40 text-amber-300" />
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB: REFERIDOS ══════════════════════════════ */}
      {tab === 'ref' && (
        <div className="space-y-3">

          {/* Cómo funciona */}
          <div className="rounded-2xl bg-gradient-to-br from-violet-950/60 to-purple-950/60 border border-violet-500/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-black text-foreground">Sistema de Referidos</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-400/20 border border-violet-400/30 text-violet-400">ILIMITADOS</span>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-violet-500/30 border border-violet-500/40 flex items-center justify-center text-[10px] font-bold text-violet-300 shrink-0">1</span>
                <span>Comparte tu link. Cada persona que se registre con tu dirección es tu referido.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-violet-500/30 border border-violet-500/40 flex items-center justify-center text-[10px] font-bold text-violet-300 shrink-0">2</span>
                <span>Cada vez que tu referido reclame recompensas, tú recibes <span className="text-violet-300 font-bold">5% del bruto</span> automáticamente.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-violet-500/30 border border-violet-500/40 flex items-center justify-center text-[10px] font-bold text-violet-300 shrink-0">3</span>
                <span>Referidos ilimitados. Sin límite de profundidad. Sin caducidad.</span>
              </div>
            </div>
            {/* Desglose del fee de claim */}
            <div className="mt-3 rounded-xl bg-black/30 border border-violet-500/20 p-3 space-y-1">
              <div className="text-[10px] font-bold text-violet-300 uppercase tracking-wider mb-1.5">Fee de claim (15% del bruto)</div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Con referido → referrer gana</span>
                <span className="text-violet-300 font-bold">5%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Con referido → bonus al usuario</span>
                <span className="text-emerald-300 font-bold">+5%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Con referido → owner</span>
                <span className="text-amber-300 font-bold">5%</span>
              </div>
              <div className="flex justify-between text-xs border-t border-white/10 pt-1 mt-1">
                <span className="text-foreground font-bold">Con referido → usuario recibe</span>
                <span className="text-emerald-300 font-black">90%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Sin referido → usuario recibe</span>
                <span className="text-yellow-300 font-bold">85%</span>
              </div>
            </div>
          </div>

          {/* Mi estado de referido */}
          {addr && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-bold text-foreground">Mi Estado</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-black/30 border border-white/10 p-2.5 text-center">
                  <div className="text-base font-black text-violet-300">
                    {refInfo ? refInfo.myReferralCount.toString() : '…'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Personas referidas</div>
                </div>
                <div className="rounded-xl bg-black/30 border border-white/10 p-2.5 text-center">
                  <div className="text-base font-black text-emerald-300">
                    {refInfo ? fmt(refInfo.myReferralEarnings) : '…'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">H2O ganados</div>
                </div>
              </div>
              <div className="rounded-xl bg-black/20 border border-white/10 p-2.5">
                <div className="text-[10px] text-muted-foreground mb-1">Mi referrer (quien me invitó)</div>
                <div className="text-xs font-mono text-foreground break-all">
                  {hasReferrer
                    ? (refInfo!.myReferrer)
                    : <span className="text-muted-foreground italic">Sin referrer registrado</span>
                  }
                </div>
              </div>
            </div>
          )}

          {/* Claim recompensas de referido */}
          {addr && (
            <div className="rounded-3xl border border-violet-500/25 bg-gradient-to-br from-violet-950/50 to-purple-950/50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-black text-foreground">Claim Recompensas Referido</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-black/30 border border-violet-500/20 p-2.5 text-center">
                  <div className="text-base font-black text-violet-300">
                    {user ? fmt(user.pendingReward) : '…'} <span className="text-xs font-normal text-muted-foreground">H2O</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">Bonus pendiente</div>
                </div>
                <div className="rounded-xl bg-black/30 border border-violet-500/20 p-2.5 text-center">
                  <div className="text-base font-black text-emerald-300">
                    {refInfo ? fmt(refInfo.myReferralEarnings) : '…'} <span className="text-xs font-normal text-muted-foreground">H2O</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">Total ganado</div>
                </div>
              </div>
              <p className="text-[10px] text-violet-300/70">
                ℹ El 5% que recibes como referido se acumula junto con tus rewards de stake y se reclama aquí.
                Tus referidos te generan el 5% automáticamente cada vez que ellos reclaman.
              </p>
              {claimRefMsg && <Msg msg={claimRefMsg} onClear={() => setClaimRefMsg(null)} />}
              <Btn onClick={doClaimRef} loading={lClaimRef}
                disabled={!addr || ((user?.pendingReward ?? 0n) === 0n && (refInfo?.myReferralEarnings ?? 0n) === 0n)}
                label="Reclamar recompensas de referido"
                icon={<Gift className="w-4 h-4 shrink-0" />}
                color="bg-violet-500/20 border-violet-500/40 text-violet-300" />
            </div>
          )}

          {/* Registrar referrer manualmente */}
          {addr && !hasReferrer && (
            <div className="rounded-2xl bg-white/5 border border-amber-500/25 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-bold text-foreground">Registrar mi Referrer</span>
              </div>
              {urlRef && (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 p-2.5 text-xs">
                  <span className="text-amber-300 font-bold">Link detectado: </span>
                  <span className="font-mono text-foreground">{shortAddr(urlRef)}</span>
                </div>
              )}
              <RegisterRefForm
                urlRef={urlRef}
                loading={lReg}
                onRegister={doRegister}
              />
              {regMsg && <Msg msg={regMsg} onClear={() => setRegMsg(null)} />}
            </div>
          )}

          {/* Mi link de referido */}
          {addr && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Copy className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-sm font-bold text-foreground">Mi Link de Referido</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Comparte este link. Quien haga stake usando tu link quedará registrado como tu referido.</p>
              <CopyRow label={refLink} value={refLink} />
              <CopyRow label={`Mi dirección: ${shortAddr(addr)}`} value={addr} />
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ TAB: STATS ═══════════════════════════════════ */}
      {tab === 'stats' && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-bold text-foreground">Dashboard Global</span>
            </div>
            {global ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Total Stakeado" value={fmt(global.totalStaked) + ' H2O'} c="text-cyan-300" />
                <Stat label="Pool Recompensas" value={fmt(global.rewardPool) + ' H2O'} c="text-emerald-300" />
                <Stat label="APR Dinámico" value={apr} sub="varía con pool y stakers" c="text-amber-300" />
                <Stat label="Balance Contrato" value={fmt(global.contractBalance) + ' H2O'} c="text-teal-300" />
                <Stat label="Fee Depósito" value={Number(global.depositFeeBps)/100 + '%'} c="text-gray-300" />
                <Stat label="Fee Retiro" value={Number(global.withdrawFeeBps)/100 + '%'} c="text-gray-300" />
                <Stat label="Fee Claim" value={Number(global.claimFeeBps)/100 + '%'} sub="→ 100% al owner" c="text-amber-300" />
                <Stat label="Tú recibes (claim)" value={(100 - Number(global.claimFeeBps)/100).toFixed(0) + '%'} c="text-emerald-300" />
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Cargando…</span>
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-foreground">Contrato H2O 2.0 Staking</span>
            </div>
            <CopyRow label={`Stake: ${CONTRACT.slice(0, 20)}…`} value={CONTRACT} />
            <CopyRow label={`Token: ${TOKEN.slice(0, 20)}…`} value={TOKEN} />
            <a href={`https://worldscan.org/address/${CONTRACT}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 mt-1">
              <ExternalLink className="w-3.5 h-3.5" /> Ver en WorldScan
            </a>
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-foreground">Resumen de Comisiones</span>
            </div>
            {[
              { label: 'Depósito', val: global ? Number(global.depositFeeBps)/100 + '%' : '5%', c: 'text-amber-400' },
              { label: 'Retiro inmediato', val: global ? Number(global.withdrawFeeBps)/100 + '%' : '5%', c: 'text-amber-400' },
              { label: 'Claim — fee al owner', val: global ? Number(global.claimFeeBps)/100 + '%' : '15%', c: 'text-amber-400' },
              { label: 'Claim — tú recibes', val: global ? (100 - Number(global.claimFeeBps)/100).toFixed(0) + '%' : '85%', c: 'text-emerald-400' },
              { label: 'Sin referido → fee va a', val: 'Owner directo', c: 'text-cyan-400' },
            ].map((r, i) => (
              <div key={i} className="flex justify-between text-xs py-0.5">
                <span className="text-muted-foreground">{r.label}</span>
                <span className={cn('font-bold', r.c)}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB: FONDEAR (owner only) ═══════════════════ */}
      {tab === 'fondear' && isOwner && (
        <div className="space-y-3">
          <div className="rounded-3xl border border-teal-500/30 bg-gradient-to-br from-teal-950/60 to-cyan-950/60 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-500/30 flex items-center justify-center">
                <Fuel className="w-4 h-4 text-teal-400" />
              </div>
              <div>
                <span className="text-sm font-black text-foreground">Fondear Pool de Recompensas</span>
                <p className="text-[10px] text-teal-300/70">Owner — Permit2 (World App) o ERC20 directo</p>
              </div>
            </div>

            <div className="rounded-xl bg-black/30 border border-white/10 p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Pool actual:</span>
                <span className="text-emerald-300 font-bold">{global ? fmt(global.rewardPool) : '…'} H2O</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Balance contrato:</span>
                <span className="text-foreground font-bold">{global ? fmt(global.contractBalance) : '…'} H2O</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Tu balance:</span>
                <span className="text-foreground font-bold">{fmt(h2oBalance)} H2O</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">APR actual:</span>
                <span className="text-amber-300 font-bold">{apr}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <input value={fundAmt} onChange={e => setFundAmt(e.target.value)} placeholder="0.00 H2O"
                className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-teal-500/50" />
              <button onClick={() => setFundAmt(ethers.formatUnits(h2oBalance, DECIMALS))}
                className="px-3 rounded-xl bg-teal-500/15 border border-teal-500/25 text-xs font-bold text-teal-400 hover:bg-teal-500/25">MAX</button>
            </div>

            {fundMsg && <Msg msg={fundMsg} onClear={() => setFundMsg(null)} />}
            <Btn onClick={doFund} loading={lFund} disabled={!fundAmt || !addr}
              label="Fondear Pool" icon={<Fuel className="w-4 h-4 shrink-0" />}
              color="bg-teal-500/20 border-teal-500/40 text-teal-300" />
          </div>
        </div>
      )}
    </div>
  )
}
