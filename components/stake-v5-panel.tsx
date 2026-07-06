'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  Droplets, TrendingUp, Users, Gift, Copy, Check, Zap,
  RefreshCw, Shield, Loader2, CheckCircle2, XCircle,
  Fuel, ArrowUpFromLine, ArrowDownToLine, Percent,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  STAKE_V5_ADDRESS, ACUA_TOKEN_ADDRESS,
  STAKE_ABI_FRAG, STAKE_NORMAL_ABI_FRAG, WITHDRAW_ABI_FRAG,
  CLAIM_ABI_FRAG, REGISTER_ABI_FRAG,
  FUND_ABI_FRAG, FUND_DIRECT_ABI_FRAG, SET_APR_ABI_FRAG, SET_PAUSED_ABI_FRAG,
  SET_DEPOSIT_FEE_ABI_FRAG, SET_WITHDRAW_FEE_ABI_FRAG,
  fetchStakeV5UserInfo, fetchStakeV5GlobalStats,
  type StakeV5UserInfo, type StakeV5GlobalStats,
  formatToken, formatAPR, formatFee, randomNonce,
} from '@/lib/stake-v5'

// ─── Constants ────────────────────────────────────────────────────────────────
const DECIMALS = 18

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(val: bigint, dp = 4): string {
  try { return Number(ethers.formatUnits(val, DECIMALS)).toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: dp }) }
  catch { return '—' }
}
function shortAddr(addr: string): string {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
function parseMkErr(fp: any): string {
  if (!fp) return 'Sin respuesta'
  const d = fp.errorCode || fp.description || fp.error_code || ''
  if (typeof d === 'string' && d.includes('user_rejected')) return 'Cancelado por usuario'
  return String(d) || 'Error desconocido'
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Stat({ label, value, sub, c = 'text-violet-300' }: { label: string; value: string; sub?: string; c?: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <span className={cn('text-base font-black truncate', c)}>{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
    </div>
  )
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
function ActionBtn({ onClick, loading, disabled, label, icon, color = 'bg-violet-500/20 border-violet-500/40 text-violet-300' }: {
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

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  userAddress: string
  walletMode?: 'minikit' | 'imported' | null
  importedSigner?: ethers.Signer | null
  isAdmin?: boolean
}

type PanelTab = 'stake' | 'ref' | 'admin'

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function StakeV5Panel({ userAddress, walletMode, importedSigner, isAdmin = false }: Props) {
  const [tab, setTab] = useState<PanelTab>('stake')
  const [user, setUser]   = useState<StakeV5UserInfo | null>(null)
  const [global, setGlobal] = useState<StakeV5GlobalStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [isStakeV5Admin, setIsStakeV5Admin] = useState(false)

  const [rewardDisplay, setRewardDisplay] = useState(0n)
  const rewardRef = useRef({ base: 0n, staked: 0n, aprBps: 0n, lastAt: 0 })

  // Form state
  const [stakeAmt, setStakeAmt] = useState('')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [fundAmt, setFundAmt]   = useState('')
  const [fundDirectAmt, setFundDirectAmt] = useState('')
  const [aprInput, setAprInput] = useState('')
  const [depFeeInput, setDepFeeInput] = useState('')
  const [wdFeeInput, setWdFeeInput] = useState('')
  const [refInput, setRefInput] = useState('')
  const [urlRef, setUrlRef]     = useState('')

  // Loading flags
  const [lStake, setLS]     = useState(false)
  const [lWith, setLW]      = useState(false)
  const [lClaim, setLC]     = useState(false)
  const [lFund, setLF]      = useState(false)
  const [lFundD, setLFD]    = useState(false)
  const [lApr, setLA]       = useState(false)
  const [lDepFee, setLDepFee] = useState(false)
  const [lWdFee, setLWdFee]   = useState(false)
  const [lPause, setLP]     = useState(false)
  const [lReg, setLReg]     = useState(false)

  // Messages
  const [stakeMsg, setStakeMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [withMsg, setWithMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const [claimMsg, setClaimMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [adminMsg, setAdminMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [refMsg, setRefMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  const addr = userAddress || ''
  const isMK = walletMode === 'minikit' || (typeof window !== 'undefined' && (window as any).MiniKit)

  // ── Read ref from URL ──────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const r = params.get('ref') || ''
      if (r && ethers.isAddress(r)) setUrlRef(r)
    }
  }, [])

  // ── Load on-chain data ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!addr || !STAKE_V5_ADDRESS) return
    setLoading(true)
    try {
      const [u, g] = await Promise.all([
        fetchStakeV5UserInfo(addr),
        fetchStakeV5GlobalStats(),
      ])
      setUser(u)
      setGlobal(g)
      const addrLow = addr.toLowerCase()
      setIsStakeV5Admin(
        addrLow === g.owner.toLowerCase() || addrLow === g.owner2.toLowerCase()
      )
      rewardRef.current = { base: u.rewards, staked: u.staked, aprBps: g.aprBps, lastAt: Date.now() }
      setRewardDisplay(u.rewards)
    } catch (e) { console.error('StakeV5 load:', e) }
    finally { setLoading(false) }
  }, [addr])

  useEffect(() => { load() }, [load])

  // ── Real-time reward ticker (per second) ───────────────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      const { base, staked, aprBps, lastAt } = rewardRef.current
      if (staked === 0n || aprBps === 0n) return
      const elapsed = BigInt(Math.floor((Date.now() - lastAt) / 1000))
      const YEAR = 365n * 24n * 3600n
      const accrued = staked * elapsed * aprBps / (10_000n * YEAR)
      setRewardDisplay(base + accrued)
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  const refresh = () => setTimeout(load, 4000)
  const noRef = !user?.referrer || user.referrer === ethers.ZeroAddress
  const showAdmin = isStakeV5Admin

  const depFeePct = global ? formatFee(global.depositFeeBps) : '5.0%'
  const wdFeePct  = global ? formatFee(global.withdrawFeeBps) : '5.0%'

  // Estimated net amounts based on current fee bps
  const stakeGrossPreview = (() => {
    try { return ethers.parseUnits((stakeAmt || '0').replace(',', '.'), DECIMALS) } catch { return 0n }
  })()
  const stakeFeePreview = global ? stakeGrossPreview * global.depositFeeBps / 10_000n : 0n
  const stakeNetPreview = stakeGrossPreview - stakeFeePreview

  const withdrawGrossPreview = (() => {
    try { return withdrawAmt ? ethers.parseUnits(withdrawAmt.replace(',', '.'), DECIMALS) : (user?.staked ?? 0n) } catch { return 0n }
  })()
  const withdrawFeePreview = global ? withdrawGrossPreview * global.withdrawFeeBps / 10_000n : 0n
  const withdrawNetPreview = withdrawGrossPreview - withdrawFeePreview

  // ── STAKE ──────────────────────────────────────────────────────────────────
  const doStake = async () => {
    const s = stakeAmt.replace(',', '.')
    let gross: bigint
    try { gross = ethers.parseUnits(s, DECIMALS) } catch { return }
    if (!gross) return
    if (user && user.tokenBalance < gross) { setStakeMsg({ ok: false, text: 'Balance insuficiente' }); return }
    setLS(true); setStakeMsg(null)

    const refToPass = (noRef && urlRef && urlRef.toLowerCase() !== addr.toLowerCase()) ? urlRef : ethers.ZeroAddress

    try {
      if (isMK) {
        const nonce = randomNonce()
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: STAKE_V5_ADDRESS,
            abi: STAKE_ABI_FRAG,
            functionName: 'stake',
            args: [
              { permitted: { token: ACUA_TOKEN_ADDRESS, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
              'PERMIT2_SIGNATURE_PLACEHOLDER_0',
              gross.toString(),
              refToPass,
            ],
          }],
          permit2: [{ permitted: { token: ACUA_TOKEN_ADDRESS, amount: gross.toString() }, spender: STAKE_V5_ADDRESS, nonce: nonce.toString(), deadline: deadline.toString() }],
        })
        if (finalPayload.status === 'success') {
          setStakeMsg({ ok: true, text: `✓ ${s} ACUA depositados (5% comisión aplicada)` }); setStakeAmt(''); refresh()
        } else setStakeMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const ERC20_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) nonpayable returns (bool)']
        const tc = new ethers.Contract(ACUA_TOKEN_ADDRESS, ERC20_ABI, importedSigner)
        const allow = await tc.allowance(addr, STAKE_V5_ADDRESS)
        if (allow < gross) await (await tc.approve(STAKE_V5_ADDRESS, gross * 100n)).wait()
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, STAKE_NORMAL_ABI_FRAG, importedSigner)
        await (await sc.stakeNormal(gross, refToPass)).wait()
        setStakeMsg({ ok: true, text: `✓ ${s} ACUA depositados (5% comisión aplicada)` }); setStakeAmt(''); refresh()
      } else setStakeMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setStakeMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLS(false) }
  }

  // ── WITHDRAW (instantáneo) ────────────────────────────────────────────────
  const doWithdraw = async () => {
    if (!user || user.staked === 0n) { setWithMsg({ ok: false, text: 'Sin stake activo' }); return }
    let amount: bigint
    try {
      amount = withdrawAmt
        ? ethers.parseUnits(withdrawAmt.replace(',', '.'), DECIMALS)
        : user.staked
    } catch { return }
    if (!amount || amount > user.staked) { setWithMsg({ ok: false, text: 'Cantidad inválida' }); return }
    setLW(true); setWithMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_V5_ADDRESS, abi: WITHDRAW_ABI_FRAG, functionName: 'withdraw', args: [amount.toString()] }],
        })
        if (finalPayload.status === 'success') {
          setWithMsg({ ok: true, text: '✓ Retiro completado (5% comisión aplicada)' }); setWithdrawAmt(''); refresh()
        } else setWithMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, WITHDRAW_ABI_FRAG, importedSigner)
        await (await sc.withdraw(amount)).wait()
        setWithMsg({ ok: true, text: '✓ Retiro completado (5% comisión aplicada)' }); setWithdrawAmt(''); refresh()
      } else setWithMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setWithMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLW(false) }
  }

  // ── CLAIM (instantáneo) ───────────────────────────────────────────────────
  const doClaim = async () => {
    if (rewardDisplay === 0n) { setClaimMsg({ ok: false, text: 'Sin recompensas pendientes' }); return }
    setLC(true); setClaimMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_V5_ADDRESS, abi: CLAIM_ABI_FRAG, functionName: 'claimRewards', args: [] }],
        })
        if (finalPayload.status === 'success') {
          setClaimMsg({ ok: true, text: '✓ Recompensas reclamadas' }); refresh()
        } else setClaimMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, CLAIM_ABI_FRAG, importedSigner)
        await (await sc.claimRewards()).wait()
        setClaimMsg({ ok: true, text: '✓ Recompensas reclamadas' }); refresh()
      } else setClaimMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setClaimMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLC(false) }
  }

  // ── REGISTER referrer ─────────────────────────────────────────────────────
  const doRegister = async (referrer: string) => {
    if (!referrer || !ethers.isAddress(referrer)) { setRefMsg({ ok: false, text: 'Dirección inválida' }); return }
    if (referrer.toLowerCase() === addr.toLowerCase()) { setRefMsg({ ok: false, text: 'No puedes referirte a ti mismo' }); return }
    if (!noRef) { setRefMsg({ ok: false, text: 'Ya tienes referido registrado' }); return }
    setLReg(true); setRefMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_V5_ADDRESS, abi: REGISTER_ABI_FRAG, functionName: 'register', args: [referrer] }],
        })
        if (finalPayload.status === 'success') {
          setRefMsg({ ok: true, text: '✓ Referido registrado' }); refresh()
        } else setRefMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, REGISTER_ABI_FRAG, importedSigner)
        await (await sc.register(referrer)).wait()
        setRefMsg({ ok: true, text: '✓ Referido registrado' }); refresh()
      } else setRefMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setRefMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLReg(false) }
  }

  // ── Admin: FUND (Permit2) ─────────────────────────────────────────────────
  const doFund = async () => {
    const s = fundAmt.replace(',', '.')
    let amount: bigint
    try { amount = ethers.parseUnits(s, DECIMALS) } catch { return }
    if (!amount) return
    setLF(true); setAdminMsg(null)
    try {
      const nonce = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: STAKE_V5_ADDRESS,
          abi: FUND_ABI_FRAG,
          functionName: 'fund',
          args: [
            { permitted: { token: ACUA_TOKEN_ADDRESS, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
            amount.toString(),
          ],
        }],
        permit2: [{ permitted: { token: ACUA_TOKEN_ADDRESS, amount: amount.toString() }, spender: STAKE_V5_ADDRESS, nonce: nonce.toString(), deadline: deadline.toString() }],
      })
      if (finalPayload.status === 'success') {
        setAdminMsg({ ok: true, text: `✓ Pool fondeado con ${s} ACUA` }); setFundAmt(''); refresh()
      } else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLF(false) }
  }

  // ── Admin: FUND DIRECT ────────────────────────────────────────────────────
  const doFundDirect = async () => {
    if (!importedSigner) { setAdminMsg({ ok: false, text: 'Requiere wallet importada' }); return }
    const s = fundDirectAmt.replace(',', '.')
    let amount: bigint
    try { amount = ethers.parseUnits(s, DECIMALS) } catch { return }
    if (!amount) return
    setLFD(true); setAdminMsg(null)
    try {
      const ERC20_ABI = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) nonpayable returns (bool)']
      const tc = new ethers.Contract(ACUA_TOKEN_ADDRESS, ERC20_ABI, importedSigner)
      const allow = await tc.allowance(addr, STAKE_V5_ADDRESS)
      if (allow < amount) await (await tc.approve(STAKE_V5_ADDRESS, amount * 100n)).wait()
      const sc = new ethers.Contract(STAKE_V5_ADDRESS, FUND_DIRECT_ABI_FRAG, importedSigner)
      await (await sc.fundDirect(amount)).wait()
      setAdminMsg({ ok: true, text: `✓ Pool fondeado con ${s} ACUA (directo)` }); setFundDirectAmt(''); refresh()
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLFD(false) }
  }

  // ── Admin: SET APR ────────────────────────────────────────────────────────
  const doSetApr = async () => {
    const bps = parseInt(aprInput)
    if (!bps || bps < 0 || bps > 100000) { setAdminMsg({ ok: false, text: 'APR inválido (0–100000 bps)' }); return }
    setLA(true); setAdminMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_V5_ADDRESS, abi: SET_APR_ABI_FRAG, functionName: 'setApr', args: [bps.toString()] }],
        })
        if (finalPayload.status === 'success') {
          setAdminMsg({ ok: true, text: `✓ APR actualizado a ${(bps / 100).toFixed(2)}%` }); setAprInput(''); refresh()
        } else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, SET_APR_ABI_FRAG, importedSigner)
        await (await sc.setApr(bps)).wait()
        setAdminMsg({ ok: true, text: `✓ APR actualizado a ${(bps / 100).toFixed(2)}%` }); setAprInput(''); refresh()
      } else setAdminMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLA(false) }
  }

  // ── Admin: SET DEPOSIT FEE ────────────────────────────────────────────────
  const doSetDepositFee = async () => {
    const bps = parseInt(depFeeInput)
    if (isNaN(bps) || bps < 0 || bps > 2000) { setAdminMsg({ ok: false, text: 'Fee inválido (0–2000 bps, máx 20%)' }); return }
    setLDepFee(true); setAdminMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_V5_ADDRESS, abi: SET_DEPOSIT_FEE_ABI_FRAG, functionName: 'setDepositFee', args: [bps.toString()] }],
        })
        if (finalPayload.status === 'success') {
          setAdminMsg({ ok: true, text: `✓ Comisión de depósito actualizada a ${(bps / 100).toFixed(2)}%` }); setDepFeeInput(''); refresh()
        } else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, SET_DEPOSIT_FEE_ABI_FRAG, importedSigner)
        await (await sc.setDepositFee(bps)).wait()
        setAdminMsg({ ok: true, text: `✓ Comisión de depósito actualizada a ${(bps / 100).toFixed(2)}%` }); setDepFeeInput(''); refresh()
      } else setAdminMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLDepFee(false) }
  }

  // ── Admin: SET WITHDRAW FEE ───────────────────────────────────────────────
  const doSetWithdrawFee = async () => {
    const bps = parseInt(wdFeeInput)
    if (isNaN(bps) || bps < 0 || bps > 2000) { setAdminMsg({ ok: false, text: 'Fee inválido (0–2000 bps, máx 20%)' }); return }
    setLWdFee(true); setAdminMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_V5_ADDRESS, abi: SET_WITHDRAW_FEE_ABI_FRAG, functionName: 'setWithdrawFee', args: [bps.toString()] }],
        })
        if (finalPayload.status === 'success') {
          setAdminMsg({ ok: true, text: `✓ Comisión de retiro actualizada a ${(bps / 100).toFixed(2)}%` }); setWdFeeInput(''); refresh()
        } else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, SET_WITHDRAW_FEE_ABI_FRAG, importedSigner)
        await (await sc.setWithdrawFee(bps)).wait()
        setAdminMsg({ ok: true, text: `✓ Comisión de retiro actualizada a ${(bps / 100).toFixed(2)}%` }); setWdFeeInput(''); refresh()
      } else setAdminMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLWdFee(false) }
  }

  // ── Admin: PAUSE / UNPAUSE ────────────────────────────────────────────────
  const doPause = async (val: boolean) => {
    setLP(true); setAdminMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: STAKE_V5_ADDRESS, abi: SET_PAUSED_ABI_FRAG, functionName: 'setPaused', args: [val] }],
        })
        if (finalPayload.status === 'success') {
          setAdminMsg({ ok: true, text: val ? '✓ Contrato pausado' : '✓ Contrato reactivado' }); refresh()
        } else setAdminMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else if (importedSigner) {
        const sc = new ethers.Contract(STAKE_V5_ADDRESS, SET_PAUSED_ABI_FRAG, importedSigner)
        await (await sc.setPaused(val)).wait()
        setAdminMsg({ ok: true, text: val ? '✓ Pausado' : '✓ Reactivado' }); refresh()
      } else setAdminMsg({ ok: false, text: 'Conecta World App o importa un wallet' })
    } catch (e: any) { setAdminMsg({ ok: false, text: e?.reason || e?.message || 'Error' }) }
    finally { setLP(false) }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const tabs: { id: PanelTab; label: string }[] = [
    { id: 'stake', label: '🪙 Stake' },
    { id: 'ref', label: '👥 Referidos' },
    ...(showAdmin ? [{ id: 'admin' as PanelTab, label: '🛡 Admin' }] : []),
  ]

  return (
    <div className="space-y-4 pb-6">
      {/* ── Header ── */}
      <div className="rounded-3xl p-4 border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/10 to-purple-500/5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-fuchsia-500/20 border border-fuchsia-500/40 text-xl">🪙</div>
          <div className="flex-1">
            <h2 className="text-sm font-black text-white">Stake V5 — H2O ACUA</h2>
            <p className="text-[10px] text-fuchsia-400/80">
              Retiros y reclamos 24/7 · {depFeePct} comisión depósito · {wdFeePct} comisión retiro
              {global?.paused && <span className="ml-1 text-red-400 font-bold">· PAUSADO</span>}
            </p>
          </div>
          <button onClick={load} className="text-fuchsia-400/60 hover:text-fuchsia-400">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
            <p className="text-[9px] text-muted-foreground">APR</p>
            <p className="text-xs font-black text-fuchsia-300">{global ? formatAPR(global.aprBps) : '—'}</p>
          </div>
          <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
            <p className="text-[9px] text-muted-foreground">Stakeado</p>
            <p className="text-xs font-black text-white">{user ? fmt(user.staked, 2) : '—'}</p>
          </div>
          <div className="rounded-xl bg-black/30 border border-white/10 p-2 text-center">
            <p className="text-[9px] text-muted-foreground">Balance</p>
            <p className="text-xs font-black text-emerald-300">{user ? fmt(user.tokenBalance, 2) : '—'}</p>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-black/30 rounded-2xl p-1 border border-white/10">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex-1 rounded-xl py-2 text-xs font-bold transition-all',
              tab === t.id
                ? 'bg-fuchsia-500/25 border border-fuchsia-500/40 text-fuchsia-300'
                : 'text-muted-foreground hover:text-white')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── STAKE TAB ─────────────────────────────────────────────────── */}
      {tab === 'stake' && (
        <div className="space-y-3">
          {/* Recompensas en tiempo real */}
          {user && user.staked > 0n && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/8 p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] text-muted-foreground">Recompensas acumuladas</p>
                <p className="text-lg font-black text-amber-300 tabular-nums">
                  {fmt(rewardDisplay, 6)} <span className="text-xs font-normal">ACUA</span>
                </p>
                <p className="text-[9px] text-muted-foreground">↑ actualizando en tiempo real</p>
              </div>
              <div>
                {claimMsg && <Msg msg={claimMsg} onClear={() => setClaimMsg(null)} />}
                <button onClick={doClaim} disabled={lClaim || rewardDisplay === 0n}
                  className={cn('flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black border',
                    rewardDisplay > 0n
                      ? 'bg-amber-500/25 border-amber-500/50 text-amber-200 hover:bg-amber-500/35 active:scale-[.98]'
                      : 'bg-white/5 border-white/10 text-muted-foreground opacity-50 cursor-not-allowed')}>
                  {lClaim ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />}
                  Claim
                </button>
              </div>
            </div>
          )}
          {claimMsg && tab === 'stake' && user && user.staked === 0n && <Msg msg={claimMsg} onClear={() => setClaimMsg(null)} />}

          {/* Stake */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-fuchsia-300 flex items-center gap-1.5">
              <ArrowDownToLine className="w-3.5 h-3.5" /> Depositar ACUA
              <span className="ml-auto text-[10px] font-bold text-amber-400 flex items-center gap-0.5">
                <Percent className="w-3 h-3" /> {depFeePct} comisión
              </span>
            </p>
            {noRef && urlRef && (
              <p className="text-[10px] text-amber-400 bg-amber-500/10 rounded-xl px-3 py-1.5 border border-amber-500/20">
                🔗 Referido: {shortAddr(urlRef)} · se registrará al stakear
              </p>
            )}
            <div className="flex gap-2">
              <input value={stakeAmt} onChange={e => setStakeAmt(e.target.value)}
                placeholder="Cantidad ACUA"
                className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-fuchsia-500/50" />
              {user && user.tokenBalance > 0n && (
                <button onClick={() => setStakeAmt(ethers.formatUnits(user.tokenBalance, DECIMALS))}
                  className="shrink-0 px-2 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/30 text-[10px] font-bold text-fuchsia-400 hover:bg-fuchsia-500/25">
                  MAX
                </button>
              )}
            </div>
            {stakeGrossPreview > 0n && (
              <p className="text-[10px] text-muted-foreground px-1">
                Comisión: <span className="text-amber-400 font-bold">{fmt(stakeFeePreview, 4)} ACUA</span> · Neto stakeado: <span className="text-emerald-400 font-bold">{fmt(stakeNetPreview, 4)} ACUA</span>
              </p>
            )}
            <ActionBtn onClick={doStake} loading={lStake} disabled={!stakeAmt}
              label="Stakear" icon={<ArrowDownToLine className="w-4 h-4 shrink-0" />}
              color="bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300" />
            {stakeMsg && <Msg msg={stakeMsg} onClear={() => setStakeMsg(null)} />}
          </div>

          {/* Withdraw */}
          {user && user.staked > 0n && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <p className="text-xs font-bold text-red-300 flex items-center gap-1.5">
                <ArrowUpFromLine className="w-3.5 h-3.5" /> Retirar (instantáneo 24/7)
                <span className="ml-auto text-[10px] font-bold text-amber-400 flex items-center gap-0.5">
                  <Percent className="w-3 h-3" /> {wdFeePct} comisión
                </span>
              </p>
              <div className="flex gap-2">
                <input value={withdrawAmt} onChange={e => setWithdrawAmt(e.target.value)}
                  placeholder={`Máx: ${fmt(user.staked, 4)} ACUA`}
                  className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-red-500/50" />
                <button onClick={() => setWithdrawAmt(ethers.formatUnits(user.staked, DECIMALS))}
                  className="shrink-0 px-2 rounded-xl bg-red-500/15 border border-red-500/30 text-[10px] font-bold text-red-400 hover:bg-red-500/25">
                  TODO
                </button>
              </div>
              {withdrawGrossPreview > 0n && (
                <p className="text-[10px] text-muted-foreground px-1">
                  Comisión: <span className="text-amber-400 font-bold">{fmt(withdrawFeePreview, 4)} ACUA</span> · Recibes: <span className="text-emerald-400 font-bold">{fmt(withdrawNetPreview, 4)} ACUA</span>
                </p>
              )}
              <ActionBtn onClick={doWithdraw} loading={lWith} disabled={!user || user.staked === 0n}
                label="Retirar ahora" icon={<ArrowUpFromLine className="w-4 h-4 shrink-0" />}
                color="bg-red-500/15 border-red-500/30 text-red-300" />
              {withMsg && <Msg msg={withMsg} onClear={() => setWithMsg(null)} />}
            </div>
          )}
        </div>
      )}

      {/* ─── REFERIDOS TAB ─────────────────────────────────────────────── */}
      {tab === 'ref' && (
        <div className="space-y-3">
          {/* My referrer */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-400" />
              <p className="text-xs font-bold text-amber-300">Mi referido (invitador)</p>
            </div>
            {!noRef ? (
              <div className="rounded-xl bg-black/30 border border-white/10 p-2.5">
                <p className="text-[10px] text-muted-foreground">Referrer registrado</p>
                <p className="text-xs font-mono font-bold text-white">{shortAddr(user?.referrer ?? '')}</p>
                <p className="text-[9px] text-amber-400 mt-1">Recibes 5% bonus en cada claim</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">No tienes referido. Regístralo:</p>
                <div className="flex gap-2">
                  <input value={refInput} onChange={e => setRefInput(e.target.value)}
                    placeholder="0x… dirección del referrer"
                    className="flex-1 rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none focus:border-amber-500/50" />
                  <button onClick={() => doRegister(refInput || urlRef)} disabled={lReg || (!refInput && !urlRef)}
                    className={cn('shrink-0 px-3 rounded-xl bg-amber-500/20 border border-amber-500/30 text-xs font-bold text-amber-300',
                      (lReg || (!refInput && !urlRef)) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-500/30')}>
                    {lReg ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'OK'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {refMsg && <Msg msg={refMsg} onClear={() => setRefMsg(null)} />}

          {/* My referral earnings */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Gané como ref" value={user ? fmt(user.refEarnings, 4) + ' ACUA' : '—'} c="text-emerald-300" />
            <Stat label="Invité" value={user ? user.refCount.toString() + ' usuarios' : '—'} c="text-blue-300" />
          </div>

          {/* Share link */}
          {addr && (
            <ShareLink addr={addr} />
          )}

          {/* Referral structure */}
          <div className="rounded-2xl border border-white/10 bg-black/10 p-3 space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground">Distribución</p>
            <div className="space-y-0.5 text-[10px] text-muted-foreground">
              <p>• Depósito → <span className="text-white font-bold">{depFeePct} comisión</span></p>
              <p>• Retiro → <span className="text-white font-bold">{wdFeePct} comisión</span></p>
              <p>• Claim sin referido → 100% del gross</p>
              <p>• Claim con referido → neto 90% (85% + 5% bonus) · 5% referrer · 5% owner2</p>
            </div>
          </div>
        </div>
      )}

      {/* ─── ADMIN TAB ──────────────────────────────────────────────────── */}
      {tab === 'admin' && showAdmin && (
        <div className="space-y-4">
          {adminMsg && <Msg msg={adminMsg} onClear={() => setAdminMsg(null)} />}

          {/* Global stats */}
          <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-fuchsia-300 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> Estadísticas globales
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Total stakeado" value={global ? fmt(global.totalStaked, 2) + ' ACUA' : '—'} />
              <Stat label="Fund Pool" value={global ? fmt(global.fundPool, 2) + ' ACUA' : '—'} c="text-emerald-300" />
              <Stat label="APR actual" value={global ? formatAPR(global.aprBps) : '—'} c="text-amber-300" />
              <Stat label="Usuarios" value={global ? global.totalUsers.toString() : '—'} c="text-blue-300" />
              <Stat label="Total claimed" value={global ? fmt(global.totalClaimed, 2) : '—'} c="text-pink-300" />
              <Stat label="Total fondeado" value={global ? fmt(global.totalFunded, 2) : '—'} c="text-teal-300" />
              <Stat label="Comisión depósito" value={global ? formatFee(global.depositFeeBps) : '—'} c="text-amber-300" />
              <Stat label="Comisión retiro" value={global ? formatFee(global.withdrawFeeBps) : '—'} c="text-amber-300" />
              <Stat label="Total comisiones cobradas" value={global ? fmt(global.totalFeesPaid, 2) : '—'} c="text-red-300" />
            </div>
            <div className="rounded-xl bg-black/30 border border-white/10 p-2 space-y-0.5">
              <p className="text-[9px] font-mono text-muted-foreground truncate">Owner: {shortAddr(global?.owner ?? '')}</p>
              <p className="text-[9px] font-mono text-muted-foreground truncate">Owner2 (recibe comisiones): {shortAddr(global?.owner2 ?? '')}</p>
              <p className="text-[9px] font-mono text-muted-foreground truncate">Contrato: {STAKE_V5_ADDRESS.slice(0, 10)}…{STAKE_V5_ADDRESS.slice(-6)}</p>
            </div>
          </div>

          {/* Fund Permit2 */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <Fuel className="w-3.5 h-3.5" /> Fondear pool (Permit2 · World App)
            </p>
            <div className="flex gap-2">
              <input value={fundAmt} onChange={e => setFundAmt(e.target.value)}
                placeholder="Cantidad ACUA"
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={doFund} disabled={lFund || !fundAmt}
                className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-emerald-500/25 border-emerald-500/50 text-emerald-200',
                  (lFund || !fundAmt) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-emerald-500/35')}>
                {lFund ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Fondear'}
              </button>
            </div>
          </div>

          {/* Fund Direct */}
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
              <Fuel className="w-3.5 h-3.5" /> Fondear directo (approve ERC20)
            </p>
            <div className="flex gap-2">
              <input value={fundDirectAmt} onChange={e => setFundDirectAmt(e.target.value)}
                placeholder="Cantidad ACUA"
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={doFundDirect} disabled={lFundD || !fundDirectAmt || !importedSigner}
                className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-blue-500/25 border-blue-500/50 text-blue-200',
                  (lFundD || !fundDirectAmt || !importedSigner) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-blue-500/35')}>
                {lFundD ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Fondear'}
              </button>
            </div>
            {!importedSigner && <p className="text-[10px] text-muted-foreground">Requiere wallet importada</p>}
          </div>

          {/* Set APR */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-amber-300">Ajustar APR</p>
            <p className="text-[10px] text-muted-foreground">
              Actual: {global ? formatAPR(global.aprBps) : '—'} · Ingresa en bps (100bps = 1% · máx 100000bps = 1000%)
            </p>
            <div className="flex gap-2">
              <input value={aprInput} onChange={e => setAprInput(e.target.value)}
                placeholder="ej: 1200 = 12%"
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={doSetApr} disabled={lApr || !aprInput}
                className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-amber-500/25 border-amber-500/50 text-amber-200',
                  (lApr || !aprInput) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-500/35')}>
                {lApr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Actualizar'}
              </button>
            </div>
          </div>

          {/* Set Deposit Fee */}
          <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-fuchsia-300">Ajustar comisión de depósito</p>
            <p className="text-[10px] text-muted-foreground">
              Actual: {global ? formatFee(global.depositFeeBps) : '—'} · bps (500 = 5% · máx 2000 = 20%)
            </p>
            <div className="flex gap-2">
              <input value={depFeeInput} onChange={e => setDepFeeInput(e.target.value)}
                placeholder="ej: 500 = 5%"
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={doSetDepositFee} disabled={lDepFee || !depFeeInput}
                className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-fuchsia-500/25 border-fuchsia-500/50 text-fuchsia-200',
                  (lDepFee || !depFeeInput) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-fuchsia-500/35')}>
                {lDepFee ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Actualizar'}
              </button>
            </div>
          </div>

          {/* Set Withdraw Fee */}
          <div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-2">
            <p className="text-xs font-bold text-fuchsia-300">Ajustar comisión de retiro</p>
            <p className="text-[10px] text-muted-foreground">
              Actual: {global ? formatFee(global.withdrawFeeBps) : '—'} · bps (500 = 5% · máx 2000 = 20%)
            </p>
            <div className="flex gap-2">
              <input value={wdFeeInput} onChange={e => setWdFeeInput(e.target.value)}
                placeholder="ej: 500 = 5%"
                className="flex-1 rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-xs font-mono text-white placeholder-muted-foreground outline-none" />
              <button onClick={doSetWithdrawFee} disabled={lWdFee || !wdFeeInput}
                className={cn('shrink-0 px-3 rounded-xl text-xs font-black border bg-fuchsia-500/25 border-fuchsia-500/50 text-fuchsia-200',
                  (lWdFee || !wdFeeInput) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-fuchsia-500/35')}>
                {lWdFee ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Actualizar'}
              </button>
            </div>
          </div>

          {/* Pause / Unpause */}
          <div className="flex gap-2">
            <button onClick={() => doPause(true)} disabled={lPause || global?.paused}
              className={cn('flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black border',
                global?.paused ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/10 text-muted-foreground'
                  : 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30')}>
              {lPause ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {global?.paused ? 'Ya pausado' : 'Pausar contrato'}
            </button>
            <button onClick={() => doPause(false)} disabled={lPause || !global?.paused}
              className={cn('flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black border',
                !global?.paused ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/10 text-muted-foreground'
                  : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30')}>
              {global?.paused ? 'Reactivar' : 'Activo'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Share link helper ────────────────────────────────────────────────────────
function ShareLink({ addr }: { addr: string }) {
  const [cp, setCp] = useState(false)
  const link = `https://worldcoin.org/mini-app?app_id=app_60f2dc429532dcfa014c16d52ddc00fe&app_mode=mini-app&ref=${addr}`
  return (
    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-1">
      <p className="text-[10px] font-bold text-blue-300">Tu link de referido</p>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[9px] font-mono text-muted-foreground truncate">{link.slice(0, 60)}…</p>
        <button onClick={() => { navigator.clipboard.writeText(link); setCp(true); setTimeout(() => setCp(false), 2000) }}
          className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300">
          {cp ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {cp ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}
