'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  ArrowUpDown, RefreshCw, Plus, ChevronDown, Loader2, Search,
  X, Wallet, ChevronUp, AlertCircle, Repeat2, Clock,
  TrendingUp, Coins, Award, Check, Zap, ShieldAlert,
  Sparkles, ArrowRight, BarChart2, Gift,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TOKENS, getProvider, ERC20_ABI, formatToken,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Contracts ────────────────────────────────────────────────────────────────
const ACUA_SWAP_ROUTER    = '0xa45d469F28509aD5c6C6e99b14b2E65B6ab0E60A'
const ACUA_VOLUME_REWARDS = '0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48'
const PERMIT2_ADDRESS     = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const MAX_UINT256         = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const MAX_UINT160         = '1461501637330902918203684832716283019655932542975'

// ─── Constants ────────────────────────────────────────────────────────────────
const SLIPPAGE_BPS    = 500   // 5% slippage — quoteSingle is spot-price (no impact), needs buffer
const ACUA_FEE_BPS    = 210   // 2.1% total fee (2% swap + 0.1% H2O buyback)
const IMPACT_WARN_BPS = 300   // warn >3%
const IMPACT_MAX_BPS  = 1500  // block >15% (very high impact)
const QUOTE_TTL_MS    = 25000 // requote after 25 seconds

// ─── MiniKit error code → friendly Spanish message ────────────────────────────
const TX_ERROR_MESSAGES: Record<string, string> = {
  user_rejected:                   'Cancelaste la transacción.',
  simulation_failed:               'La simulación falló. Puede haber baja liquidez en este par. Intenta con un monto menor.',
  input_error:                     'Error en los datos de la transacción. Verifica los parámetros.',
  generic_error:                   'Error inesperado. Intenta de nuevo.',
  invalid_contract:                'Contrato no válido.',
  disallowed_operation:            'Operación no permitida.',
  malicious_operation:             'Operación bloqueada por seguridad.',
  daily_tx_limit_reached:          'Límite diario de transacciones de World App alcanzado.',
  validation_error:                'Error de validación en la transacción.',
  transaction_failed:              'La transacción fue rechazada en la cadena. Puede ser por slippage o liquidez insuficiente.',
  permitted_amount_exceeds_slippage: 'El monto supera el slippage permitido por Permit2.',
  permitted_amount_not_found:      'No se encontró el permiso de Permit2. Intenta de nuevo.',
  invalid_operation:               'Operación inválida.',
}

function parseMiniKitTxError(payload: any): string {
  if (!payload) return 'Sin respuesta de World App. Intenta de nuevo.'
  const code: string = payload.error_code ?? ''
  if (code && TX_ERROR_MESSAGES[code]) return TX_ERROR_MESSAGES[code]
  // details is Record<string,any> per MiniKit types — stringify safely
  const details = payload.details
  if (details && typeof details === 'object' && Object.keys(details).length > 0) {
    try { return JSON.stringify(details) } catch { /* skip */ }
  }
  if (typeof details === 'string' && details.length > 0) return details
  if (typeof payload.message === 'string' && payload.message.length > 0) return payload.message
  if (code) return `Error: ${code}`
  return 'Transacción no completada. Intenta de nuevo.'
}

// ─── Fee tiers (Uniswap V3 fee per 1,000,000) ────────────────────────────────
// 100=0.01%, 500=0.05%, 3000=0.30%, 10000=1.00%
const FEE_TIERS = [100, 500, 3000, 10000]

// ─── Token logos ─────────────────────────────────────────────────────────────
const TOKEN_LOGOS: Record<string, string> = {
  WLD:  'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
}

export interface TokenItem {
  symbol: string; name: string; address: string
  decimals: number; color: string; logoUri?: string; isCustom?: boolean
}

const DEFAULT_TOKENS: TokenItem[] = [
  { symbol: 'WLD',    name: 'Worldcoin',  address: TOKENS.WLD,    decimals: 18, color: '#3b82f6', logoUri: TOKEN_LOGOS.WLD  },
  { symbol: 'H2O',    name: 'H2O Token',  address: TOKENS.H2O,    decimals: 18, color: '#06b6d4' },
  { symbol: 'USDC',   name: 'USD Coin',   address: TOKENS.USDC,   decimals: 6,  color: '#2563eb', logoUri: TOKEN_LOGOS.USDC },
  { symbol: 'FIRE',   name: 'Fire Token', address: TOKENS.FIRE,   decimals: 18, color: '#f97316' },
  { symbol: 'wCOP',   name: 'wCOP',       address: TOKENS.wCOP,   decimals: 18, color: '#f59e0b' },
  { symbol: 'wARS',   name: 'wARS',       address: TOKENS.wARS,   decimals: 18, color: '#10b981' },
  { symbol: 'BTCH2O', name: 'BTC H2O',    address: TOKENS.BTCH2O, decimals: 18, color: '#f59e0b' },
  { symbol: 'AIR',    name: 'AIR Token',  address: TOKENS.AIR,    decimals: 18, color: '#8b5cf6' },
  { symbol: 'UTH2',   name: 'UTH2',       address: TOKENS.UTH2,   decimals: 18, color: '#a78bfa' },
]

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const APPROVE_ABI = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}]
const PERMIT2_APPROVE_ABI = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token', type: 'address' }, { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' },
  ],
  outputs: [],
}]
const SWAP_SINGLE_ABI = [{
  name: 'swapV3Single', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'fee', type: 'uint24' }, { name: 'amountIn', type: 'uint256' },
    { name: 'amountOutMin', type: 'uint256' }, { name: 'usdcEquivalent', type: 'uint256' },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]
const SWAP_MULTI_ABI = [{
  name: 'swapV3Multi', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn', type: 'address' }, { name: 'hopToken', type: 'address' },
    { name: 'tokenOut', type: 'address' }, { name: 'fee1', type: 'uint24' },
    { name: 'fee2', type: 'uint24' }, { name: 'amountIn', type: 'uint256' },
    { name: 'amountOutMin', type: 'uint256' }, { name: 'usdcEquivalent', type: 'uint256' },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]
const ROUTER_QUOTE_ABI = [
  'function quoteSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) view returns (uint256 amountOut, address poolAddr)',
]
const VOLUME_REWARDS_ABI = [
  'function pendingNow(address user) view returns (uint256 uth2Amount, uint256 userVolume, uint8[] tierStatus)',
  'function getPeriodInfo() view returns (uint256 monthId, uint256 periodStart, uint256 periodEnd, uint256 secondsLeft)',
  'function getAllTiers() view returns (uint256[] thresholds, uint256[] rewards)',
  'function claimRewards(uint256 monthId) nonpayable',
]
const CLAIM_ABI = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'monthId', type: 'uint256' }], outputs: [],
}]

// ─── Quote result ─────────────────────────────────────────────────────────────
interface QuoteResult {
  amountOut: bigint
  fee: number
  fee2?: number
  multi?: boolean
  hopToken?: string
  label: string
  timestamp: number
}

// ─── Price feed: CoinGecko + DexScreener combined ────────────────────────────
const CG_IDS: Record<string, string> = {
  [TOKENS.WLD.toLowerCase()]:  'worldcoin-wld',
  [TOKENS.USDC.toLowerCase()]: 'usd-coin',
}

async function fetchUsdPrices(addresses: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}

  // CoinGecko for known tokens (reliable, no API key needed for basic)
  const cgAddrs = addresses.filter(a => CG_IDS[a.toLowerCase()])
  if (cgAddrs.length > 0) {
    try {
      const ids = [...new Set(cgAddrs.map(a => CG_IDS[a.toLowerCase()]))]
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      const data = await res.json()
      for (const addr of cgAddrs) {
        const id = CG_IDS[addr.toLowerCase()]
        if (data[id]?.usd) prices[addr.toLowerCase()] = data[id].usd
      }
    } catch {}
  }

  // DexScreener for all tokens (covers custom/exotic pairs)
  try {
    const chunk = addresses.slice(0, 30).join(',')
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    if (Array.isArray(data.pairs)) {
      const best: Record<string, { price: number; liq: number }> = {}
      for (const pair of data.pairs) {
        const addr = pair.baseToken?.address?.toLowerCase()
        if (!addr || !pair.priceUsd) continue
        const p = parseFloat(pair.priceUsd)
        const liq = parseFloat(pair.liquidity?.usd ?? '0')
        if (!best[addr] || liq > best[addr].liq) best[addr] = { price: p, liq }
      }
      for (const [addr, v] of Object.entries(best)) {
        // Only override CoinGecko if CoinGecko didn't return a price
        if (!prices[addr]) prices[addr] = v.price
      }
    }
  } catch {}

  return prices
}

// ─── Best route with low-fee priority + multi-hop ─────────────────────────────
async function getBestRouteQuote(
  tokenIn: string, tokenOut: string, netAmountIn: bigint
): Promise<QuoteResult | null> {
  const p = getProvider()
  const router = new ethers.Contract(ACUA_SWAP_ROUTER, ROUTER_QUOTE_ABI, p)
  const results: { amountOut: bigint; fee: number; fee2?: number; hopToken?: string; label: string }[] = []

  // Single-hop: all tiers in parallel
  await Promise.all(FEE_TIERS.map(async fee => {
    try {
      const [out] = await router.quoteSingle(tokenIn, tokenOut, fee, netAmountIn)
      const amountOut = BigInt(out.toString())
      if (amountOut > 0n) {
        results.push({ amountOut, fee, label: `Directo ${(fee / 10000).toFixed(fee < 1000 ? 2 : 2)}%` })
      }
    } catch {}
  }))

  // Multi-hop via WLD and USDC (skip if one of them is the in/out token)
  const wld  = TOKENS.WLD.toLowerCase()
  const usdc = TOKENS.USDC.toLowerCase()
  const inL  = tokenIn.toLowerCase()
  const outL = tokenOut.toLowerCase()

  const hops: string[] = []
  if (inL !== wld  && outL !== wld)  hops.push(TOKENS.WLD)
  if (inL !== usdc && outL !== usdc) hops.push(TOKENS.USDC)

  await Promise.all(hops.flatMap(hop =>
    [500, 3000].flatMap(f1 =>
      [500, 3000].map(async f2 => {
        try {
          const [mid] = await router.quoteSingle(tokenIn, hop, f1, netAmountIn)
          const midAmt = BigInt(mid.toString())
          if (midAmt === 0n) return
          const [out2] = await router.quoteSingle(hop, tokenOut, f2, midAmt)
          const amountOut = BigInt(out2.toString())
          if (amountOut > 0n) {
            const hopSym = hop.toLowerCase() === wld ? 'WLD' : 'USDC'
            results.push({
              amountOut, fee: f1, fee2: f2, hopToken: hop,
              label: `Via ${hopSym} (${(f1/10000).toFixed(2)}+${(f2/10000).toFixed(2)}%)`,
            })
          }
        } catch {}
      })
    )
  ))

  if (results.length === 0) return null

  // Sort: highest output first; tie-break by lowest combined fee
  results.sort((a, b) => {
    if (a.amountOut !== b.amountOut) return a.amountOut > b.amountOut ? -1 : 1
    const fA = a.fee + (a.fee2 ?? 0)
    const fB = b.fee + (b.fee2 ?? 0)
    return fA - fB
  })

  const best = results[0]
  return {
    amountOut: best.amountOut,
    fee: best.fee,
    fee2: best.fee2,
    hopToken: best.hopToken,
    multi: !!best.hopToken,
    label: best.label,
    timestamp: Date.now(),
  }
}

// ─── Price impact ─────────────────────────────────────────────────────────────
function calcImpactBps(
  amtIn: bigint, decIn: number, priceIn: number,
  amtOut: bigint, decOut: number, priceOut: number,
): number | null {
  if (!priceIn || !priceOut) return null
  const valIn  = parseFloat(ethers.formatUnits(amtIn, decIn)) * priceIn
  const valOut = parseFloat(ethers.formatUnits(amtOut, decOut)) * priceOut
  if (valIn === 0) return null
  return Math.round(((valIn - valOut) / valIn) * 10000)
}

// ─── Token Logo ───────────────────────────────────────────────────────────────
function TokenLogo({ token, size = 'md' }: { token: TokenItem; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const [err, setErr] = useState(false)
  const sz  = { xs: 'w-5 h-5', sm: 'w-7 h-7', md: 'w-8 h-8', lg: 'w-10 h-10' }[size]
  const txt = { xs: 'text-[8px]', sm: 'text-[9px]', md: 'text-[10px]', lg: 'text-xs' }[size]
  if (token.logoUri && !err) {
    return <img src={token.logoUri} alt={token.symbol} onError={() => setErr(true)}
      className={cn(sz, 'rounded-full object-cover shrink-0')} />
  }
  return (
    <div className={cn(sz, 'rounded-full flex items-center justify-center font-bold shrink-0', txt)}
      style={{ background: token.color + '25', color: token.color, border: `1px solid ${token.color}40` }}>
      {token.symbol.slice(0, 4)}
    </div>
  )
}

// ─── Token Picker ─────────────────────────────────────────────────────────────
function TokenPicker({ tokens, onSelect, onClose, exclude }: {
  tokens: TokenItem[]; onSelect: (t: TokenItem) => void; onClose: () => void; exclude?: string
}) {
  const [q, setQ] = useState('')
  const filtered = tokens.filter(t =>
    t.address.toLowerCase() !== exclude?.toLowerCase() &&
    (t.symbol.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()))
  )
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center p-4">
      <div className="w-full max-w-sm bg-[#0d1117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <span className="text-sm font-bold text-white">Seleccionar token</span>
          <button onClick={onClose} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
            <Search className="w-3.5 h-3.5 text-white/30 shrink-0" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar token..."
              className="flex-1 bg-transparent text-sm outline-none text-white placeholder:text-white/30" />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
          {filtered.map(t => (
            <button key={t.address} onClick={() => { onSelect(t); onClose() }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
              <TokenLogo token={t} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{t.symbol}</p>
                <p className="text-xs text-white/40">{t.name}</p>
              </div>
              {t.isCustom && <span className="text-[9px] text-white/30 border border-white/10 rounded px-1">custom</span>}
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-white/30 text-center py-6">Sin resultados</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function Countdown({ secondsLeft }: { secondsLeft: number }) {
  const [s, setSecs] = useState(secondsLeft)
  useEffect(() => {
    setSecs(secondsLeft)
    const id = setInterval(() => setSecs(v => Math.max(0, v - 1)), 1000)
    return () => clearInterval(id)
  }, [secondsLeft])
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60), sec = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="font-mono text-xs text-cyan-300 flex items-center gap-1">
      <Clock className="w-3 h-3" />
      {d > 0 && `${d}d `}{p(h)}:{p(m)}:{p(sec)}
    </span>
  )
}

// ─── Tier Row ─────────────────────────────────────────────────────────────────
function TierRow({ threshold, reward, status, index }: {
  threshold: bigint; reward: bigint; status: number; index: number
}) {
  const usd = Number(threshold) / 1_000_000
  const uth2 = parseFloat(ethers.formatEther(reward))
  const icons = ['🌊','💧','🌀','⚡','🔥','💎','🌌','🏆']
  return (
    <div className={cn('flex items-center gap-2 p-2 rounded-lg text-xs transition-all',
      status === 2 ? 'bg-green-500/10 border border-green-500/20 opacity-60'
        : status === 1 ? 'bg-cyan-500/10 border border-cyan-500/25'
        : 'bg-white/3 border border-white/5'
    )}>
      <span className="shrink-0">{icons[index] ?? '•'}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white/80">Tier {index + 1} — ${usd >= 1000 ? `${(usd/1000).toFixed(0)}k` : usd.toFixed(0)}</p>
        <p className="text-white/40">{uth2.toFixed(4)} UTH2</p>
      </div>
      {status === 2 && <Check className="w-3.5 h-3.5 text-green-400" />}
      {status === 1 && <Award className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />}
    </div>
  )
}

// ─── LS helpers ───────────────────────────────────────────────────────────────
const LS_CUSTOMS = 'acua_swap_customTokens'
function lsGet(k: string, fb: string) { try { return localStorage.getItem(k) || fb } catch { return fb } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v) } catch {} }

// ─── Impact color ─────────────────────────────────────────────────────────────
function impactColor(bps: number | null) {
  if (bps === null) return 'text-white/50'
  if (bps > IMPACT_MAX_BPS) return 'text-red-400'
  if (bps > IMPACT_WARN_BPS) return 'text-yellow-400'
  return 'text-green-400'
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── SwapPanel ────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
export function SwapPanel({ userAddress }: { userAddress: string; isAdmin?: boolean }) {
  const [customTokens, setCustomTokens] = useState<TokenItem[]>(() => {
    try { return JSON.parse(lsGet(LS_CUSTOMS, '[]')) } catch { return [] }
  })
  const allTokens = [...DEFAULT_TOKENS, ...customTokens]

  const [view,       setView]       = useState<'wallet' | 'swap'>('swap')
  const [balances,   setBalances]   = useState<Record<string, bigint>>({})
  const [prices,     setPrices]     = useState<Record<string, number>>({})
  const [loadingBal, setLoadingBal] = useState(false)
  const [lastPriceUpdate, setLastPriceUpdate] = useState(0)

  const [fromToken, setFromToken] = useState<TokenItem>(DEFAULT_TOKENS[0])
  const [toToken,   setToToken]   = useState<TokenItem>(DEFAULT_TOKENS[1])
  const [fromAmt,   setFromAmt]   = useState('')
  const [quote,     setQuote]     = useState<QuoteResult | null>(null)
  const [quoting,   setQuoting]   = useState(false)
  const [swapping,  setSwapping]  = useState(false)
  const [swapStep,  setSwapStep]  = useState<string>('')
  const [swapMsg,   setSwapMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null)
  const [impact,    setImpact]    = useState<number | null>(null)

  const [addAddr,    setAddAddr]    = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMsg,     setAddMsg]     = useState('')

  // Volume panel
  const [volOpen,    setVolOpen]    = useState(true)
  const [loadingVol, setLoadingVol] = useState(false)
  const [claimingVol, setClaimingVol] = useState(false)
  const [volMsg,     setVolMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [volData, setVolData] = useState<{
    uth2Amount: bigint; userVolume: bigint; tierStatus: number[]
    monthId: bigint; secondsLeft: number; thresholds: bigint[]; rewards: bigint[]
  } | null>(null)

  // ── Load balances + prices ──────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setLoadingBal(true)
    try {
      const p = getProvider()
      const addrs = allTokens.map(t => t.address)
      const settled = await Promise.allSettled(
        addrs.map(async addr => {
          const c = new ethers.Contract(addr, ERC20_ABI, p)
          return { addr, bal: BigInt((await c.balanceOf(userAddress)).toString()) }
        })
      )
      const bals: Record<string, bigint> = {}
      settled.forEach(r => { if (r.status === 'fulfilled') bals[r.value.addr.toLowerCase()] = r.value.bal })
      setBalances(bals)
      const usd = await fetchUsdPrices(addrs)
      setPrices(usd)
      setLastPriceUpdate(Date.now())
    } catch (e) { console.error('[Swap] loadBalances', e) }
    finally { setLoadingBal(false) }
  }, [userAddress, allTokens.length]) // eslint-disable-line

  useEffect(() => { loadBalances() }, [loadBalances])

  // Auto-refresh prices every 30s
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const addrs = allTokens.map(t => t.address)
        const usd = await fetchUsdPrices(addrs)
        if (Object.keys(usd).length > 0) { setPrices(usd); setLastPriceUpdate(Date.now()) }
      } catch {}
    }, 30_000)
    return () => clearInterval(id)
  }, [allTokens.length]) // eslint-disable-line

  // ── Quote ───────────────────────────────────────────────────────────────────
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runQuote = useCallback(async (fTok: TokenItem, tTok: TokenItem, amt: string) => {
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) { setQuote(null); setImpact(null); return }
    setQuoting(true)
    try {
      const rawAmt = ethers.parseUnits(amt, fTok.decimals)
      const netAmt = rawAmt - rawAmt * BigInt(ACUA_FEE_BPS) / 10000n
      const result = await getBestRouteQuote(fTok.address, tTok.address, netAmt)
      setQuote(result)
      if (result) {
        const imp = calcImpactBps(
          rawAmt, fTok.decimals, prices[fTok.address.toLowerCase()] ?? 0,
          result.amountOut, tTok.decimals, prices[tTok.address.toLowerCase()] ?? 0,
        )
        setImpact(imp)
      } else { setImpact(null) }
    } catch (e) { console.error('[Swap] quote', e); setQuote(null); setImpact(null) }
    finally { setQuoting(false) }
  }, [prices]) // eslint-disable-line

  useEffect(() => {
    setQuote(null); setSwapMsg(null); setImpact(null)
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(() => runQuote(fromToken, toToken, fromAmt), 500)
  }, [fromAmt, fromToken, toToken]) // eslint-disable-line

  // ── Load volume ──────────────────────────────────────────────────────────────
  const loadVolume = useCallback(async () => {
    setLoadingVol(true)
    try {
      const p = getProvider()
      const vc = new ethers.Contract(ACUA_VOLUME_REWARDS, VOLUME_REWARDS_ABI, p)
      const [[uth2, vol, tiers], [monthId,,, secsLeft], [ths, rws]] = await Promise.all([
        vc.pendingNow(userAddress), vc.getPeriodInfo(), vc.getAllTiers(),
      ])
      setVolData({
        uth2Amount: BigInt(uth2.toString()), userVolume: BigInt(vol.toString()),
        tierStatus: Array.from(tiers).map((v: any) => Number(v)),
        monthId: BigInt(monthId.toString()), secondsLeft: Number(secsLeft.toString()),
        thresholds: Array.from(ths).map((v: any) => BigInt(v.toString())),
        rewards: Array.from(rws).map((v: any) => BigInt(v.toString())),
      })
    } catch (e) { console.error('[Vol]', e) }
    finally { setLoadingVol(false) }
  }, [userAddress]) // eslint-disable-line

  useEffect(() => { loadVolume() }, [loadVolume])

  // ── Claim volume ─────────────────────────────────────────────────────────────
  const doClaimVolume = useCallback(async () => {
    if (!volData || volData.uth2Amount === 0n) return
    if (!MiniKit.isInstalled()) {
      setVolMsg({ ok: false, text: 'World App no está disponible.' }); return
    }
    setClaimingVol(true); setVolMsg(null)
    try {
      const res = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_VOLUME_REWARDS, abi: CLAIM_ABI,
          functionName: 'claimRewards', args: [volData.monthId.toString()] }]
      })
      const finalPayload = res?.finalPayload ?? null
      if (!finalPayload) {
        setVolMsg({ ok: false, text: 'Sin respuesta de World App. Intenta de nuevo.' }); return
      }
      if (finalPayload.status === 'success') {
        setVolMsg({ ok: true, text: `✓ ${parseFloat(ethers.formatEther(volData.uth2Amount)).toFixed(4)} UTH2 reclamado!` })
        setTimeout(loadVolume, 2000)
      } else {
        setVolMsg({ ok: false, text: parseMiniKitTxError(finalPayload) })
      }
    } catch (e: any) {
      setVolMsg({ ok: false, text: e?.shortMessage ?? e?.reason ?? e?.message ?? 'Error inesperado' })
    } finally { setClaimingVol(false) }
  }, [volData, loadVolume])

  // ── Execute swap ─────────────────────────────────────────────────────────────
  const doSwap = useCallback(async () => {
    if (!fromAmt || !quote) return

    // ── Guard: MiniKit must be installed (inside World App) ───────────────────
    if (!MiniKit.isInstalled()) {
      setSwapMsg({ ok: false, text: 'Abre la app dentro de World App para hacer swaps.' })
      return
    }

    setSwapping(true); setSwapMsg(null); setSwapStep('')

    try {
      // ── Parse & validate input amount ─────────────────────────────────────
      let rawAmt: bigint
      try {
        rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals)
      } catch {
        setSwapMsg({ ok: false, text: 'Monto inválido.' }); return
      }
      if (rawAmt === 0n) {
        setSwapMsg({ ok: false, text: 'El monto debe ser mayor a cero.' }); return
      }

      // ── Balance check ──────────────────────────────────────────────────────
      const userBal = balances[fromToken.address.toLowerCase()] ?? 0n
      if (rawAmt > userBal) {
        setSwapMsg({ ok: false, text: `Saldo insuficiente de ${fromToken.symbol}.` }); return
      }

      // ── Requote if stale (>25s) ────────────────────────────────────────────
      setSwapStep('Verificando cotización...')
      let activeQuote = quote
      if (Date.now() - quote.timestamp > QUOTE_TTL_MS) {
        const net = rawAmt - rawAmt * BigInt(ACUA_FEE_BPS) / 10000n
        const fresh = await getBestRouteQuote(fromToken.address, toToken.address, net)
        if (fresh) {
          activeQuote = fresh
        } else {
          setSwapMsg({ ok: false, text: 'Sin liquidez disponible para este par. Intenta con otro.' }); return
        }
      }

      // ── minOut: 5% slippage on quoted spot price to absorb price impact ────
      const minOut = activeQuote.amountOut * BigInt(10000 - SLIPPAGE_BPS) / 10000n

      // ── USDC equivalent for volume tracking (safe to be 0 if no price) ─────
      const priceUsd = prices[fromToken.address.toLowerCase()] ?? 0
      const floatAmt = parseFloat(ethers.formatUnits(rawAmt, fromToken.decimals))
      const usdcEquivNum = Math.floor(floatAmt * priceUsd * 1_000_000)
      const usdcEquiv = BigInt(isNaN(usdcEquivNum) || usdcEquivNum < 0 ? 0 : usdcEquivNum)

      // ── Permit2 AllowanceTransfer expiration (7 days from now) ────────────
      const expiration = (Math.floor(Date.now() / 1000) + 86400 * 7).toString()

      // ── Build atomic transaction batch ─────────────────────────────────────
      // [0] ERC20.approve(Permit2, MAX_UINT256)       — allow Permit2 to pull tokens
      // [1] Permit2.approve(token, Router, MAX, exp)  — allow Router via Permit2
      // [2] AcuaSwapRouter.swapV3Single/Multi(...)    — execute the swap
      const txs: any[] = [
        {
          address: fromToken.address,
          abi: APPROVE_ABI,
          functionName: 'approve',
          args: [PERMIT2_ADDRESS, MAX_UINT256],
        },
        {
          address: PERMIT2_ADDRESS,
          abi: PERMIT2_APPROVE_ABI,
          functionName: 'approve',
          args: [fromToken.address, ACUA_SWAP_ROUTER, MAX_UINT160, expiration],
        },
      ]

      if (activeQuote.multi && activeQuote.hopToken && activeQuote.fee2 !== undefined) {
        txs.push({
          address: ACUA_SWAP_ROUTER,
          abi: SWAP_MULTI_ABI,
          functionName: 'swapV3Multi',
          args: [
            fromToken.address,
            activeQuote.hopToken,
            toToken.address,
            activeQuote.fee.toString(),
            activeQuote.fee2.toString(),
            rawAmt.toString(),
            minOut.toString(),
            usdcEquiv.toString(),
          ],
        })
      } else {
        txs.push({
          address: ACUA_SWAP_ROUTER,
          abi: SWAP_SINGLE_ABI,
          functionName: 'swapV3Single',
          args: [
            fromToken.address,
            toToken.address,
            activeQuote.fee.toString(),
            rawAmt.toString(),
            minOut.toString(),
            usdcEquiv.toString(),
          ],
        })
      }

      // ── Send to World App ──────────────────────────────────────────────────
      setSwapStep('Esperando confirmación en World App...')

      let res: any
      try {
        res = await MiniKit.commandsAsync.sendTransaction({ transaction: txs })
      } catch (e: any) {
        const msg = e?.shortMessage ?? e?.reason ?? e?.message ?? 'Error al enviar la transacción.'
        setSwapMsg({ ok: false, text: msg }); return
      }

      const finalPayload = res?.finalPayload ?? null

      if (!finalPayload) {
        setSwapMsg({ ok: false, text: 'Sin respuesta de World App. Intenta de nuevo.' }); return
      }

      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        const shortId = txId ? ` · tx ${txId.slice(0, 10)}...` : ''
        setSwapMsg({ ok: true, text: `✓ Swap enviado${shortId}` })
        setFromAmt(''); setQuote(null); setImpact(null)
        setTimeout(() => { loadBalances(); loadVolume() }, 4000)
      } else {
        setSwapMsg({ ok: false, text: parseMiniKitTxError(finalPayload) })
      }
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.reason ?? e?.message ?? 'Error inesperado. Intenta de nuevo.'
      setSwapMsg({ ok: false, text: msg })
    } finally {
      setSwapping(false)
      setSwapStep('')
    }
  }, [fromAmt, quote, fromToken, toToken, prices, balances, loadBalances, loadVolume]) // eslint-disable-line

  // ── Add custom token ──────────────────────────────────────────────────────────
  const addToken = useCallback(async () => {
    const addr = addAddr.trim()
    if (!ethers.isAddress(addr)) return setAddMsg('Dirección inválida')
    if (allTokens.find(t => t.address.toLowerCase() === addr.toLowerCase())) return setAddMsg('Ya existe')
    setAddLoading(true); setAddMsg('')
    try {
      const p = getProvider()
      const c = new ethers.Contract(addr, ERC20_ABI, p)
      const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()])
      const tok: TokenItem = { symbol, name: symbol, address: addr, decimals: Number(decimals), color: '#94a3b8', isCustom: true }
      const updated = [...customTokens, tok]
      setCustomTokens(updated); lsSet(LS_CUSTOMS, JSON.stringify(updated))
      setAddAddr(''); setAddMsg(`${symbol} agregado`)
      setTimeout(() => setAddMsg(''), 3000)
    } catch { setAddMsg('No se pudo leer el token') }
    finally { setAddLoading(false) }
  }, [addAddr, customTokens, allTokens])

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const getBal = (t: TokenItem) => balances[t.address.toLowerCase()] ?? 0n
  const getUsd = (t: TokenItem, bal: bigint) => {
    const p = prices[t.address.toLowerCase()]
    if (!p) return null
    return (parseFloat(ethers.formatUnits(bal, t.decimals)) * p).toFixed(2)
  }
  const feeAmt = (() => {
    const n = parseFloat(fromAmt || '0')
    return isNaN(n) ? '0' : (n * ACUA_FEE_BPS / 10000).toFixed(6)
  })()
  const effectiveRate = quote && parseFloat(fromAmt) > 0
    ? (parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals)) / parseFloat(fromAmt)).toFixed(6)
    : null
  const quoteAge = quote ? Math.floor((Date.now() - quote.timestamp) / 1000) : 0
  const quoteStale = quoteAge > 20
  const impactBps = impact
  const isHighImpact = impactBps !== null && impactBps > IMPACT_MAX_BPS

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* ═══ VOLUME REWARDS — compact, top ════════════════════════════════════ */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0a2a2a 0%, #0d1a2a 100%)', border: '1px solid rgba(20,184,166,0.2)' }}>
        <button onClick={() => setVolOpen(v => !v)} className="w-full flex items-center justify-between px-3.5 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(20,184,166,0.15)' }}>
              <TrendingUp className="w-4 h-4 text-teal-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold text-teal-300">Rewards por Volumen</p>
                {volData && volData.uth2Amount > 0n && (
                  <span className="text-[9px] font-bold bg-green-500/20 text-green-300 border border-green-500/30 px-1.5 py-0.5 rounded-full animate-pulse">
                    ✦ RECLAMAR
                  </span>
                )}
              </div>
              {volData ? (
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-white/40">Vol: <span className="text-teal-300 font-mono">${(Number(volData.userVolume)/1_000_000).toFixed(2)}</span></span>
                  {volData.uth2Amount > 0n && (
                    <span className="text-[10px] text-white/40">UTH2: <span className="text-green-300 font-mono font-bold">{parseFloat(ethers.formatEther(volData.uth2Amount)).toFixed(4)}</span></span>
                  )}
                  <Countdown secondsLeft={volData.secondsLeft} />
                </div>
              ) : (
                <p className="text-[10px] text-white/30">Haz swap · Gana UTH2 cada mes</p>
              )}
            </div>
          </div>
          {volOpen ? <ChevronUp className="w-4 h-4 text-white/30 shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/30 shrink-0" />}
        </button>

        {volOpen && (
          <div className="px-3.5 pb-3.5 pt-0.5 border-t space-y-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {loadingVol ? (
              <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-teal-400" /></div>
            ) : volData ? (
              <>
                {/* Progress bar */}
                {volData.thresholds.length > 0 && (() => {
                  const volNum = Number(volData.userVolume)
                  const maxT = Number(volData.thresholds[volData.thresholds.length - 1])
                  const pct = Math.min(100, maxT > 0 ? (volNum / maxT) * 100 : 0)
                  let nextT: number | null = null
                  for (const t of volData.thresholds) { if (Number(t) > volNum) { nextT = Number(t); break } }
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-white/40">Progreso del mes</span>
                        {nextT !== null && <span className="text-white/40">${((nextT - volNum)/1_000_000).toFixed(2)} más</span>}
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #14b8a6, #22d3ee)' }} />
                      </div>
                    </div>
                  )
                })()}

                {/* Tiers compact */}
                <div className="grid grid-cols-2 gap-1.5">
                  {volData.thresholds.map((th, i) => (
                    <TierRow key={i} threshold={th} reward={volData.rewards[i] ?? 0n}
                      status={volData.tierStatus[i] ?? 0} index={i} />
                  ))}
                </div>

                {/* Claim */}
                {volData.uth2Amount > 0n ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.25)' }}>
                      <div>
                        <p className="text-[10px] text-white/40">UTH2 disponible</p>
                        <p className="text-base font-bold font-mono text-teal-300">{parseFloat(ethers.formatEther(volData.uth2Amount)).toFixed(4)} UTH2</p>
                      </div>
                      <Award className="w-6 h-6 text-teal-400" />
                    </div>
                    <Button onClick={doClaimVolume} disabled={claimingVol}
                      className="w-full h-9 text-xs font-semibold bg-teal-500/15 hover:bg-teal-500/25 text-teal-300 border border-teal-500/30">
                      {claimingVol ? <><Loader2 className="w-3 h-3 animate-spin mr-1.5" />Reclamando...</> : <><Gift className="w-3 h-3 mr-1.5" />Reclamar UTH2</>}
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-xl px-3 py-2.5 space-y-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <p className="text-[11px] font-semibold text-cyan-300">Haz Trade Swap Inteligente</p>
                    </div>
                    <p className="text-[10px] text-white/40 leading-relaxed">
                      Crea volumen haciendo swaps y reclama UTH2 todos los meses. Cuanto más tradeas, mayor es tu recompensa.
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <ArrowRight className="w-3 h-3 text-teal-400" />
                      <span className="text-[10px] text-teal-300 font-medium">
                        {Number(volData.userVolume) > 0 ? '✓ Todo reclamado este mes' : 'Empieza a hacer swaps →'}
                      </span>
                    </div>
                  </div>
                )}
                {volMsg && <p className={cn('text-[10px] text-center font-medium', volMsg.ok ? 'text-green-400' : 'text-red-400')}>{volMsg.text}</p>}
                <button onClick={loadVolume} className="w-full text-[10px] text-white/25 flex items-center justify-center gap-1 hover:text-white/50 py-0.5">
                  <RefreshCw className={cn('w-2.5 h-2.5', loadingVol && 'animate-spin')} /> Actualizar
                </button>
              </>
            ) : (
              <button onClick={loadVolume} className="w-full text-xs text-teal-400 hover:underline py-2 flex items-center justify-center gap-1">
                <RefreshCw className="w-3 h-3" /> Cargar datos
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══ SWAP CARD ════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(160deg, #0d1117 0%, #111827 100%)', border: '1px solid rgba(255,255,255,0.08)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.2)' }}>
              <Repeat2 className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div>
              <p className="text-xs font-bold text-white">Acua Swap</p>
              <p className="text-[10px] text-white/30">Uniswap V3 · World Chain · <span className="text-green-400">gas &lt;0.001 gwei</span></p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={loadBalances} disabled={loadingBal}
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/5 text-white/30 hover:text-white/70 transition-colors">
              <RefreshCw className={cn('w-3.5 h-3.5', loadingBal && 'animate-spin')} />
            </button>
            <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <button onClick={() => setView('wallet')}
                className={cn('px-2.5 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-1',
                  view === 'wallet' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70')}>
                <Wallet className="w-3 h-3" />Tokens
              </button>
              <button onClick={() => setView('swap')}
                className={cn('px-2.5 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-1',
                  view === 'swap' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70')}>
                <Repeat2 className="w-3 h-3" />Swap
              </button>
            </div>
          </div>
        </div>

        {/* Price update indicator */}
        {lastPriceUpdate > 0 && (
          <div className="flex items-center justify-between px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <span className="text-[10px] text-white/25 flex items-center gap-1">
              <BarChart2 className="w-2.5 h-2.5" /> Precios en tiempo real
            </span>
            <span className="text-[10px] text-green-400/60 font-mono">
              ● live · {Math.floor((Date.now() - lastPriceUpdate) / 1000)}s
            </span>
          </div>
        )}

        <div className="p-4">
          {/* ─── WALLET VIEW ─── */}
          {view === 'wallet' && (
            <div className="space-y-2">
              {Object.keys(prices).length > 0 && (() => {
                let total = 0
                allTokens.forEach(t => {
                  const p = prices[t.address.toLowerCase()]
                  if (!p) return
                  total += parseFloat(ethers.formatUnits(getBal(t), t.decimals)) * p
                })
                return total > 0 ? (
                  <div className="rounded-xl p-3 text-center mb-3" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest">Valor total</p>
                    <p className="text-2xl font-bold text-indigo-300 font-mono">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                ) : null
              })()}
              {loadingBal && !Object.keys(balances).length && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-indigo-400" /></div>}
              {allTokens.map(token => {
                const bal = getBal(token); const usd = getUsd(token, bal); const price = prices[token.address.toLowerCase()]
                return (
                  <button key={token.address}
                    onClick={() => { setFromToken(token); setView('swap') }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left hover:scale-[1.01]"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <TokenLogo token={token} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-white">{token.symbol}</span>
                        {token.isCustom && <span className="text-[9px] text-white/30 border border-white/10 rounded px-1">custom</span>}
                      </div>
                      <p className="text-xs text-white/30">{token.name}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-mono font-semibold text-white">{bal === 0n ? '0' : formatToken(bal, token.decimals, 4)}</p>
                      {price && <p className="text-[10px] text-white/30">${price < 0.01 ? price.toExponential(2) : price.toLocaleString('en-US', { maximumFractionDigits: 4 })}</p>}
                      {usd && parseFloat(usd) > 0 && <p className="text-[10px] text-green-400 font-mono">${usd}</p>}
                    </div>
                  </button>
                )
              })}
              {/* Add token */}
              <div className="rounded-xl p-3 space-y-2 mt-1" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-[10px] font-semibold text-white/30 flex items-center gap-1"><Plus className="w-2.5 h-2.5" /> Agregar token por dirección</p>
                <div className="flex gap-2">
                  <input value={addAddr} onChange={e => setAddAddr(e.target.value)} placeholder="0x..."
                    className="flex-1 min-w-0 text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder:text-white/20 outline-none focus:border-indigo-500/50 font-mono" />
                  <Button size="sm" className="text-xs h-8 shrink-0 bg-white/5 hover:bg-white/10 border-white/10" onClick={addToken} disabled={addLoading}>
                    {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  </Button>
                </div>
                {addMsg && <p className={cn('text-[10px]', addMsg.includes('agregado') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>}
              </div>
            </div>
          )}

          {/* ─── SWAP VIEW ─── */}
          {view === 'swap' && (
            <div className="space-y-2">
              {/* Fee bar */}
              <div className="flex items-center justify-between rounded-lg px-3 py-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-white/40 flex items-center gap-1">
                  <Coins className="w-3 h-3" /> Comisión: <strong className="text-white/60">2%</strong> + 0.1% H2O · Slippage: <strong className="text-white/60">{(SLIPPAGE_BPS / 100).toFixed(0)}%</strong>
                </span>
                {quote && (
                  <span className={cn('px-1.5 py-0.5 rounded font-mono font-bold text-[9px]',
                    quote.fee >= 10000 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-indigo-500/10 text-indigo-300')}>
                    {quote.label}
                  </span>
                )}
              </div>

              {/* FROM token */}
              <div className="rounded-2xl p-3.5 space-y-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/30 font-medium uppercase tracking-wider">De</span>
                  <button onClick={() => setFromAmt(ethers.formatUnits(getBal(fromToken), fromToken.decimals))}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-mono transition-colors">
                    Saldo: {formatToken(getBal(fromToken), fromToken.decimals, 4)}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setPickerFor('from')}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 transition-all hover:scale-105"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <TokenLogo token={fromToken} size="sm" />
                    <span className="text-sm font-bold text-white whitespace-nowrap">{fromToken.symbol}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                  </button>
                  <input type="number" min="0" step="any" value={fromAmt}
                    onChange={e => setFromAmt(e.target.value)} placeholder="0.0"
                    className="flex-1 min-w-0 bg-transparent text-right text-2xl font-bold font-mono text-white placeholder:text-white/15 outline-none" />
                </div>
                {fromAmt && parseFloat(fromAmt) > 0 && prices[fromToken.address.toLowerCase()] && (
                  <p className="text-[10px] text-white/30 text-right font-mono">
                    ≈ ${(parseFloat(fromAmt) * prices[fromToken.address.toLowerCase()]).toFixed(2)} USD
                  </p>
                )}
              </div>

              {/* Flip button */}
              <div className="flex justify-center -my-0.5">
                <button
                  onClick={() => { setFromToken(toToken); setToToken(fromToken); setFromAmt(''); setQuote(null); setImpact(null) }}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:rotate-180 hover:scale-110 duration-300"
                  style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}>
                  <ArrowUpDown className="w-4 h-4 text-indigo-400" />
                </button>
              </div>

              {/* TO token */}
              <div className="rounded-2xl p-3.5 space-y-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: quoting ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/30 font-medium uppercase tracking-wider">Para</span>
                  <span className="text-[10px] text-white/30 font-mono">Saldo: {formatToken(getBal(toToken), toToken.decimals, 4)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setPickerFor('to')}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 transition-all hover:scale-105"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <TokenLogo token={toToken} size="sm" />
                    <span className="text-sm font-bold text-white whitespace-nowrap">{toToken.symbol}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                  </button>
                  <div className="flex-1 text-right">
                    {quoting ? (
                      <div className="flex items-center justify-end gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                        <span className="text-sm text-white/30">Buscando...</span>
                      </div>
                    ) : quote ? (
                      <div>
                        <span className="text-2xl font-bold font-mono" style={{ color: '#4ade80' }}>
                          {formatToken(quote.amountOut, toToken.decimals, 6)}
                        </span>
                        {quoteStale && (
                          <span className="ml-1 text-[9px] text-yellow-400 animate-pulse">⟳</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-2xl font-bold font-mono text-white/10">0.0</span>
                    )}
                  </div>
                </div>
                {quote && prices[toToken.address.toLowerCase()] && (
                  <p className="text-[10px] text-white/30 text-right font-mono">
                    ≈ ${(parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals)) * prices[toToken.address.toLowerCase()]).toFixed(2)} USD
                  </p>
                )}
              </div>

              {/* Details card */}
              {fromAmt && parseFloat(fromAmt) > 0 && (
                <div className="rounded-xl px-3 py-2.5 space-y-1.5 text-[10px]" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex justify-between text-white/40">
                    <span>Comisión (2.1%)</span>
                    <span className="font-mono">{feeAmt} {fromToken.symbol}</span>
                  </div>
                  <div className="flex justify-between text-white/40">
                    <span className="flex items-center gap-1"><Zap className="w-2.5 h-2.5 text-yellow-400" /> Slippage máx</span>
                    <span className="font-mono text-yellow-400/70">{(SLIPPAGE_BPS / 100).toFixed(0)}%</span>
                  </div>
                  {impactBps !== null && (
                    <div className="flex justify-between">
                      <span className={cn('flex items-center gap-1', impactBps > IMPACT_WARN_BPS ? 'text-yellow-400' : 'text-white/40')}>
                        {impactBps > IMPACT_WARN_BPS && <ShieldAlert className="w-2.5 h-2.5" />} Impacto de precio
                      </span>
                      <span className={cn('font-mono font-bold', impactColor(impactBps))}>
                        {(impactBps / 100).toFixed(2)}%
                      </span>
                    </div>
                  )}
                  {quote && (
                    <div className="flex justify-between text-white/40">
                      <span>Mínimo a recibir</span>
                      <span className="font-mono text-white/60">
                        {formatToken(quote.amountOut * BigInt(10000 - SLIPPAGE_BPS) / 10000n, toToken.decimals, 4)} {toToken.symbol}
                      </span>
                    </div>
                  )}
                  {effectiveRate && (
                    <div className="flex justify-between text-white/30 pt-1 mt-0.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <span>Tasa efectiva</span>
                      <span className="font-mono text-white/50">1 {fromToken.symbol} = {effectiveRate} {toToken.symbol}</span>
                    </div>
                  )}
                </div>
              )}

              {/* High impact warning */}
              {impactBps !== null && impactBps > IMPACT_WARN_BPS && (
                <div className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5',
                  impactBps > IMPACT_MAX_BPS ? 'bg-red-500/10 border border-red-500/25' : 'bg-yellow-500/8 border border-yellow-500/20')}>
                  <ShieldAlert className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', impactBps > IMPACT_MAX_BPS ? 'text-red-400' : 'text-yellow-400')} />
                  <p className={cn('text-[11px]', impactBps > IMPACT_MAX_BPS ? 'text-red-300' : 'text-yellow-300')}>
                    {impactBps > IMPACT_MAX_BPS
                      ? `Impacto muy alto (${(impactBps/100).toFixed(1)}%). Reduce el monto para proteger tu inversión.`
                      : `Impacto elevado (${(impactBps/100).toFixed(1)}%). Considera reducir el monto.`}
                  </p>
                </div>
              )}

              {/* No route */}
              {fromAmt && parseFloat(fromAmt) > 0 && !quoting && !quote && (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 bg-yellow-500/8 border border-yellow-500/20">
                  <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                  <p className="text-[11px] text-yellow-300">Sin liquidez en Uniswap V3 para este par en World Chain</p>
                </div>
              )}

              {/* Swap button */}
              <button
                onClick={doSwap}
                disabled={swapping || !quote || !fromAmt || parseFloat(fromAmt) <= 0 || isHighImpact}
                className={cn(
                  'w-full h-12 rounded-xl text-sm font-bold transition-all duration-200',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  swapping ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.01] active:scale-[0.99]',
                  isHighImpact ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                    : 'text-white',
                )}
                style={isHighImpact ? {} : { background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', boxShadow: quote && !swapping ? '0 0 20px rgba(99,102,241,0.3)' : 'none' }}>
                {swapping
                  ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{swapStep || 'Procesando...'}</span>
                  : isHighImpact
                    ? <span className="flex items-center justify-center gap-2"><ShieldAlert className="w-4 h-4" /> Impacto muy alto</span>
                    : <span className="flex items-center justify-center gap-2"><Zap className="w-4 h-4" /> Swap</span>}
              </button>

              {swapMsg && (
                <div className={cn('rounded-xl px-3 py-2.5 text-xs',
                  swapMsg.ok
                    ? 'bg-green-500/10 border border-green-500/20'
                    : 'bg-red-500/10 border border-red-500/20')}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn('font-medium leading-snug', swapMsg.ok ? 'text-green-300' : 'text-red-300')}>
                      {swapMsg.text}
                    </p>
                    <button onClick={() => setSwapMsg(null)} className="shrink-0 opacity-40 hover:opacity-80 transition-opacity">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {swapMsg.ok && (
                    <p className="text-[10px] text-green-400/50 mt-1">Los saldos se actualizarán en breve.</p>
                  )}
                  {!swapMsg.ok && (
                    <p className="text-[10px] text-red-400/50 mt-1">Ajusta el monto o el par e intenta de nuevo.</p>
                  )}
                </div>
              )}

              {/* Add custom token */}
              <div className="rounded-xl p-3 space-y-2 mt-1" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-[10px] font-semibold text-white/25 flex items-center gap-1"><Plus className="w-2.5 h-2.5" /> Agregar token personalizado</p>
                <div className="flex gap-2">
                  <input value={addAddr} onChange={e => setAddAddr(e.target.value)} placeholder="0x..."
                    className="flex-1 min-w-0 text-xs bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-white placeholder:text-white/20 outline-none focus:border-indigo-500/40 font-mono" />
                  <Button size="sm" className="h-8 shrink-0 bg-white/5 hover:bg-white/10 border-white/10 text-white/60" onClick={addToken} disabled={addLoading}>
                    {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  </Button>
                </div>
                {addMsg && <p className={cn('text-[10px]', addMsg.includes('agregado') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Token picker */}
      {pickerFor && (
        <TokenPicker tokens={allTokens}
          onSelect={t => pickerFor === 'from' ? setFromToken(t) : setToToken(t)}
          onClose={() => setPickerFor(null)}
          exclude={pickerFor === 'from' ? toToken.address : fromToken.address} />
      )}
    </div>
  )
}
