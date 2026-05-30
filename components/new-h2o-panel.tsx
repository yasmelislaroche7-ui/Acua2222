'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Droplets, Zap, Users, Gift, Copy, Check, ExternalLink,
  TrendingUp, ArrowDownToLine, ArrowUpFromLine, RefreshCw,
  Shield, Heart, Info, Star, Loader2, CheckCircle2, XCircle,
  Fuel, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { WORLD_CHAIN_RPC, randomNonce } from '@/lib/new-contracts'

// ─── Contract Config ─────────────────────────────────────────────────────────
const CONTRACT    = '0x57A5f1557AFc8FE41203ff5cB6D6423cC607B69e'
const TOKEN       = '0x08131A6f780AEF79E86518c4A10c06387Ec74636'
const DECIMALS    = 18
const APP_DOMAIN  = 'https://acua.app'
const OWNER1      = '0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4'
const OWNER2_ADDR = '0xc2ef127734f296952de75c1b58a6cec605cc2e59'

// ─── ABIs ────────────────────────────────────────────────────────────────────
const ABI_READ = [
  'function getUserInfo(address) view returns (uint256 staked, uint256 pendingReward, address referrer, uint256 refEarnings, uint256 refCount)',
  'function getGlobalStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  'function getReferrals(address) view returns (address[])',
  'function earned(address) view returns (uint256)',
  'function currentAprBps() view returns (uint256)',
  'function owner() view returns (address)',
  'function owner2() view returns (address)',
]
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
const ABI_STAKE: any[] = [{
  name: 'stake', type: 'function', stateMutability: 'nonpayable',
  inputs: [PERMIT2_TUPLE, { name: 'sig', type: 'bytes' }, { name: 'grossAmount', type: 'uint256' }, { name: 'referrer', type: 'address' }],
  outputs: [],
}]
const ABI_STAKE_NORMAL: any[] = [
  'function stakeNormal(uint256 grossAmount, address referrer) nonpayable',
]
const ABI_UNSTAKE: any[] = [
  'function unstake(uint256 amount) nonpayable',
]
const ABI_CLAIM: any[] = [
  'function claimRewards() nonpayable',
]
const ABI_REGISTER: any[] = [
  'function register(address referrer) nonpayable',
]
const ABI_FUND: any[] = [{
  name: 'fundRewardPool', type: 'function', stateMutability: 'nonpayable',
  inputs: [PERMIT2_TUPLE, { name: 'sig', type: 'bytes' }, { name: 'amount', type: 'uint256' }],
  outputs: [],
}]
const ABI_FUND_DIRECT: any[] = [
  'function fundRewardPoolDirect(uint256 amount) nonpayable',
]

// ─── Types ───────────────────────────────────────────────────────────────────
interface GlobalStats {
  totalStaked: bigint; rewardPool: bigint; rewardRate: bigint; aprBps: bigint
  totalDeposited: bigint; totalWithdrawn: bigint; totalClaimed: bigint
  totalFeesPaid: bigint; totalReferralsPaid: bigint; totalFunded: bigint
  totalUsers: bigint; totalReferralLinks: bigint
  depositFeeBps: bigint; withdrawFeeBps: bigint; claimFeeBps: bigint
}
interface UserInfo {
  staked: bigint; pendingReward: bigint
  referrer: string; refEarnings: bigint; refCount: bigint
}
interface MsgState { ok: boolean; text: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(val: bigint, dec = 18, dp = 3): string {
  return Number(ethers.formatUnits(val, dec)).toLocaleString('es', {
    minimumFractionDigits: 0, maximumFractionDigits: dp,
  })
}
function fmtApr(aprBps: bigint): string {
  return (Number(aprBps) / 100).toFixed(2) + '%'
}
function shortAddr(addr: string): string {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return addr.slice(0, 6) + '...' + addr.slice(-4)
}
function parseMkErr(payload: any): string {
  if (!payload) return 'Sin respuesta'
  if (payload.status === 'error') {
    const d = payload.errorCode || payload.description || ''
    if (typeof d === 'string' && d.includes('user_rejected')) return 'Cancelado por el usuario'
    return String(d) || 'Error desconocido'
  }
  return 'Error desconocido'
}
function isValid(addr: string): boolean {
  try { ethers.getAddress(addr); return true } catch { return false }
}
function provider() { return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC) }

// ─── Sub-components ───────────────────────────────────────────────────────────
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
    <div className={cn('flex items-start gap-2 rounded-2xl p-3 border', msg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300')}>
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

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props { userAddress: string; walletMode?: 'minikit' | 'imported' | null; importedSigner?: ethers.Signer | null }

export function NewH2OPanel({ userAddress, walletMode, importedSigner }: Props) {
  const [tab, setTab] = useState<'stake' | 'referidos' | 'stats' | 'fondear'>('stake')
  const [global, setGlobal]   = useState<GlobalStats | null>(null)
  const [user, setUser]       = useState<UserInfo | null>(null)
  const [myRefs, setMyRefs]   = useState<string[]>([])
  const [h2oBalance, setH2oBal] = useState(0n)
  const [loading, setLoading] = useState(false)
  const [isOwner, setIsOwner] = useState(false)

  const [stakeAmt, setStakeAmt]     = useState('')
  const [unstakeAmt, setUnstakeAmt] = useState('')
  const [fundAmt, setFundAmt]       = useState('')
  const [refInput, setRefInput]     = useState('')
  const [urlRef, setUrlRef]         = useState('')
  const [fromUrl, setFromUrl]       = useState(false)

  const [stakeMsg, setStakeMsg]   = useState<MsgState | null>(null)
  const [unstakeMsg, setUMsg]     = useState<MsgState | null>(null)
  const [claimMsg, setClaimMsg]   = useState<MsgState | null>(null)
  const [regMsg, setRegMsg]       = useState<MsgState | null>(null)
  const [fundMsg, setFundMsg]     = useState<MsgState | null>(null)

  const [lStake, setLS]  = useState(false)
  const [lUnstake, setLU] = useState(false)
  const [lClaim, setLC]  = useState(false)
  const [lReg, setLR]    = useState(false)
  const [lFund, setLF]   = useState(false)

  const addr = userAddress || ''
  const isMK = walletMode === 'minikit' || MiniKit.isInstalled()

  // ── URL ref ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const r = new URLSearchParams(window.location.search).get('ref') || ''
    if (r && isValid(r)) { setUrlRef(r); setRefInput(r); setFromUrl(true) }
  }, [])

  // ── Load data ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!addr) return
    setLoading(true)
    try {
      const prov = provider()
      const c = new ethers.Contract(CONTRACT, ABI_READ, prov)
      const t = new ethers.Contract(TOKEN, ABI_ERC20, prov)
      const [gs, ui, refs, bal, ow1, ow2] = await Promise.all([
        c.getGlobalStats(),
        c.getUserInfo(addr),
        c.getReferrals(addr),
        t.balanceOf(addr),
        c.owner(),
        c.owner2(),
      ])
      setGlobal({
        totalStaked: gs[0], rewardPool: gs[1], rewardRate: gs[2], aprBps: gs[3],
        totalDeposited: gs[4], totalWithdrawn: gs[5], totalClaimed: gs[6],
        totalFeesPaid: gs[7], totalReferralsPaid: gs[8], totalFunded: gs[9],
        totalUsers: gs[10], totalReferralLinks: gs[11],
        depositFeeBps: gs[12], withdrawFeeBps: gs[13], claimFeeBps: gs[14],
      })
      setUser({ staked: ui[0], pendingReward: ui[1], referrer: ui[2], refEarnings: ui[3], refCount: ui[4] })
      setMyRefs(refs as string[])
      setH2oBal(bal)
      const addrLow = addr.toLowerCase()
      setIsOwner(addrLow === ow1.toLowerCase() || addrLow === ow2.toLowerCase())
    } catch (e) { console.error('H2OStake3 load:', e) }
    finally { setLoading(false) }
  }, [addr])

  useEffect(() => { loadData() }, [loadData])

  // ── Helpers ──────────────────────────────────────────────────────────────
  const activeRef = () => {
    if (user?.referrer && user.referrer !== ethers.ZeroAddress) return user.referrer
    if (urlRef && isValid(urlRef)) return urlRef
    if (refInput && isValid(refInput)) return refInput
    return ethers.ZeroAddress
  }
  const refLink = addr ? `${APP_DOMAIN}/stake?ref=${addr}` : ''
  const refresh = () => setTimeout(loadData, 4000)

  // ── STAKE ────────────────────────────────────────────────────────────────
  const doStake = async () => {
    const s = stakeAmt.replace(',', '.')
    let gross: bigint; try { gross = ethers.parseUnits(s, DECIMALS) } catch { return }
    if (!gross) return
    if (h2oBalance < gross) { setStakeMsg({ ok: false, text: 'Balance insuficiente' }); return }
    setLS(true); setStakeMsg(null)
    try {
      const ref = activeRef()
      if (isMK) {
        const nonce = randomNonce(), deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_STAKE, functionName: 'stake', args: [
            { permitted: { token: TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0', gross.toString(), ref,
          ]}],
          permit2: [{ permitted: { token: TOKEN, amount: gross.toString() }, spender: CONTRACT, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') { setStakeMsg({ ok: true, text: `✓ ${s} H2O 2.0 stakeados` }); setStakeAmt(''); refresh() }
        else setStakeMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const tc = new ethers.Contract(TOKEN, ABI_ERC20, importedSigner)
        const allow = await tc.allowance(addr, CONTRACT)
        if (allow < gross) await (await tc.approve(CONTRACT, gross * 100n)).wait()
        const sc = new ethers.Contract(CONTRACT, ABI_STAKE_NORMAL, importedSigner)
        await (await sc.stakeNormal(gross, ref)).wait()
        setStakeMsg({ ok: true, text: `✓ ${s} H2O 2.0 stakeados` }); setStakeAmt(''); refresh()
      } else setStakeMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setStakeMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLS(false) }
  }

  // ── UNSTAKE (inmediato) ──────────────────────────────────────────────────
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
        if (finalPayload.status === 'success') { setUMsg({ ok: true, text: '✓ Retiro inmediato exitoso' }); setUnstakeAmt(''); refresh() }
        else setUMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(CONTRACT, ABI_UNSTAKE, importedSigner)
        await (await sc.unstake(amount)).wait()
        setUMsg({ ok: true, text: '✓ Retiro inmediato exitoso' }); setUnstakeAmt(''); refresh()
      } else setUMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setUMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLU(false) }
  }

  // ── CLAIM (inmediato) ────────────────────────────────────────────────────
  const doClaim = async () => {
    if (!user || user.pendingReward === 0n) { setClaimMsg({ ok: false, text: 'Sin recompensas' }); return }
    setLC(true); setClaimMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_CLAIM, functionName: 'claimRewards', args: [] }],
        })
        if (finalPayload.status === 'success') { setClaimMsg({ ok: true, text: '✓ Recompensas reclamadas al instante' }); refresh() }
        else setClaimMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(CONTRACT, ABI_CLAIM, importedSigner)
        await (await sc.claimRewards()).wait()
        setClaimMsg({ ok: true, text: '✓ Recompensas reclamadas' }); refresh()
      } else setClaimMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setClaimMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLC(false) }
  }

  // ── REGISTER ─────────────────────────────────────────────────────────────
  const doRegister = async () => {
    const ref = refInput.trim()
    if (!isValid(ref)) { setRegMsg({ ok: false, text: 'Dirección inválida' }); return }
    if (ref.toLowerCase() === addr.toLowerCase()) { setRegMsg({ ok: false, text: 'No puedes referirte a ti mismo' }); return }
    if (user?.referrer && user.referrer !== ethers.ZeroAddress) { setRegMsg({ ok: false, text: 'Ya tienes un referidor' }); return }
    setLR(true); setRegMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_REGISTER, functionName: 'register', args: [ref] }],
        })
        if (finalPayload.status === 'success') { setRegMsg({ ok: true, text: `✓ Referidor registrado: ${shortAddr(ref)}` }); refresh() }
        else setRegMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(CONTRACT, ABI_REGISTER, importedSigner)
        await (await sc.register(ref)).wait()
        setRegMsg({ ok: true, text: '✓ Referidor registrado' }); refresh()
      } else setRegMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setRegMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLR(false) }
  }

  // ── FUND (owner desde World App) ──────────────────────────────────────
  const doFund = async () => {
    const s = fundAmt.replace(',', '.')
    let amount: bigint; try { amount = ethers.parseUnits(s, DECIMALS) } catch { return }
    if (!amount) return
    setLF(true); setFundMsg(null)
    try {
      if (isMK) {
        const nonce = randomNonce(), deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: CONTRACT, abi: ABI_FUND, functionName: 'fundRewardPool', args: [
            { permitted: { token: TOKEN, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0', amount.toString(),
          ]}],
          permit2: [{ permitted: { token: TOKEN, amount: amount.toString() }, spender: CONTRACT, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') { setFundMsg({ ok: true, text: `✓ Pool fondeado con ${s} H2O 2.0` }); setFundAmt(''); refresh() }
        else setFundMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const tc = new ethers.Contract(TOKEN, ABI_ERC20, importedSigner)
        const allow = await tc.allowance(addr, CONTRACT)
        if (allow < amount) await (await tc.approve(CONTRACT, amount * 100n)).wait()
        const sc = new ethers.Contract(CONTRACT, ABI_FUND_DIRECT, importedSigner)
        await (await sc.fundRewardPoolDirect(amount)).wait()
        setFundMsg({ ok: true, text: `✓ Pool fondeado con ${s} H2O 2.0` }); setFundAmt(''); refresh()
      } else setFundMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setFundMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLF(false) }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const apr = global ? fmtApr(global.aprBps) : '—'
  const hasRef = !!(user?.referrer && user.referrer !== ethers.ZeroAddress)

  const TABS = [
    { id: 'stake' as const,     icon: <Zap className="w-3.5 h-3.5" />,       label: 'Stake' },
    { id: 'referidos' as const, icon: <Users className="w-3.5 h-3.5" />,     label: 'Referidos' },
    { id: 'stats' as const,     icon: <TrendingUp className="w-3.5 h-3.5" />, label: 'Stats' },
    ...(isOwner ? [{ id: 'fondear' as const, icon: <Fuel className="w-3.5 h-3.5" />, label: 'Fondear' }] : []),
  ]

  return (
    <div className="space-y-4 pb-8">

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
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
              <p className="text-xs text-cyan-300/70 ml-10">APR de mercado · Retiro inmediato · Referidos</p>
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
              <p className="text-[10px] text-muted-foreground mt-0.5">mercado — sube/baja con pool y stakers</p>
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

      {/* ── TABS ─────────────────────────────────────────────────────────── */}
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

          {/* Referrer banner */}
          {fromUrl && urlRef && (
            <div className="flex items-center gap-2 rounded-2xl bg-violet-500/10 border border-violet-500/30 px-3 py-2.5">
              <Users className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-xs text-violet-300">Invitado por <span className="font-mono font-bold">{shortAddr(urlRef)}</span></span>
            </div>
          )}
          {hasRef && (
            <div className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-3 py-2.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs text-emerald-300">Referido por <span className="font-mono font-bold">{shortAddr(user!.referrer)}</span></span>
            </div>
          )}

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
              <button onClick={() => setStakeAmt(fmt(h2oBalance, 18, 6).replace(/,/g, ''))}
                className="px-3 rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-xs font-bold text-cyan-400 hover:bg-cyan-500/25">MAX</button>
            </div>
            {global && global.depositFeeBps > 0n && (
              <p className="text-[10px] text-amber-400/70">⚠ Comisión entrada: {Number(global.depositFeeBps) / 100}%</p>
            )}
            {global && global.depositFeeBps === 0n && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Shield className="w-3 h-3 text-green-400" /><span>0% comisión de entrada · via Permit2</span>
              </div>
            )}
            {stakeMsg && <Msg msg={stakeMsg} onClear={() => setStakeMsg(null)} />}
            <Btn onClick={doStake} loading={lStake} disabled={!stakeAmt || !addr} label="Stakear H2O 2.0"
              icon={<ArrowDownToLine className="w-4 h-4 shrink-0" />} color="bg-cyan-500/20 border-cyan-500/40 text-cyan-300" />
          </div>

          {/* UNSTAKE (inmediato) */}
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
              <button onClick={() => user && setUnstakeAmt(fmt(user.staked, 18, 6).replace(/,/g, ''))}
                className="px-3 rounded-xl bg-violet-500/15 border border-violet-500/25 text-xs font-bold text-violet-400 hover:bg-violet-500/25">MAX</button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Stakeado: <span className="text-foreground font-bold">{user ? fmt(user.staked) : '…'} H2O</span>
              {global && global.withdrawFeeBps > 0n && <span className="text-amber-400 ml-2">· Comisión: {Number(global.withdrawFeeBps) / 100}%</span>}
              {global && global.withdrawFeeBps === 0n && <span className="text-emerald-400 ml-2">· Sin comisión</span>}
            </div>
            {unstakeMsg && <Msg msg={unstakeMsg} onClear={() => setUMsg(null)} />}
            <Btn onClick={doUnstake} loading={lUnstake} disabled={!user || user.staked === 0n || !addr}
              label="Retirar al instante" icon={<ArrowUpFromLine className="w-4 h-4 shrink-0" />}
              color="bg-violet-500/20 border-violet-500/40 text-violet-300" />
          </div>

          {/* CLAIM (inmediato) */}
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
            {hasRef && (
              <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-2.5 space-y-1">
                <div className="text-xs font-bold text-violet-300 mb-1">Con referido — distribución del claim:</div>
                <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Invitador ({shortAddr(user!.referrer)}):</span><span className="text-violet-300 font-bold">5%</span></div>
                <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Tu bonus de referido:</span><span className="text-cyan-300 font-bold">+5%</span></div>
                <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">Fee sistema:</span><span className="text-gray-400">5%</span></div>
                <div className="flex justify-between text-[10px] border-t border-white/10 pt-1 mt-1"><span className="text-foreground font-bold">Tú recibes neto:</span><span className="text-amber-300 font-black">90%</span></div>
              </div>
            )}
            {claimMsg && <Msg msg={claimMsg} onClear={() => setClaimMsg(null)} />}
            <Btn onClick={doClaim} loading={lClaim} disabled={!user || user.pendingReward === 0n || !addr}
              label="Reclamar al instante" icon={<Gift className="w-4 h-4 shrink-0" />}
              color="bg-amber-500/20 border-amber-500/40 text-amber-300" />
          </div>
        </div>
      )}

      {/* ═══════════════════ TAB: REFERIDOS ══════════════════════════════ */}
      {tab === 'referidos' && (
        <div className="space-y-3">
          {/* My link */}
          <div className="rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-950/60 via-purple-900/40 to-indigo-950/60 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
                <Users className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <span className="text-sm font-black text-foreground">Mi Link de Referido</span>
                <p className="text-[10px] text-violet-300/70">Invita y gana 5% de cada claim de tus referidos</p>
              </div>
            </div>
            {addr ? <CopyRow label={`acua.app/stake?ref=${addr.slice(0, 12)}…`} value={refLink} />
              : <p className="text-xs text-muted-foreground text-center py-2">Conecta tu wallet</p>}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-sm font-black text-violet-300">{user ? user.refCount.toString() : '0'}</div>
                <div className="text-[10px] text-muted-foreground">Referidos</div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-sm font-black text-amber-300">{user ? fmt(user.refEarnings) : '0'}</div>
                <div className="text-[10px] text-muted-foreground">Ganado (H2O)</div>
              </div>
              <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
                <div className="text-sm font-black text-cyan-300">5%</div>
                <div className="text-[10px] text-muted-foreground">Por claim</div>
              </div>
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2">
              <p className="text-xs font-bold text-foreground">¿Cómo funciona?</p>
              {[
                { ic: <Zap className="w-3 h-3 text-amber-400" />,   t: 'Comparte tu link de referido' },
                { ic: <Users className="w-3 h-3 text-cyan-400" />,  t: 'Tu amigo abre el link y hace stake' },
                { ic: <Gift className="w-3 h-3 text-violet-400" />, t: 'Cada vez que reclama, tú ganas 5% automático' },
                { ic: <Star className="w-3 h-3 text-yellow-400" />, t: 'Tu amigo recibe un bonus del 5% de vuelta' },
              ].map((x, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="mt-0.5 shrink-0">{x.ic}</div>
                  <span className="text-xs text-muted-foreground">{x.t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Register my referrer */}
          <div className="rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/50 to-teal-950/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-black text-foreground">Mi Referidor</span>
            </div>
            {hasRef ? (
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3">
                <div className="text-xs text-muted-foreground mb-1">Referido por:</div>
                <div className="font-mono text-xs text-emerald-300 break-all">{user!.referrer}</div>
                <div className="text-[10px] text-muted-foreground mt-1.5">+5% bonus en cada claim ✓</div>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Si alguien te invitó, ingresa su dirección:</p>
                <input value={refInput} onChange={e => setRefInput(e.target.value)} placeholder="0x… dirección del invitador"
                  className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-emerald-500/50" />
                {fromUrl && urlRef && (
                  <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Detectado del link: {shortAddr(urlRef)}
                  </p>
                )}
                {regMsg && <Msg msg={regMsg} onClear={() => setRegMsg(null)} />}
                <Btn onClick={doRegister} loading={lReg} disabled={!refInput || !addr}
                  label="Registrar referidor" icon={<CheckCircle2 className="w-4 h-4 shrink-0" />}
                  color="bg-emerald-500/20 border-emerald-500/40 text-emerald-300" />
              </>
            )}
          </div>

          {/* My refs list */}
          {myRefs.length > 0 && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs font-bold text-foreground mb-3">Mis {myRefs.length} referido(s):</p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {myRefs.map((r, i) => (
                  <div key={r} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span className="font-mono text-foreground/80">{shortAddr(r)}</span>
                    <a href={`https://worldscan.org/address/${r}`} target="_blank" rel="noopener noreferrer" className="ml-auto">
                      <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════ TAB: STATS ══════════════════════════════════ */}
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
                <Stat label="APR Mercado" value={fmtApr(global.aprBps)} sub="sube con pool, baja con más stakers" c="text-amber-300" />
                <Stat label="Usuarios" value={global.totalUsers.toString()} c="text-violet-300" />
                <Stat label="Depositado" value={fmt(global.totalDeposited) + ' H2O'} c="text-blue-300" />
                <Stat label="Retirado" value={fmt(global.totalWithdrawn) + ' H2O'} c="text-red-300" />
                <Stat label="Reclamado" value={fmt(global.totalClaimed) + ' H2O'} c="text-amber-300" />
                <Stat label="Fondeado" value={fmt(global.totalFunded) + ' H2O'} c="text-teal-300" />
                <Stat label="Links Referido" value={global.totalReferralLinks.toString()} c="text-violet-300" />
                <Stat label="Fees Referral" value={fmt(global.totalReferralsPaid) + ' H2O'} c="text-pink-300" />
                <Stat label="Fee Entrada" value={Number(global.depositFeeBps) / 100 + '%'} sub="configurable owner" c="text-gray-300" />
                <Stat label="Fee Retiro" value={Number(global.withdrawFeeBps) / 100 + '%'} sub="configurable owner" c="text-gray-300" />
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
              <span className="text-sm font-bold text-foreground">Contrato H2O 2.0</span>
            </div>
            <CopyRow label={`${CONTRACT.slice(0, 20)}…`} value={CONTRACT} />
            <CopyRow label={`Token: ${TOKEN.slice(0, 20)}…`} value={TOKEN} />
            <a href={`https://worldscan.org/address/${CONTRACT}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 mt-1">
              <ExternalLink className="w-3.5 h-3.5" /> Ver en WorldScan
            </a>
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-foreground">Comisiones</span>
            </div>
            {[
              { label: 'Depósito', val: global ? Number(global.depositFeeBps) / 100 + '%' : '…', c: 'text-emerald-400' },
              { label: 'Retiro', val: global ? Number(global.withdrawFeeBps) / 100 + '%' : '…', c: 'text-emerald-400' },
              { label: 'Claim (sin referido)', val: global ? Number(global.claimFeeBps) / 100 + '%' : '…', c: 'text-emerald-400' },
              { label: 'Claim (con referido) — Invitador', val: '5%', c: 'text-violet-400' },
              { label: 'Claim (con referido) — Bonus tú', val: '+5%', c: 'text-cyan-400' },
              { label: 'Claim (con referido) — Sistema', val: '5%', c: 'text-gray-400' },
            ].map((r, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{r.label}</span>
                <span className={cn('font-bold', r.c)}>{r.val}</span>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-950/50 to-yellow-950/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-black text-foreground">Apoya el Ecosistema Acua</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">Dona WLD para ayudar a mantener los pools activos.</p>
            <CopyRow label="0xc2ef127734f296952de75c1b58a6cec605cc2e59" value="0xc2ef127734f296952de75c1b58a6cec605cc2e59" />
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
                <p className="text-[10px] text-teal-300/70">Owner — desde World App (Permit2) o ERC20 directo</p>
              </div>
            </div>

            <div className="rounded-xl bg-black/30 border border-white/10 p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Pool actual:</span>
                <span className="text-teal-300 font-bold">{global ? fmt(global.rewardPool) : '…'} H2O</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">APR actual:</span>
                <span className="text-amber-300 font-bold">{apr}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Tu balance H2O 2.0:</span>
                <span className="text-foreground font-bold">{fmt(h2oBalance)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <input value={fundAmt} onChange={e => setFundAmt(e.target.value)} placeholder="Cantidad a fondear"
                className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-teal-500/50" />
              <button onClick={() => setFundAmt(fmt(h2oBalance, 18, 6).replace(/,/g, ''))}
                className="px-3 rounded-xl bg-teal-500/15 border border-teal-500/25 text-xs font-bold text-teal-400 hover:bg-teal-500/25">MAX</button>
            </div>

            <div className="rounded-xl bg-teal-500/10 border border-teal-500/20 p-2.5 text-xs space-y-1 text-muted-foreground">
              <p className="font-bold text-teal-300">¿Qué hace fondear?</p>
              <p>Agrega H2O al pool de recompensas. El APR sube automáticamente (más pool / mismos stakers = más APR). Los tokens se distribuyen gradualmente durante 1 año.</p>
            </div>

            {fundMsg && <Msg msg={fundMsg} onClear={() => setFundMsg(null)} />}
            <Btn onClick={doFund} loading={lFund} disabled={!fundAmt || !addr}
              label={isMK ? 'Fondear via World App (Permit2)' : 'Fondear pool'}
              icon={<Fuel className="w-4 h-4 shrink-0" />}
              color="bg-teal-500/20 border-teal-500/40 text-teal-300" />
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
            <p className="text-xs font-bold text-foreground mb-1">Info para el owner:</p>
            {[
              'Solo el owner puede llamar fundRewardPool() con Permit2.',
              'Cualquier wallet puede llamar fundRewardPoolDirect() con ERC20 approve.',
              'El APR sube/baja automáticamente según pool y stakers — no se configura.',
              'El owner puede cambiar los % de comisiones (depositFeeBps, withdrawFeeBps, claimFeeBps) con setFees().',
            ].map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-teal-400 mt-1.5 shrink-0" />
                <span className="text-xs text-muted-foreground">{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
