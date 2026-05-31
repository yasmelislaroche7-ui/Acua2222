'use client'
import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { MiniKit } from '@worldcoin/minikit-js'
import {
  ArrowLeftRight, Droplets, TrendingUp, TrendingDown, Settings,
  Plus, Trash2, Pause, Play, RefreshCw, Download, Upload,
  AlertTriangle, ChevronDown, Loader2, CheckCircle2, XCircle,
  Shield, Repeat2, Coins, Lock,
} from 'lucide-react'
import {
  H2O_SWAP_V1, H2O_FUNDING_PROXY, H2O_OLD_TOKEN, H2O2_TOKEN, H2O_STAKE2_ADDR,
  TNT_DEPLOYED, TNT_OWNER2, TNT_DEFAULT_TOKENS,
  SWAP_ABI, SWAP_TX_ABI, PROXY_TX_ABI, ERC20_TNT_ABI,
  fetchAllPairs, PairInfo, formatH2OPrice, fmt18, randomNonce,
  getTokenLogo, displaySymbol,
} from '@/lib/tnt-contracts'

// ─── Types ────────────────────────────────────────────────────────────────────
type AdminTab = 'pares' | 'fondear-swap' | 'fondear-stake' | 'retirar'
type MainTab  = 'swap' | 'pool' | 'admin'
type SwapDir  = 'buy' | 'sell'
interface MsgState { ok: boolean; text: string }

// ─── Permit2 helper ───────────────────────────────────────────────────────────
function buildPermitArg(token: string, amount: bigint, spender: string) {
  const nonce    = randomNonce()
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
  return {
    permitArg: { permitted: { token, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
    permit2Entry: { spender, permitted: { token, amount: amount.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
  }
}

function parseMkErr(fp: any): string {
  if (fp?.error_code) return `MiniKit: ${fp.error_code}`
  return fp?.message ?? fp?.description ?? 'Error desconocido'
}

// ─── Animated H₂O logo ────────────────────────────────────────────────────────
function H2OAnimatedLogo({ size = 28 }: { size?: number }) {
  const id = 'h2og' + size
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <defs>
        <radialGradient id={id} cx="38%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#93c5fd" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </radialGradient>
        <style>{`
          @keyframes h2o-float-${size}{0%,100%{transform:translateY(0px)}50%{transform:translateY(-2px)}}
          @keyframes h2o-ring-${size}{0%,100%{opacity:.35;transform:scale(1)}50%{opacity:.08;transform:scale(1.5)}}
          @keyframes h2o-ring2-${size}{0%,100%{opacity:.25;transform:scale(1)}50%{opacity:.06;transform:scale(1.35)}}
          .h2o-drop-${size}{animation:h2o-float-${size} 2.2s ease-in-out infinite;transform-origin:16px 18px;}
          .h2o-r1-${size}{animation:h2o-ring-${size} 2.2s ease-in-out infinite;transform-origin:16px 22px;}
          .h2o-r2-${size}{animation:h2o-ring2-${size} 2.2s ease-in-out infinite .4s;transform-origin:16px 22px;}
        `}</style>
      </defs>
      <ellipse className={`h2o-r1-${size}`} cx="16" cy="22" rx="10" ry="3.5" fill="#3b82f6" />
      <ellipse className={`h2o-r2-${size}`} cx="16" cy="22" rx="7" ry="2.5" fill="#60a5fa" />
      <g className={`h2o-drop-${size}`}>
        <path d="M16 4 C16 4 7 15.5 7 20.5 C7 25.2 11.1 29 16 29 C20.9 29 25 25.2 25 20.5 C25 15.5 16 4 16 4Z"
          fill={`url(#${id})`} />
        <path d="M12 20 Q13.5 16 16 14.5" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" strokeLinecap="round" />
        <text x="15.5" y="23.5" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="system-ui,Arial">₂</text>
      </g>
    </svg>
  )
}

// ─── Token logo pill ──────────────────────────────────────────────────────────
function TokenLogo({ address, symbol, size = 20 }: { address: string; symbol: string; size?: number }) {
  const isH2O2 = address.toLowerCase() === H2O2_TOKEN.toLowerCase()
  if (isH2O2) return <H2OAnimatedLogo size={size} />
  const url = getTokenLogo(address)
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={symbol} width={size} height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size, flexShrink: 0 }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}
      className="rounded-full bg-blue-500/30 border border-blue-500/40 flex items-center justify-center text-[8px] font-black text-blue-300">
      {symbol.slice(0, 2)}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Msg({ msg, onClear }: { msg: MsgState; onClear: () => void }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${msg.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
      {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
      <span className="flex-1">{msg.text}</span>
      <button onClick={onClear} className="shrink-0 opacity-50 hover:opacity-100 text-xs">✕</button>
    </div>
  )
}

function Btn({
  onClick, loading, disabled, label, icon, color = 'bg-blue-500/20 border-blue-500/40 text-blue-300',
}: {
  onClick: () => void; loading: boolean; disabled?: boolean; label: string
  icon?: React.ReactNode; color?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`w-full flex items-center justify-center gap-2 rounded-2xl border py-3 px-4 text-sm font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${color}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {label}
    </button>
  )
}

function Input({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label?: string
}) {
  return (
    <div className="space-y-1">
      {label && <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{label}</label>}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-blue-500/50 font-mono"
      />
    </div>
  )
}

function TokenSelect({ pairs, value, onChange }: {
  pairs: PairInfo[]; value: string; onChange: (addr: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = pairs.find(p => p.address === value)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm"
      >
        {selected && <TokenLogo address={selected.address} symbol={selected.symbol} size={20} />}
        <span className="font-bold text-foreground">{selected ? displaySymbol(selected.symbol) : 'Selecciona token'}</span>
        {selected?.paused && <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full border border-red-500/30">PAUSADO</span>}
        <ChevronDown className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-2xl border border-white/10 bg-[oklch(0.12_0.018_245)] shadow-2xl overflow-hidden">
          {pairs.map(p => (
            <button
              key={p.address}
              onClick={() => { onChange(p.address); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-white/5 transition-colors ${p.paused ? 'opacity-50' : ''}`}
            >
              <TokenLogo address={p.address} symbol={p.symbol} size={18} />
              <span className="font-bold">{displaySymbol(p.symbol)}</span>
              {p.paused && <span className="text-[9px] text-red-400">PAUSADO</span>}
              <span className="ml-auto text-xs text-muted-foreground font-mono">{formatH2OPrice(p.price, displaySymbol(p.symbol))}/H₂O</span>
            </button>
          ))}
          {pairs.length === 0 && <div className="px-3 py-4 text-xs text-muted-foreground text-center">Sin pares activos</div>}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function TnTPanel({
  userAddress,
  walletMode,
  importedSigner,
}: {
  userAddress?: string
  walletMode?: 'minikit' | 'imported' | null
  importedSigner?: ethers.Signer | null
}) {
  const [tab, setTab]       = useState<MainTab>('swap')
  const [adminTab, setATab] = useState<AdminTab>('pares')
  const [pairs, setPairs]   = useState<PairInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [globalPaused, setGlobalPaused] = useState(false)

  const addr  = userAddress ?? ''
  const isMK  = walletMode === 'minikit' && typeof window !== 'undefined' && !!(window as any).MiniKit && MiniKit.isInstalled()
  const isOwner2 = addr.toLowerCase() === TNT_OWNER2
  const isAdmin  = isOwner2  // extensible: add main owner check here

  // ─── Load pairs ────────────────────────────────────────────────────────────
  const loadPairs = useCallback(async () => {
    if (!TNT_DEPLOYED) return
    setLoading(true)
    try {
      const ps = await fetchAllPairs()
      setPairs(ps)
    } catch (e) { console.error('[TnT] loadPairs', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadPairs() }, [loadPairs])

  // ─── Swap state ────────────────────────────────────────────────────────────
  const [dir, setDir]       = useState<SwapDir>('buy')
  const [selToken, setSelToken] = useState('')
  const [amount, setAmount] = useState('')
  const [swapMsg, setSwapMsg]   = useState<MsgState | null>(null)
  const [lSwap, setLSwap]       = useState(false)
  const [quote, setQuote]       = useState<{ cost: bigint; fee: bigint; net: bigint } | null>(null)

  const activePairs = pairs.filter(p => !p.paused)
  const selectedPair = pairs.find(p => p.address === selToken)

  useEffect(() => {
    if (!selToken && activePairs.length > 0) setSelToken(activePairs[0].address)
  }, [activePairs]) // eslint-disable-line

  // Live quote
  useEffect(() => {
    if (!selectedPair || !amount || Number(amount) <= 0) { setQuote(null); return }
    try {
      const h2oWei = ethers.parseUnits(amount.replace(',', '.'), 18)
      if (dir === 'buy') {
        const tokenCost = h2oWei * selectedPair.price / BigInt(1e18)
        const fee       = tokenCost * selectedPair.feeBps / 10000n
        setQuote({ cost: tokenCost + fee, fee, net: h2oWei })
      } else {
        const tokenOut = h2oWei * selectedPair.price / BigInt(1e18)
        const fee      = tokenOut * selectedPair.feeBps / 10000n
        setQuote({ cost: h2oWei, fee, net: tokenOut - fee })
      }
    } catch { setQuote(null) }
  }, [amount, selToken, dir, selectedPair])

  // ─── Execute Swap ──────────────────────────────────────────────────────────
  const doSwap = async () => {
    if (!TNT_DEPLOYED) { setSwapMsg({ ok: false, text: '⚠ Contrato no desplegado aún' }); return }
    if (!addr) { setSwapMsg({ ok: false, text: 'Conecta tu wallet' }); return }
    if (!selectedPair) { setSwapMsg({ ok: false, text: 'Selecciona un token' }); return }
    if (!amount || Number(amount) <= 0) { setSwapMsg({ ok: false, text: 'Ingresa monto' }); return }
    if (selectedPair.paused) { setSwapMsg({ ok: false, text: 'Par pausado' }); return }

    setLSwap(true); setSwapMsg(null)
    try {
      const h2oWei = ethers.parseUnits(amount.replace(',', '.'), 18)

      if (dir === 'buy') {
        // User pays payToken, receives H2O
        const tokenCost = h2oWei * selectedPair.price / BigInt(1e18)
        const fee       = tokenCost * selectedPair.feeBps / 10000n
        const totalCost = tokenCost + fee
        const { permitArg, permit2Entry } = buildPermitArg(selToken, totalCost, H2O_SWAP_V1)

        if (isMK) {
          const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
            transaction: [{
              address: H2O_SWAP_V1,
              abi: SWAP_TX_ABI,
              functionName: 'buyH2OWithPermit2',
              args: [selToken, h2oWei.toString(), permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'],
            }],
            permit2: [permit2Entry],
          })
          if (finalPayload.status === 'success') {
            setSwapMsg({ ok: true, text: `✓ Compraste ${amount} H2O` }); loadPairs()
          } else setSwapMsg({ ok: false, text: parseMkErr(finalPayload) })
        } else {
          setSwapMsg({ ok: false, text: 'Swap requiere World App (Permit2)' })
        }
      } else {
        // User pays H2O, receives token
        const { permitArg, permit2Entry } = buildPermitArg(H2O_OLD_TOKEN, h2oWei, H2O_SWAP_V1)

        if (isMK) {
          const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
            transaction: [{
              address: H2O_SWAP_V1,
              abi: SWAP_TX_ABI,
              functionName: 'sellH2OWithPermit2',
              args: [selToken, h2oWei.toString(), permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'],
            }],
            permit2: [permit2Entry],
          })
          if (finalPayload.status === 'success') {
            setSwapMsg({ ok: true, text: `✓ Vendiste ${amount} H2O → ${selectedPair.symbol}` }); loadPairs()
          } else setSwapMsg({ ok: false, text: parseMkErr(finalPayload) })
        } else {
          setSwapMsg({ ok: false, text: 'Swap requiere World App (Permit2)' })
        }
      }
    } catch (e: any) { setSwapMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLSwap(false) }
  }

  // ─── Admin state ───────────────────────────────────────────────────────────
  // Fondear swap
  const [fundToken,  setFundToken]  = useState(H2O_OLD_TOKEN)
  const [fundAmt,    setFundAmt]    = useState('')
  const [fundMsg,    setFundMsg]    = useState<MsgState | null>(null)
  const [lFund,      setLFund]      = useState(false)

  // Fondear stake proxy
  const [stakeAmt,   setStakeAmt]   = useState('')
  const [stakeMsg,   setStakeMsg]   = useState<MsgState | null>(null)
  const [lStake,     setLStake]     = useState(false)

  // Retirar
  const [withToken,  setWithToken]  = useState(H2O_OLD_TOKEN)
  const [withAmt,    setWithAmt]    = useState('')
  const [withTo,     setWithTo]     = useState(addr)
  const [withMsg,    setWithMsg]    = useState<MsgState | null>(null)
  const [lWith,      setLWith]      = useState(false)

  // Agregar par
  const [newToken,   setNewToken]   = useState('')
  const [newPrice,   setNewPrice]   = useState('')
  const [newFee,     setNewFee]     = useState('200')
  const [newSymbol,  setNewSymbol]  = useState('')
  const [addMsg,     setAddMsg]     = useState<MsgState | null>(null)
  const [lAdd,       setLAdd]       = useState(false)

  // Edit pair
  const [editToken,  setEditToken]  = useState('')
  const [editPrice,  setEditPrice]  = useState('')
  const [editFee,    setEditFee]    = useState('')
  const [editMsg,    setEditMsg]    = useState<MsgState | null>(null)
  const [lEdit,      setLEdit]      = useState(false)
  const [lPause,     setLPause]     = useState(false)
  const [lGlob,      setLGlob]      = useState(false)

  useEffect(() => { setWithTo(addr) }, [addr])

  // ─── Admin: Fondear Swap (Permit2) ─────────────────────────────────────────
  const doFundSwap = async () => {
    if (!TNT_DEPLOYED) { setFundMsg({ ok: false, text: '⚠ Contrato no desplegado' }); return }
    if (!fundAmt || Number(fundAmt) <= 0) { setFundMsg({ ok: false, text: 'Ingresa monto' }); return }
    setLFund(true); setFundMsg(null)
    try {
      const amt = ethers.parseUnits(fundAmt.replace(',', '.'), 18)
      const { permitArg, permit2Entry } = buildPermitArg(fundToken, amt, H2O_SWAP_V1)
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_SWAP_V1,
            abi: SWAP_TX_ABI,
            functionName: 'fundWithPermit2',
            args: [fundToken, amt.toString(), permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'],
          }],
          permit2: [permit2Entry],
        })
        if (finalPayload.status === 'success') {
          setFundMsg({ ok: true, text: '✓ Pool fondeado exitosamente' }); loadPairs()
        } else setFundMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else setFundMsg({ ok: false, text: 'Requiere World App' })
    } catch (e: any) { setFundMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLFund(false) }
  }

  // ─── Admin: Fondear Stake via Proxy (Permit2) ─────────────────────────────
  const doFundStake = async () => {
    if (!TNT_DEPLOYED) { setStakeMsg({ ok: false, text: '⚠ Contrato no desplegado' }); return }
    if (!stakeAmt || Number(stakeAmt) <= 0) { setStakeMsg({ ok: false, text: 'Ingresa monto' }); return }
    setLStake(true); setStakeMsg(null)
    try {
      const amt = ethers.parseUnits(stakeAmt.replace(',', '.'), 18)
      const { permitArg, permit2Entry } = buildPermitArg(H2O2_TOKEN, amt, H2O_FUNDING_PROXY)
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_FUNDING_PROXY,
            abi: PROXY_TX_ABI,
            functionName: 'fund',
            args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0', amt.toString()],
          }],
          permit2: [permit2Entry],
        })
        if (finalPayload.status === 'success') {
          setStakeMsg({ ok: true, text: '✓ H₂O Stake fondeado exitosamente' })
        } else setStakeMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else setStakeMsg({ ok: false, text: 'Requiere World App' })
    } catch (e: any) { setStakeMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLStake(false) }
  }

  // ─── Admin: Retirar ────────────────────────────────────────────────────────
  const doWithdraw = async () => {
    if (!TNT_DEPLOYED) { setWithMsg({ ok: false, text: '⚠ Contrato no desplegado' }); return }
    if (!withAmt || Number(withAmt) <= 0) { setWithMsg({ ok: false, text: 'Ingresa monto' }); return }
    if (!ethers.isAddress(withTo)) { setWithMsg({ ok: false, text: 'Dirección destino inválida' }); return }
    setLWith(true); setWithMsg(null)
    try {
      const amt = ethers.parseUnits(withAmt.replace(',', '.'), 18)
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_SWAP_V1,
            abi: SWAP_TX_ABI,
            functionName: 'withdraw',
            args: [withToken, amt.toString(), withTo],
          }],
        })
        if (finalPayload.status === 'success') {
          setWithMsg({ ok: true, text: '✓ Retiro exitoso' }); loadPairs()
        } else setWithMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else setWithMsg({ ok: false, text: 'Requiere World App' })
    } catch (e: any) { setWithMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLWith(false) }
  }

  // ─── Admin: Agregar par ────────────────────────────────────────────────────
  const doAddPair = async () => {
    if (!TNT_DEPLOYED) { setAddMsg({ ok: false, text: '⚠ Contrato no desplegado' }); return }
    if (!ethers.isAddress(newToken)) { setAddMsg({ ok: false, text: 'Dirección inválida' }); return }
    if (!newPrice || Number(newPrice) <= 0) { setAddMsg({ ok: false, text: 'Precio inválido' }); return }
    if (!newFee || isNaN(Number(newFee)) || Number(newFee) < 0) { setAddMsg({ ok: false, text: 'Fee bps inválido (ej: 200)' }); return }
    if (!newSymbol.trim()) { setAddMsg({ ok: false, text: 'Ingresa símbolo' }); return }
    setLAdd(true); setAddMsg(null)
    try {
      const priceWei = ethers.parseUnits(newPrice.replace(',', '.'), 18)
      const feeBps   = Math.floor(Number(newFee)).toString()
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_SWAP_V1,
            abi: SWAP_TX_ABI,
            functionName: 'addPair',
            args: [newToken, priceWei.toString(), feeBps, newSymbol.trim().toUpperCase()],
          }],
        })
        if (finalPayload.status === 'success') {
          setAddMsg({ ok: true, text: `✓ Par ${newSymbol} agregado` })
          setNewToken(''); setNewPrice(''); setNewSymbol('')
          loadPairs()
        } else setAddMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else setAddMsg({ ok: false, text: 'Requiere World App' })
    } catch (e: any) { setAddMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLAdd(false) }
  }

  // ─── Admin: Editar precio ──────────────────────────────────────────────────
  // El contrato no tiene setPrice → usamos removePair + addPair en batch
  const doEditPrice = async () => {
    if (!TNT_DEPLOYED || !editToken) { setEditMsg({ ok: false, text: 'Selecciona un par' }); return }
    if (!editPrice || Number(editPrice) <= 0) { setEditMsg({ ok: false, text: 'Precio inválido' }); return }
    const currentPair = pairs.find(p => p.address === editToken)
    if (!currentPair) { setEditMsg({ ok: false, text: 'Par no encontrado' }); return }
    setLEdit(true); setEditMsg(null)
    try {
      const priceWei = ethers.parseUnits(editPrice.replace(',', '.'), 18)
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [
            {
              address: H2O_SWAP_V1, abi: SWAP_TX_ABI,
              functionName: 'removePair', args: [editToken],
            },
            {
              address: H2O_SWAP_V1, abi: SWAP_TX_ABI,
              functionName: 'addPair',
              args: [editToken, priceWei.toString(), currentPair.feeBps.toString(), currentPair.symbol],
            },
          ],
        })
        if (finalPayload.status === 'success') {
          setEditMsg({ ok: true, text: '✓ Precio actualizado' }); loadPairs()
        } else setEditMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else setEditMsg({ ok: false, text: 'Requiere World App' })
    } catch (e: any) { setEditMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLEdit(false) }
  }

  const doEditFee = async () => {
    if (!TNT_DEPLOYED || !editToken) { setEditMsg({ ok: false, text: 'Selecciona un par' }); return }
    if (!editFee || isNaN(Number(editFee)) || Number(editFee) < 0) { setEditMsg({ ok: false, text: 'Ingresa fee bps válido (ej: 200)' }); return }
    setLEdit(true); setEditMsg(null)
    try {
      const feeBps = Math.floor(Number(editFee)).toString()
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_SWAP_V1, abi: SWAP_TX_ABI,
            functionName: 'setFee', args: [editToken, feeBps],
          }],
        })
        if (finalPayload.status === 'success') {
          setEditMsg({ ok: true, text: '✓ Comisión actualizada' }); loadPairs()
        } else setEditMsg({ ok: false, text: parseMkErr(finalPayload) })
      } else setEditMsg({ ok: false, text: 'Requiere World App' })
    } catch (e: any) { setEditMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLEdit(false) }
  }

  // ─── Admin: Pausar par ─────────────────────────────────────────────────────
  const doPausePair = async (tkn: string, paused: boolean) => {
    if (!TNT_DEPLOYED) return
    setLPause(true); setEditMsg(null)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_SWAP_V1, abi: SWAP_TX_ABI,
            functionName: 'setPairPaused', args: [tkn, paused],
          }],
        })
        if (finalPayload.status === 'success') {
          setEditMsg({ ok: true, text: `✓ Par ${paused ? 'pausado' : 'activado'}` }); loadPairs()
        } else setEditMsg({ ok: false, text: parseMkErr(finalPayload) })
      }
    } catch (e: any) { setEditMsg({ ok: false, text: e?.message ?? 'Error' }) }
    finally { setLPause(false) }
  }

  // ─── Admin: Pausa global ──────────────────────────────────────────────────
  const doGlobalPause = async (paused: boolean) => {
    if (!TNT_DEPLOYED) return
    setLGlob(true)
    try {
      if (isMK) {
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: H2O_SWAP_V1, abi: SWAP_TX_ABI,
            functionName: 'setGlobalPause', args: [paused],
          }],
        })
        if (finalPayload.status === 'success') {
          setGlobalPaused(paused); loadPairs()
        }
      }
    } catch (e: any) { console.error(e) }
    finally { setLGlob(false) }
  }

  // ─── Not deployed banner ──────────────────────────────────────────────────
  const DeployBanner = () => (
    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 flex gap-3 items-start">
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-sm font-bold text-amber-300">Contratos no desplegados</p>
        <p className="text-xs text-amber-200/70">
          Deploy <code className="font-mono text-[10px]">H2OSwapV1.sol</code> y <code className="font-mono text-[10px]">H2OFundingProxy.sol</code> en World Chain,
          luego actualiza <code className="font-mono text-[10px]">lib/tnt-contracts.ts</code> con las direcciones y pon <code className="font-mono text-[10px]">TNT_DEPLOYED = true</code>.
        </p>
      </div>
    </div>
  )

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 px-1">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/30 to-violet-500/30 border border-blue-500/30 flex items-center justify-center overflow-hidden">
            <H2OAnimatedLogo size={28} />
          </div>
          <div>
            <h2 className="text-sm font-black text-foreground tracking-wide">T+T Exchange</h2>
            <p className="text-[10px] text-muted-foreground">H₂O · Token to Token</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {globalPaused && (
            <span className="text-[9px] bg-red-500/20 border border-red-500/30 text-red-400 px-2 py-0.5 rounded-full font-bold">⏸ GLOBAL PAUSE</span>
          )}
          <button onClick={loadPairs} disabled={loading} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex rounded-2xl bg-white/5 border border-white/10 p-1 gap-1">
        {([['swap', '💱 Swap'], ['pool', '🏊 Pool'], ...(isAdmin ? [['admin', '⚙️ Admin']] : [])] as [MainTab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${tab === t ? 'bg-blue-500/20 border border-blue-500/30 text-blue-300' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!TNT_DEPLOYED && <DeployBanner />}

      {/* ══ TAB: SWAP ══════════════════════════════════════════════════════ */}
      {tab === 'swap' && (
        <div className="space-y-3">

          {/* Direction toggle */}
          <div className="flex rounded-2xl bg-white/5 border border-white/10 p-1 gap-1">
            <button
              onClick={() => setDir('buy')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all ${dir === 'buy' ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <TrendingUp className="w-3.5 h-3.5" /> Comprar H₂O
            </button>
            <button
              onClick={() => setDir('sell')}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all ${dir === 'sell' ? 'bg-red-500/20 border border-red-500/30 text-red-300' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <TrendingDown className="w-3.5 h-3.5" /> Vender H₂O
            </button>
          </div>

          {/* Token selector */}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
              {dir === 'buy' ? 'Pagar con' : 'Recibir'}
            </label>
            <TokenSelect pairs={activePairs} value={selToken} onChange={setSelToken} />
          </div>

          {/* Amount input */}
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
              {dir === 'buy' ? 'H₂O a comprar' : 'H₂O a vender'}
            </label>
            <div className="relative">
              <input
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-3 text-lg font-black text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-blue-500/50 pr-16"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-blue-300">H₂O</span>
            </div>
          </div>

          {/* Quote card */}
          {quote && selectedPair && (
            <div className="rounded-2xl bg-blue-500/5 border border-blue-500/20 p-3 space-y-2">
              <div className="flex justify-between text-xs items-center">
                <span className="text-muted-foreground">{dir === 'buy' ? 'Pagas' : 'Recibes'}</span>
                <div className="flex items-center gap-1.5 font-black text-foreground">
                  <TokenLogo address={selectedPair.address} symbol={selectedPair.symbol} size={14} />
                  {dir === 'buy'
                    ? `${fmt18(quote.cost, selectedPair.decimals)} ${displaySymbol(selectedPair.symbol)}`
                    : `${fmt18(quote.net, selectedPair.decimals)} ${displaySymbol(selectedPair.symbol)}`}
                </div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Comisión ({Number(selectedPair.feeBps) / 100}%)</span>
                <span className="text-amber-400">{fmt18(quote.fee, selectedPair.decimals)} {displaySymbol(selectedPair.symbol)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Precio</span>
                <span className="text-muted-foreground font-mono">{formatH2OPrice(selectedPair.price, displaySymbol(selectedPair.symbol))}/H₂O</span>
              </div>
            </div>
          )}

          {swapMsg && <Msg msg={swapMsg} onClear={() => setSwapMsg(null)} />}

          <Btn
            onClick={doSwap}
            loading={lSwap}
            disabled={!addr || !selToken || !amount || (!!selectedPair?.paused) || globalPaused}
            label={dir === 'buy' ? `Comprar ${amount || '0'} H\u2082O` : `Vender ${amount || '0'} H\u2082O`}
            icon={<ArrowLeftRight className="w-4 h-4" />}
            color={dir === 'buy'
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : 'bg-red-500/20 border-red-500/40 text-red-300'}
          />

          {!addr && (
            <p className="text-xs text-center text-muted-foreground">Conecta tu wallet para hacer swap</p>
          )}
        </div>
      )}

      {/* ══ TAB: POOL ══════════════════════════════════════════════════════ */}
      {tab === 'pool' && (
        <div className="space-y-3">
          {!TNT_DEPLOYED ? (
            <p className="text-xs text-center text-muted-foreground py-8">Sin datos — contrato no desplegado</p>
          ) : pairs.length === 0 ? (
            <p className="text-xs text-center text-muted-foreground py-8">{loading ? 'Cargando…' : 'Sin pares configurados'}</p>
          ) : (
            <>
              {pairs.map(p => (
                <div key={p.address} className={`rounded-2xl border p-3 space-y-2 ${p.paused ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TokenLogo address={p.address} symbol={p.symbol} size={22} />
                      <div>
                        <span className="text-sm font-black text-foreground">{displaySymbol(p.symbol)}</span>
                        <span className="ml-1.5 text-[9px] font-mono text-muted-foreground">{p.address.slice(0, 8)}…</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {p.paused && <span className="text-[9px] bg-red-500/20 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded-full">PAUSA</span>}
                      <span className="text-[9px] bg-white/5 border border-white/10 text-muted-foreground px-1.5 py-0.5 rounded-full">
                        Fee {Number(p.feeBps) / 100}%
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-black/20 p-2 text-center">
                      <div className="font-black text-blue-300">{fmt18(p.h2oLiquidity)} H₂O</div>
                      <div className="text-[10px] text-muted-foreground">Liquidez H₂O</div>
                    </div>
                    <div className="rounded-xl bg-black/20 p-2 text-center">
                      <div className="font-black text-emerald-300">{fmt18(p.tokenLiquidity, p.decimals)} {displaySymbol(p.symbol)}</div>
                      <div className="text-[10px] text-muted-foreground">Liquidez token</div>
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Precio: 1 H₂O = {formatH2OPrice(p.price, displaySymbol(p.symbol))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ══ TAB: ADMIN ══════════════════════════════════════════════════════ */}
      {tab === 'admin' && (
        <div className="space-y-3">
          {!isAdmin ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Shield className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Solo para owner2</p>
            </div>
          ) : (
            <>
              {/* Pausa global */}
              <div className={`rounded-2xl border p-3 flex items-center justify-between ${globalPaused ? 'bg-red-500/10 border-red-500/30' : 'bg-white/5 border-white/10'}`}>
                <div className="flex items-center gap-2">
                  {globalPaused ? <Pause className="w-4 h-4 text-red-400" /> : <Play className="w-4 h-4 text-emerald-400" />}
                  <div>
                    <p className="text-xs font-bold text-foreground">Pausa Global</p>
                    <p className="text-[10px] text-muted-foreground">{globalPaused ? 'Todos los swaps suspendidos' : 'Exchange activo'}</p>
                  </div>
                </div>
                <Btn
                  onClick={() => doGlobalPause(!globalPaused)}
                  loading={lGlob}
                  label={globalPaused ? 'Reanudar' : 'Pausar todo'}
                  color={globalPaused
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 !w-auto !py-1.5 !px-3 !text-xs'
                    : 'bg-red-500/20 border-red-500/40 text-red-300 !w-auto !py-1.5 !px-3 !text-xs'}
                />
              </div>

              {/* Admin subtabs */}
              <div className="flex rounded-xl bg-white/5 border border-white/10 p-0.5 gap-0.5 text-[10px]">
                {([['pares', '🔄 Pares'], ['fondear-swap', '💧 Pool'], ['fondear-stake', '📦 Stake'], ['retirar', '📤 Retirar']] as [AdminTab, string][]).map(([t, l]) => (
                  <button
                    key={t}
                    onClick={() => setATab(t)}
                    className={`flex-1 rounded-lg py-2 font-bold transition-all ${adminTab === t ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {/* ── Gestión de pares ─────────────────────────────── */}
              {adminTab === 'pares' && (
                <div className="space-y-3">

                  {/* Agregar par */}
                  <div className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-foreground">Agregar par</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={newToken} onChange={setNewToken} placeholder="0x…" label="Dirección token" />
                      <Input value={newSymbol} onChange={setNewSymbol} placeholder="WLD" label="Símbolo" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={newPrice} onChange={setNewPrice} placeholder="0.0000001" label="Precio (token por H2O)" />
                      <Input value={newFee} onChange={setNewFee} placeholder="200" label="Fee bps (200=2%)" />
                    </div>
                    {/* Tokens rápidos */}
                    <div className="flex flex-wrap gap-1">
                      {TNT_DEFAULT_TOKENS.map(t => (
                        <button
                          key={t.address}
                          onClick={() => {
                            setNewToken(t.address)
                            setNewSymbol(t.symbol)
                            setNewPrice(ethers.formatUnits(t.defaultPrice, 18))
                            setNewFee(String(t.defaultFeeBps))
                          }}
                          className="text-[9px] bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg font-bold transition-colors"
                        >
                          {t.symbol}
                        </button>
                      ))}
                    </div>
                    {addMsg && <Msg msg={addMsg} onClear={() => setAddMsg(null)} />}
                    <Btn onClick={doAddPair} loading={lAdd} label="Agregar par" icon={<Plus className="w-4 h-4" />} color="bg-emerald-500/20 border-emerald-500/40 text-emerald-300" />
                  </div>

                  {/* Lista de pares existentes */}
                  {editMsg && <Msg msg={editMsg} onClear={() => setEditMsg(null)} />}
                  {pairs.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide px-1">Pares activos</p>
                      {pairs.map(p => (
                        <div key={p.address} className={`rounded-2xl border p-3 space-y-2.5 ${p.paused ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <TokenLogo address={p.address} symbol={p.symbol} size={20} />
                              <span className="text-sm font-black text-foreground">{displaySymbol(p.symbol)}</span>
                            </div>
                            <button
                              onClick={() => doPausePair(p.address, !p.paused)}
                              disabled={lPause}
                              className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors ${p.paused ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' : 'bg-red-500/20 border-red-500/30 text-red-300'}`}
                            >
                              {lPause ? <Loader2 className="w-3 h-3 animate-spin" /> : p.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                              {p.paused ? 'Activar' : 'Pausar'}
                            </button>
                          </div>

                          {/* Edit inline */}
                          {editToken === p.address ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <Input value={editPrice} onChange={setEditPrice} placeholder={ethers.formatUnits(p.price, 18)} label="Nuevo precio" />
                                <Input value={editFee} onChange={setEditFee} placeholder={String(p.feeBps)} label="Nuevo fee bps" />
                              </div>
                              <div className="flex gap-2">
                                <Btn onClick={doEditPrice} loading={lEdit} label="Actualizar precio" color="bg-blue-500/20 border-blue-500/40 text-blue-300" />
                                <Btn onClick={doEditFee} loading={lEdit} label="Actualizar fee" color="bg-violet-500/20 border-violet-500/40 text-violet-300" />
                              </div>
                              <button onClick={() => setEditToken('')} className="text-[10px] text-muted-foreground hover:text-foreground">✕ Cerrar</button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">1 H₂O = {formatH2OPrice(p.price, displaySymbol(p.symbol))} · Fee {Number(p.feeBps)/100}%</span>
                              <button
                                onClick={() => { setEditToken(p.address); setEditPrice(ethers.formatUnits(p.price, 18)); setEditFee(String(p.feeBps)) }}
                                className="flex items-center gap-1 text-[10px] bg-white/5 border border-white/10 text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg"
                              >
                                <Settings className="w-3 h-3" /> Editar
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Fondear pool swap ─────────────────────────── */}
              {adminTab === 'fondear-swap' && (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Upload className="w-4 h-4 text-blue-400" />
                    <div>
                      <p className="text-xs font-bold text-foreground">Fondear Pool de Swap</p>
                      <p className="text-[10px] text-muted-foreground">Deposita H2O u otros tokens via Permit2</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Token a depositar</label>
                    <select
                      value={fundToken}
                      onChange={e => setFundToken(e.target.value)}
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue-500/50"
                    >
                      <option value={H2O_OLD_TOKEN}>H2O (viejo)</option>
                      <option value={H2O2_TOKEN}>H2O 2.0</option>
                      {TNT_DEFAULT_TOKENS.map(t => (
                        <option key={t.address} value={t.address}>{t.symbol}</option>
                      ))}
                    </select>
                  </div>
                  <Input value={fundAmt} onChange={setFundAmt} placeholder="100.0" label="Monto" />
                  {fundMsg && <Msg msg={fundMsg} onClear={() => setFundMsg(null)} />}
                  <Btn onClick={doFundSwap} loading={lFund} label="Fondear pool (Permit2)" icon={<Upload className="w-4 h-4" />} color="bg-blue-500/20 border-blue-500/40 text-blue-300" />
                </div>
              )}

              {/* ── Fondear H2OStake2 ─────────────────────────── */}
              {adminTab === 'fondear-stake' && (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-violet-400" />
                    <div>
                      <p className="text-xs font-bold text-foreground">Fondear H₂O Stake</p>
                      <p className="text-[10px] text-muted-foreground">Deposita H₂O en el rewardPool via Proxy + Permit2</p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-2.5 space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Token</span>
                      <span className="font-mono text-violet-300">H2O 2.0</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Proxy</span>
                      <span className="font-mono text-muted-foreground">{H2O_FUNDING_PROXY.slice(0, 10)}…</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">Destino</span>
                      <span className="font-mono text-muted-foreground">{H2O_STAKE2_ADDR.slice(0, 10)}…</span>
                    </div>
                  </div>
                  <Input value={stakeAmt} onChange={setStakeAmt} placeholder="50.0" label="Monto H2O 2.0 a fondear" />
                  {stakeMsg && <Msg msg={stakeMsg} onClear={() => setStakeMsg(null)} />}
                  <Btn onClick={doFundStake} loading={lStake} label="Fondear H₂O Stake (Permit2)" icon={<Lock className="w-4 h-4" />} color="bg-violet-500/20 border-violet-500/40 text-violet-300" />
                </div>
              )}

              {/* ── Retirar ─────────────────────────────────────── */}
              {adminTab === 'retirar' && (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-amber-400" />
                    <div>
                      <p className="text-xs font-bold text-foreground">Retirar Fondos</p>
                      <p className="text-[10px] text-muted-foreground">Retira cualquier token del contrato swap</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Token a retirar</label>
                    <select
                      value={withToken}
                      onChange={e => setWithToken(e.target.value)}
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-foreground outline-none focus:border-blue-500/50"
                    >
                      <option value={H2O_OLD_TOKEN}>H2O (viejo)</option>
                      <option value={H2O2_TOKEN}>H2O 2.0</option>
                      {TNT_DEFAULT_TOKENS.map(t => (
                        <option key={t.address} value={t.address}>{t.symbol}</option>
                      ))}
                    </select>
                  </div>
                  <Input value={withAmt} onChange={setWithAmt} placeholder="100.0" label="Monto" />
                  <Input value={withTo} onChange={setWithTo} placeholder="0x…" label="Dirección destino" />
                  {withMsg && <Msg msg={withMsg} onClear={() => setWithMsg(null)} />}
                  <Btn
                    onClick={doWithdraw}
                    loading={lWith}
                    disabled={!ethers.isAddress(withTo)}
                    label="Retirar fondos"
                    icon={<Download className="w-4 h-4" />}
                    color="bg-amber-500/20 border-amber-500/40 text-amber-300"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
