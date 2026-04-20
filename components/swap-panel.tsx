'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  ArrowUpDown, RefreshCw, Plus, ChevronDown, Loader2, Search,
  X, Wallet, ChevronUp, AlertCircle, Repeat2, Clock,
  TrendingUp, Coins, Award, Check, Zap, ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TOKENS, getProvider, ERC20_ABI, shortenAddress, formatToken,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Deployed contract addresses ─────────────────────────────────────────────
const ACUA_SWAP_ROUTER    = '0xa45d469F28509aD5c6C6e99b14b2E65B6ab0E60A'
const ACUA_VOLUME_REWARDS = '0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48'
const PERMIT2_ADDRESS     = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const MAX_UINT256         = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const MAX_UINT160         = '1461501637330902918203684832716283019655932542975'

// ─── Fee & slippage constants ─────────────────────────────────────────────────
const SLIPPAGE_BPS       = 100   // 1% max slippage tolerance
const ACUA_FEE_BPS       = 210   // 2.1% total (2% swap + 0.1% H2O)
const MAX_IMPACT_WARN    = 300   // warn if price impact > 3%
const MAX_IMPACT_BLOCK   = 1000  // block swap if price impact > 10%

// ─── Fee tiers ordered by preference (lower fee = better for user when liquidity equal) ──
// In Uniswap V3: fee is per million. 500=0.05%, 3000=0.30%, 10000=1.00%
// We try all, pick best amountOut, but warn if >0.30%
const FEE_TIERS_ORDERED = [100, 500, 3000, 10000]
const FEE_WARN_THRESHOLD = 10000  // warn only at 1% pool fee

// ─── Token logos ─────────────────────────────────────────────────────────────
const TOKEN_LOGOS: Record<string, string> = {
  WLD:  'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
}

// ─── Token types ─────────────────────────────────────────────────────────────
export interface TokenItem {
  symbol: string
  name: string
  address: string
  decimals: number
  color: string
  logoUri?: string
  isCustom?: boolean
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
    { name: 'token',      type: 'address' },
    { name: 'spender',    type: 'address' },
    { name: 'amount',     type: 'uint160' },
    { name: 'expiration', type: 'uint48'  },
  ],
  outputs: [],
}]

const ACUA_SWAP_V3_SINGLE_ABI = [{
  name: 'swapV3Single', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn',        type: 'address' },
    { name: 'tokenOut',       type: 'address' },
    { name: 'fee',            type: 'uint24'  },
    { name: 'amountIn',       type: 'uint256' },
    { name: 'amountOutMin',   type: 'uint256' },
    { name: 'usdcEquivalent', type: 'uint256' },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]

const ACUA_SWAP_V3_MULTI_ABI = [{
  name: 'swapV3Multi', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn',        type: 'address' },
    { name: 'hopToken',       type: 'address' },
    { name: 'tokenOut',       type: 'address' },
    { name: 'fee1',           type: 'uint24'  },
    { name: 'fee2',           type: 'uint24'  },
    { name: 'amountIn',       type: 'uint256' },
    { name: 'amountOutMin',   type: 'uint256' },
    { name: 'usdcEquivalent', type: 'uint256' },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]

const ACUA_ROUTER_VIEW_ABI = [
  'function quoteSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) view returns (uint256 amountOut, address poolAddr)',
  'function getPoolAddress(address tokenA, address tokenB, uint24 fee) pure returns (address)',
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
  multi?: boolean
  hopToken?: string
  fee2?: number
  label: string
  priceImpactBps?: number   // estimated price impact in bps
}

// ─── Fetch USD prices ─────────────────────────────────────────────────────────
async function fetchUsdPrices(addresses: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  try {
    const chunk = addresses.slice(0, 30).join(',')
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`)
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
      for (const [addr, v] of Object.entries(best)) prices[addr] = v.price
    }
  } catch {}
  return prices
}

// ─── Token meta from on-chain ─────────────────────────────────────────────────
async function fetchTokenMeta(address: string): Promise<{ symbol: string; name: string; decimals: number } | null> {
  try {
    const p = getProvider()
    const c = new ethers.Contract(address, ERC20_ABI, p)
    const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()])
    return { symbol, name: symbol, decimals: Number(decimals) }
  } catch { return null }
}

// ─── Fee tier label helper ─────────────────────────────────────────────────────
function feePct(fee: number) {
  // Uniswap V3: fee is parts per million
  return (fee / 10000).toFixed(fee % 100 === 0 ? 2 : 4) + '%'
}

// ─── Best route quote with priority: low fee, high liquidity ─────────────────
async function getBestRouteQuote(
  tokenIn: string, tokenOut: string, netAmountIn: bigint
): Promise<QuoteResult | null> {
  const p = getProvider()
  const router = new ethers.Contract(ACUA_SWAP_ROUTER, ACUA_ROUTER_VIEW_ABI, p)
  let best: QuoteResult | null = null

  // ── Single-hop: all fee tiers ───────────────────────────────────────────────
  // Run in priority order (low fee first) — if equal output, lower fee wins
  const singleResults: { fee: number; amountOut: bigint }[] = []
  await Promise.all(FEE_TIERS_ORDERED.map(async fee => {
    try {
      const [amountOut] = await router.quoteSingle(tokenIn, tokenOut, fee, netAmountIn)
      const out = BigInt(amountOut.toString())
      if (out > 0n) singleResults.push({ fee, amountOut: out })
    } catch {}
  }))

  // Sort: highest amountOut wins; tie-break by lowest fee
  singleResults.sort((a, b) => {
    if (a.amountOut !== b.amountOut) return a.amountOut > b.amountOut ? -1 : 1
    return a.fee - b.fee
  })
  if (singleResults.length > 0) {
    const { fee, amountOut } = singleResults[0]
    best = {
      amountOut,
      fee,
      label: `Directo ${feePct(fee)}`,
    }
  }

  // ── Multi-hop via WLD and USDC ──────────────────────────────────────────────
  const wld  = TOKENS.WLD.toLowerCase()
  const usdc = TOKENS.USDC.toLowerCase()
  const inL  = tokenIn.toLowerCase()
  const outL = tokenOut.toLowerCase()

  const hopTokens: string[] = []
  if (inL !== wld  && outL !== wld)  hopTokens.push(TOKENS.WLD)
  if (inL !== usdc && outL !== usdc) hopTokens.push(TOKENS.USDC)

  const multiResults: { fee: number; fee2: number; hopToken: string; amountOut: bigint }[] = []
  await Promise.all(hopTokens.flatMap(hop =>
    [500, 3000].flatMap(f1 =>
      [500, 3000].map(async f2 => {
        try {
          const [mid] = await router.quoteSingle(tokenIn, hop, f1, netAmountIn)
          const midAmt = BigInt(mid.toString())
          if (midAmt === 0n) return
          const [out2] = await router.quoteSingle(hop, tokenOut, f2, midAmt)
          const out = BigInt(out2.toString())
          if (out > 0n) multiResults.push({ fee: f1, fee2: f2, hopToken: hop, amountOut: out })
        } catch {}
      })
    )
  ))

  // Sort multi results same way
  multiResults.sort((a, b) => {
    if (a.amountOut !== b.amountOut) return a.amountOut > b.amountOut ? -1 : 1
    return (a.fee + a.fee2) - (b.fee + b.fee2)
  })

  for (const mr of multiResults) {
    if (!best || mr.amountOut > best.amountOut) {
      const hopSym = mr.hopToken.toLowerCase() === wld ? 'WLD' : 'USDC'
      best = {
        amountOut: mr.amountOut,
        fee: mr.fee,
        fee2: mr.fee2,
        hopToken: mr.hopToken,
        multi: true,
        label: `Via ${hopSym} (${feePct(mr.fee)}+${feePct(mr.fee2)})`,
      }
    }
  }

  return best
}

// ─── Price impact calculation ─────────────────────────────────────────────────
function calcPriceImpact(
  amountIn: bigint, decimalsIn: number, priceIn: number,
  amountOut: bigint, decimalsOut: number, priceOut: number,
): number | null {
  if (!priceIn || !priceOut) return null
  const valueIn  = parseFloat(ethers.formatUnits(amountIn, decimalsIn)) * priceIn
  const valueOut = parseFloat(ethers.formatUnits(amountOut, decimalsOut)) * priceOut
  if (valueIn === 0) return null
  const impactFrac = (valueIn - valueOut) / valueIn
  return Math.round(impactFrac * 10000) // in bps
}

// ─── Token Logo ───────────────────────────────────────────────────────────────
function TokenLogo({ token, size = 'md' }: { token: TokenItem; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const [imgError, setImgError] = useState(false)
  const sizeMap = { xs: 'w-5 h-5', sm: 'w-7 h-7', md: 'w-8 h-8', lg: 'w-10 h-10' }
  const textMap = { xs: 'text-[8px]', sm: 'text-[9px]', md: 'text-xs', lg: 'text-sm' }
  const cls = sizeMap[size]
  if (token.logoUri && !imgError) {
    return (
      <img src={token.logoUri} alt={token.symbol} onError={() => setImgError(true)}
        className={cn(cls, 'rounded-full object-cover shrink-0')} />
    )
  }
  return (
    <div className={cn(cls, 'rounded-full flex items-center justify-center font-bold shrink-0', textMap[size])}
      style={{ background: token.color + '22', color: token.color }}>
      {token.symbol.slice(0, size === 'xs' ? 3 : 4)}
    </div>
  )
}

// ─── Token Picker Modal ───────────────────────────────────────────────────────
function TokenPicker({ tokens, onSelect, onClose, exclude }: {
  tokens: TokenItem[]
  onSelect: (t: TokenItem) => void
  onClose: () => void
  exclude?: string
}) {
  const [q, setQ] = useState('')
  const filtered = tokens.filter(t =>
    t.address.toLowerCase() !== exclude?.toLowerCase() &&
    (t.symbol.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()))
  )
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-end justify-center p-4">
      <div className="w-full max-w-sm bg-background border border-border rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <span className="text-sm font-bold">Seleccionar token</span>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-3 py-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Buscar token..."
              className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground" />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-border">
          {filtered.map(t => (
            <button key={t.address} onClick={() => { onSelect(t); onClose() }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left">
              <TokenLogo token={t} size="sm" />
              <div>
                <p className="text-sm font-semibold">{t.symbol}</p>
                <p className="text-xs text-muted-foreground">{t.name}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">Sin resultados</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Countdown timer ──────────────────────────────────────────────────────────
function Countdown({ secondsLeft }: { secondsLeft: number }) {
  const [secs, setSecs] = useState(secondsLeft)
  useEffect(() => {
    setSecs(secondsLeft)
    const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [secondsLeft])
  const d  = Math.floor(secs / 86400)
  const h  = Math.floor((secs % 86400) / 3600)
  const m  = Math.floor((secs % 3600) / 60)
  const s  = secs % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="flex items-center gap-1 font-mono text-xs text-teal-300">
      <Clock className="w-3 h-3 mr-0.5" />
      {d > 0 && <span>{d}d </span>}
      <span>{pad(h)}:{pad(m)}:{pad(s)}</span>
    </div>
  )
}

// ─── Volume tier row ──────────────────────────────────────────────────────────
function TierRow({ threshold, reward, status, index }: {
  threshold: bigint; reward: bigint; status: number; index: number
}) {
  const usdcAmt = Number(threshold) / 1_000_000
  const uth2Amt = parseFloat(ethers.formatEther(reward))
  const label   = usdcAmt >= 1000 ? `$${(usdcAmt/1000).toFixed(0)}k` : `$${usdcAmt.toFixed(0)}`
  const icons   = ['🌊', '💧', '🌀', '⚡', '🔥', '💎', '🌌', '🏆']
  return (
    <div className={cn(
      'flex items-center gap-2 p-2.5 rounded-lg border text-xs transition-colors',
      status === 2 ? 'border-green-500/30 bg-green-500/10 opacity-70'
        : status === 1 ? 'border-teal-400/40 bg-teal-500/10'
        : 'border-border bg-surface-2/50'
    )}>
      <span className="text-base shrink-0">{icons[index] ?? '•'}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground">Tier {index + 1} — {label}</p>
        <p className="text-muted-foreground">{uth2Amt.toFixed(4)} UTH2</p>
      </div>
      {status === 2 && <Check className="w-4 h-4 text-green-400 shrink-0" />}
      {status === 1 && <Award className="w-4 h-4 text-teal-400 shrink-0 animate-pulse" />}
      {status === 0 && <span className="text-muted-foreground/50">pendiente</span>}
    </div>
  )
}

// ─── Local storage helpers ────────────────────────────────────────────────────
const LS_CUSTOMS = 'acua_swap_customTokens'
function lsGet(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch {}
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── Main Panel ───────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
export function SwapPanel({ userAddress, isAdmin }: { userAddress: string; isAdmin?: boolean }) {
  const [customTokens, setCustomTokens] = useState<TokenItem[]>(() => {
    try { return JSON.parse(lsGet(LS_CUSTOMS, '[]')) } catch { return [] }
  })
  const allTokens = [...DEFAULT_TOKENS, ...customTokens]

  const [view, setView]         = useState<'wallet' | 'swap'>('wallet')
  const [balances, setBalances] = useState<Record<string, bigint>>({})
  const [prices, setPrices]     = useState<Record<string, number>>({})
  const [loadingBal, setLoadingBal] = useState(false)

  const [fromToken, setFromToken] = useState<TokenItem>(DEFAULT_TOKENS[0])
  const [toToken,   setToToken]   = useState<TokenItem>(DEFAULT_TOKENS[1])
  const [fromAmt,   setFromAmt]   = useState('')
  const [quote,     setQuote]     = useState<QuoteResult | null>(null)
  const [quoting,   setQuoting]   = useState(false)
  const [swapping,  setSwapping]  = useState(false)
  const [swapMsg,   setSwapMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null)
  const [priceImpact, setPriceImpact] = useState<number | null>(null)

  const [addAddr,    setAddAddr]    = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMsg,     setAddMsg]     = useState('')

  // ── Volume panel — open by default ──────────────────────────────────────────
  const [volumeOpen,    setVolumeOpen]    = useState(true)
  const [loadingVolume, setLoadingVolume] = useState(false)
  const [claimingVol,   setClaimingVol]   = useState(false)
  const [volMsg,        setVolMsg]        = useState<{ ok: boolean; text: string } | null>(null)
  const [volumeData, setVolumeData] = useState<{
    uth2Amount: bigint
    userVolume: bigint
    tierStatus: number[]
    monthId: bigint
    secondsLeft: number
    thresholds: bigint[]
    rewards: bigint[]
  } | null>(null)

  // ── Load balances & prices ──────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setLoadingBal(true)
    try {
      const p = getProvider()
      const addrs = allTokens.map(t => t.address)
      const results = await Promise.allSettled(
        addrs.map(async addr => {
          const c = new ethers.Contract(addr, ERC20_ABI, p)
          return { addr, bal: BigInt((await c.balanceOf(userAddress)).toString()) }
        })
      )
      const bals: Record<string, bigint> = {}
      results.forEach(r => { if (r.status === 'fulfilled') bals[r.value.addr.toLowerCase()] = r.value.bal })
      setBalances(bals)
      const usdPrices = await fetchUsdPrices(addrs)
      setPrices(usdPrices)
    } catch (e) { console.error('[Swap] loadBalances', e) }
    finally { setLoadingBal(false) }
  }, [userAddress, allTokens.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadBalances() }, [loadBalances])

  // ── Quote via router ─────────────────────────────────────────────────────────
  const quoteTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setQuote(null); setSwapMsg(null); setPriceImpact(null)
    if (!fromAmt || isNaN(Number(fromAmt)) || Number(fromAmt) <= 0) return
    if (quoteTimeout.current) clearTimeout(quoteTimeout.current)
    quoteTimeout.current = setTimeout(async () => {
      setQuoting(true)
      try {
        const rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals)
        const netAmt = rawAmt - rawAmt * BigInt(ACUA_FEE_BPS) / 10000n
        const result = await getBestRouteQuote(fromToken.address, toToken.address, netAmt)
        setQuote(result)
        // Price impact
        if (result) {
          const impact = calcPriceImpact(
            rawAmt, fromToken.decimals, prices[fromToken.address.toLowerCase()] ?? 0,
            result.amountOut, toToken.decimals, prices[toToken.address.toLowerCase()] ?? 0,
          )
          setPriceImpact(impact)
        }
      } catch (e) { console.error('[Swap] quote error', e) }
      finally { setQuoting(false) }
    }, 600)
  }, [fromAmt, fromToken, toToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load volume data — also runs on mount ────────────────────────────────────
  const loadVolume = useCallback(async () => {
    setLoadingVolume(true)
    try {
      const p = getProvider()
      const vc = new ethers.Contract(ACUA_VOLUME_REWARDS, VOLUME_REWARDS_ABI, p)
      const [
        [uth2Amount, userVolume, tierStatus],
        [monthId, , , secondsLeft],
        [thresholds, rewards],
      ] = await Promise.all([
        vc.pendingNow(userAddress),
        vc.getPeriodInfo(),
        vc.getAllTiers(),
      ])
      setVolumeData({
        uth2Amount: BigInt(uth2Amount.toString()),
        userVolume: BigInt(userVolume.toString()),
        tierStatus: Array.from(tierStatus).map((v: any) => Number(v)),
        monthId: BigInt(monthId.toString()),
        secondsLeft: Number(secondsLeft.toString()),
        thresholds: Array.from(thresholds).map((v: any) => BigInt(v.toString())),
        rewards: Array.from(rewards).map((v: any) => BigInt(v.toString())),
      })
    } catch (e) { console.error('[Volume]', e) }
    finally { setLoadingVolume(false) }
  }, [userAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  // Always load volume on mount
  useEffect(() => { loadVolume() }, [loadVolume])

  // ── Claim volume rewards ─────────────────────────────────────────────────────
  const doClaimVolume = useCallback(async () => {
    if (!volumeData || volumeData.uth2Amount === 0n) return
    setClaimingVol(true); setVolMsg(null)
    try {
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_VOLUME_REWARDS, abi: CLAIM_ABI,
          functionName: 'claimRewards', args: [volumeData.monthId.toString()] }]
      })
      if (finalPayload.status === 'success') {
        const uth2Human = ethers.formatEther(volumeData.uth2Amount)
        setVolMsg({ ok: true, text: `✓ ${parseFloat(uth2Human).toFixed(4)} UTH2 reclamado!` })
        setTimeout(loadVolume, 2000)
      } else {
        setVolMsg({ ok: false, text: 'Transaccion cancelada' })
      }
    } catch (e: any) {
      setVolMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setClaimingVol(false) }
  }, [volumeData, loadVolume])

  // ── Execute swap via AcuaSwapRouter + Permit2 ────────────────────────────────
  const doSwap = useCallback(async () => {
    if (!fromAmt || !quote) return
    // Block if price impact too high
    if (priceImpact !== null && priceImpact > MAX_IMPACT_BLOCK) {
      setSwapMsg({ ok: false, text: `Impacto de precio demasiado alto (${(priceImpact/100).toFixed(1)}%). Reduce el monto.` })
      return
    }
    setSwapping(true); setSwapMsg(null)
    try {
      const rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals)
      // minOut: 1% slippage on quoted amount for protection
      const minOut = quote.amountOut * BigInt(10000 - SLIPPAGE_BPS) / 10000n

      // USDC equivalent for volume tracking
      const priceUsd = prices[fromToken.address.toLowerCase()] ?? 0
      const floatAmt = parseFloat(ethers.formatUnits(rawAmt, fromToken.decimals))
      const usdcEquiv = BigInt(Math.floor(floatAmt * priceUsd * 1_000_000))

      // Permit2 expiration: 7 days
      const expiration = Math.floor(Date.now() / 1000) + 86400 * 7

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
          args: [fromToken.address, ACUA_SWAP_ROUTER, MAX_UINT160, expiration.toString()],
        },
      ]

      if (quote.multi && quote.hopToken && quote.fee2 !== undefined) {
        txs.push({
          address: ACUA_SWAP_ROUTER,
          abi: ACUA_SWAP_V3_MULTI_ABI,
          functionName: 'swapV3Multi',
          args: [
            fromToken.address, quote.hopToken, toToken.address,
            quote.fee, quote.fee2,
            rawAmt.toString(), minOut.toString(), usdcEquiv.toString(),
          ],
        })
      } else {
        txs.push({
          address: ACUA_SWAP_ROUTER,
          abi: ACUA_SWAP_V3_SINGLE_ABI,
          functionName: 'swapV3Single',
          args: [
            fromToken.address, toToken.address, quote.fee,
            rawAmt.toString(), minOut.toString(), usdcEquiv.toString(),
          ],
        })
      }

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: txs })
      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        setSwapMsg({ ok: true, text: txId ? `✓ Swap exitoso! ${txId.slice(0, 12)}...` : '✓ Swap exitoso!' })
        setFromAmt(''); setQuote(null); setPriceImpact(null)
        setTimeout(() => { loadBalances(); loadVolume() }, 3000)
      } else {
        setSwapMsg({ ok: false, text: (finalPayload as any).message ?? 'Transaccion rechazada' })
      }
    } catch (e: any) {
      setSwapMsg({ ok: false, text: e?.message ?? 'Error desconocido' })
    } finally { setSwapping(false) }
  }, [fromAmt, quote, fromToken, toToken, userAddress, prices, priceImpact, loadBalances, loadVolume]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add custom token ─────────────────────────────────────────────────────────
  const addToken = useCallback(async () => {
    const addr = addAddr.trim()
    if (!ethers.isAddress(addr)) return setAddMsg('Direccion invalida')
    if (allTokens.find(t => t.address.toLowerCase() === addr.toLowerCase())) return setAddMsg('Token ya existe')
    setAddLoading(true); setAddMsg('')
    const meta = await fetchTokenMeta(addr)
    if (!meta) { setAddLoading(false); return setAddMsg('No se pudo leer el token') }
    const newToken: TokenItem = { ...meta, address: addr, color: '#94a3b8', isCustom: true }
    const updated = [...customTokens, newToken]
    setCustomTokens(updated)
    lsSet(LS_CUSTOMS, JSON.stringify(updated))
    setAddAddr(''); setAddMsg(`${meta.symbol} agregado`)
    setAddLoading(false)
    setTimeout(() => setAddMsg(''), 3000)
  }, [addAddr, customTokens, allTokens])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const getBalance = (token: TokenItem) => balances[token.address.toLowerCase()] ?? 0n
  const getUsdVal = (token: TokenItem, bal: bigint) => {
    const price = prices[token.address.toLowerCase()]
    if (!price) return null
    const floatBal = parseFloat(ethers.formatUnits(bal, token.decimals))
    return (floatBal * price).toFixed(2)
  }
  const feeAmtDisplay = (() => {
    const n = parseFloat(fromAmt || '0')
    return isNaN(n) ? '0' : (n * ACUA_FEE_BPS / 10000).toFixed(6)
  })()

  const impactColor = priceImpact === null ? '' :
    priceImpact > MAX_IMPACT_BLOCK ? 'text-red-400' :
    priceImpact > MAX_IMPACT_WARN  ? 'text-yellow-400' : 'text-green-400'

  const swapBlocked = priceImpact !== null && priceImpact > MAX_IMPACT_BLOCK

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
            <Repeat2 className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">Acua Swap</h2>
            <p className="text-xs text-muted-foreground">Uniswap V3 · World Chain · <span className="text-green-400">gas ultra bajo</span></p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={loadBalances} disabled={loadingBal} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn('w-4 h-4', loadingBal && 'animate-spin')} />
          </button>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setView('wallet')}
              className={cn('px-3 py-1 text-xs font-medium transition-colors', view === 'wallet' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              <Wallet className="w-3.5 h-3.5 inline mr-1" />Tokens
            </button>
            <button onClick={() => setView('swap')}
              className={cn('px-3 py-1 text-xs font-medium transition-colors', view === 'swap' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              <Repeat2 className="w-3.5 h-3.5 inline mr-1" />Swap
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════════ VOLUME REWARDS — ARRIBA Y VISIBLE ════════════════════ */}
      <div className="rounded-2xl border border-teal-500/20 bg-gradient-to-br from-teal-950/30 to-cyan-900/20 overflow-hidden">
        <button onClick={() => setVolumeOpen(v => !v)}
          className="w-full flex items-center justify-between p-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-teal-400" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-teal-300">Rewards por Volumen</p>
                {volumeData && volumeData.uth2Amount > 0n && (
                  <span className="text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full animate-pulse">
                    RECLAMAR UTH2
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <p className="text-xs text-muted-foreground">Haz swap · Gana UTH2 cada mes</p>
                {volumeData && volumeData.userVolume > 0n && (
                  <span className="text-xs font-mono text-teal-300 font-semibold">
                    Vol: ${(Number(volumeData.userVolume) / 1_000_000).toFixed(2)}
                  </span>
                )}
                {volumeData && volumeData.uth2Amount > 0n && (
                  <span className="text-xs font-mono text-green-300 font-bold">
                    {parseFloat(ethers.formatEther(volumeData.uth2Amount)).toFixed(4)} UTH2
                  </span>
                )}
              </div>
            </div>
          </div>
          {volumeOpen
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {volumeOpen && (
          <div className="px-4 pb-4 pt-1 border-t border-border/50 space-y-4">
            {loadingVolume ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-teal-400" /></div>
            ) : volumeData ? (
              <>
                {/* Period info */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Tiempo restante del periodo</span>
                  <Countdown secondsLeft={volumeData.secondsLeft} />
                </div>

                {/* Volume + progress bar */}
                <div className="bg-black/20 rounded-xl p-3 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Tu volumen este mes</p>
                    <p className="text-sm font-bold font-mono text-teal-300">
                      ${(Number(volumeData.userVolume) / 1_000_000).toFixed(2)} USDC
                    </p>
                  </div>
                  {(() => {
                    const volNum = Number(volumeData.userVolume)
                    const maxTier = volumeData.thresholds.length > 0
                      ? Number(volumeData.thresholds[volumeData.thresholds.length - 1])
                      : 1_000_000_000
                    const pct = Math.min(100, (volNum / maxTier) * 100)
                    let nextThreshold: number | null = null
                    for (const t of volumeData.thresholds) {
                      if (Number(t) > volNum) { nextThreshold = Number(t); break }
                    }
                    return (
                      <div className="space-y-1">
                        <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-teal-500 to-cyan-400 rounded-full transition-all duration-700"
                            style={{ width: `${pct}%` }} />
                        </div>
                        {nextThreshold !== null && (
                          <p className="text-[10px] text-muted-foreground text-right">
                            ${((nextThreshold - volNum) / 1_000_000).toFixed(2)} más para el siguiente tier
                          </p>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* Tier list */}
                {volumeData.thresholds.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tiers de volumen</p>
                    {volumeData.thresholds.map((threshold, i) => (
                      <TierRow key={i} threshold={threshold} reward={volumeData.rewards[i] ?? 0n}
                        status={volumeData.tierStatus[i] ?? 0} index={i} />
                    ))}
                  </div>
                )}

                {/* Claim section */}
                <div className="space-y-2">
                  {volumeData.uth2Amount > 0n ? (
                    <>
                      <div className="flex items-center justify-between rounded-xl border border-teal-400/30 bg-teal-500/10 px-3 py-2.5">
                        <div>
                          <p className="text-xs text-muted-foreground">UTH2 disponible para reclamar</p>
                          <p className="text-lg font-bold font-mono text-teal-300">
                            {parseFloat(ethers.formatEther(volumeData.uth2Amount)).toFixed(4)} UTH2
                          </p>
                        </div>
                        <Award className="w-7 h-7 text-teal-400" />
                      </div>
                      <Button
                        className="w-full h-10 bg-teal-500/20 hover:bg-teal-500/30 text-teal-300 border border-teal-500/30 text-sm font-semibold"
                        variant="outline" onClick={doClaimVolume} disabled={claimingVol}>
                        {claimingVol
                          ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Reclamando...</>
                          : <><Award className="w-4 h-4 mr-2" /> Reclamar UTH2</>}
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-2">
                      <p className="text-xs text-muted-foreground">
                        {Number(volumeData.userVolume) > 0
                          ? '✓ Todo reclamado este mes'
                          : 'Haz swaps para acumular UTH2'}
                      </p>
                    </div>
                  )}
                  {volMsg && (
                    <p className={cn('text-xs text-center font-medium', volMsg.ok ? 'text-green-400' : 'text-red-400')}>
                      {volMsg.text}
                    </p>
                  )}
                  <button onClick={loadVolume}
                    className="w-full text-xs text-muted-foreground flex items-center justify-center gap-1 hover:text-foreground transition-colors py-1">
                    <RefreshCw className={cn('w-3 h-3', loadingVolume && 'animate-spin')} />
                    Actualizar datos
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <button onClick={loadVolume} className="text-xs text-teal-400 hover:underline flex items-center gap-1 mx-auto">
                  <RefreshCw className="w-3 h-3" /> Cargar datos de volumen
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════ WALLET VIEW ════════════════════ */}
      {view === 'wallet' && (
        <div className="space-y-2">
          {Object.keys(prices).length > 0 && (() => {
            let total = 0
            allTokens.forEach(t => {
              const price = prices[t.address.toLowerCase()]
              if (!price) return
              const bal = parseFloat(ethers.formatUnits(getBalance(t), t.decimals))
              total += bal * price
            })
            return total > 0 ? (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-center">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor total de cartera</p>
                <p className="text-2xl font-bold font-mono text-primary">
                  ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            ) : null
          })()}

          <div className="space-y-2">
            {loadingBal && Object.keys(balances).length === 0 && (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            )}
            {allTokens.map(token => {
              const bal  = getBalance(token)
              const usd  = getUsdVal(token, bal)
              const price = prices[token.address.toLowerCase()]
              return (
                <div key={token.address}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-2 hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => { setFromToken(token); setView('swap') }}>
                  <TokenLogo token={token} size="lg" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-foreground">{token.symbol}</span>
                      {token.isCustom && <span className="text-[9px] text-muted-foreground border border-border rounded px-1">custom</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">{token.name}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-semibold text-foreground">
                      {bal === 0n ? '0' : formatToken(bal, token.decimals, 4)}
                    </p>
                    {price && <p className="text-xs text-muted-foreground">${price < 0.01 ? price.toExponential(2) : price.toLocaleString('en-US', { maximumFractionDigits: 4 })}</p>}
                    {usd && parseFloat(usd) > 0 && <p className="text-xs text-green-400 font-mono">${usd}</p>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Add custom token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Plus className="w-3 h-3" /> Agregar token por direccion
            </p>
            <div className="flex gap-2">
              <input value={addAddr} onChange={e => setAddAddr(e.target.value)}
                placeholder="0x... direccion del token"
                className="flex-1 min-w-0 text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono" />
              <Button size="sm" className="text-xs h-8 shrink-0" onClick={addToken} disabled={addLoading}>
                {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>
            {addMsg && <p className={cn('text-xs font-medium', addMsg.includes('agregado') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>}
          </div>
        </div>
      )}

      {/* ════════════════════ SWAP VIEW ════════════════════ */}
      {view === 'swap' && (
        <div className="space-y-3">
          {/* Fee + gas info bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground bg-surface-2 rounded-lg px-3 py-2 border border-border">
            <span className="flex items-center gap-1">
              <Coins className="w-3 h-3" />
              Comision: <strong className="text-foreground">2%</strong>
              <span className="text-muted-foreground/60">+ 0.1% H2O · Slippage máx: 1%</span>
            </span>
            {quote && (
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-mono font-bold',
                quote.fee >= FEE_WARN_THRESHOLD
                  ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30'
                  : 'bg-primary/10 text-primary border border-primary/20'
              )}>
                {quote.label}
              </span>
            )}
          </div>

          {/* High pool fee warning */}
          {quote && quote.fee >= FEE_WARN_THRESHOLD && !quote.multi && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
              <ShieldAlert className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
              <p className="text-xs text-yellow-300">
                Pool con fee alto ({feePct(quote.fee)}). Es la única ruta disponible para este par.
              </p>
            </div>
          )}

          {/* From token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">De</span>
              <button onClick={() => setFromAmt(ethers.formatUnits(getBalance(fromToken), fromToken.decimals))}
                className="text-xs text-primary hover:underline font-mono">
                Saldo: {formatToken(getBalance(fromToken), fromToken.decimals, 4)}
              </button>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => setPickerFor('from')}
                className="flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 hover:border-primary/40 transition-colors shrink-0">
                <TokenLogo token={fromToken} size="xs" />
                <span className="text-xs font-bold">{fromToken.symbol}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
              <input type="number" min="0" step="any" value={fromAmt}
                onChange={e => setFromAmt(e.target.value)} placeholder="0.0"
                className="flex-1 min-w-0 bg-transparent text-right text-xl font-mono font-bold text-foreground placeholder:text-muted-foreground/40 outline-none" />
            </div>
            {fromAmt && parseFloat(fromAmt) > 0 && prices[fromToken.address.toLowerCase()] && (
              <p className="text-xs text-muted-foreground text-right">
                ≈ ${(parseFloat(fromAmt) * prices[fromToken.address.toLowerCase()]).toFixed(2)} USD
              </p>
            )}
          </div>

          {/* Flip */}
          <div className="flex justify-center">
            <button
              onClick={() => { setFromToken(toToken); setToToken(fromToken); setFromAmt(''); setQuote(null); setPriceImpact(null) }}
              className="w-9 h-9 rounded-full border border-border bg-surface-2 flex items-center justify-center hover:border-primary/40 hover:bg-primary/10 transition-colors">
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* To token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Para</span>
              <span className="text-xs text-muted-foreground font-mono">Saldo: {formatToken(getBalance(toToken), toToken.decimals, 4)}</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => setPickerFor('to')}
                className="flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 hover:border-primary/40 transition-colors shrink-0">
                <TokenLogo token={toToken} size="xs" />
                <span className="text-xs font-bold">{toToken.symbol}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
              <div className="flex-1 min-w-0 text-right">
                {quoting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
                ) : quote ? (
                  <span className="text-xl font-mono font-bold text-green-400">
                    {formatToken(quote.amountOut, toToken.decimals, 6)}
                  </span>
                ) : (
                  <span className="text-xl font-mono font-bold text-muted-foreground/40">0.0</span>
                )}
              </div>
            </div>
            {quote && prices[toToken.address.toLowerCase()] && (
              <p className="text-xs text-muted-foreground text-right">
                ≈ ${(parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals)) * prices[toToken.address.toLowerCase()]).toFixed(2)} USD
              </p>
            )}
          </div>

          {/* Detailed breakdown: fee + slippage + price impact */}
          {fromAmt && parseFloat(fromAmt) > 0 && (
            <div className="rounded-lg border border-border bg-surface-2/50 p-2.5 space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Comision Acua (2% + 0.1% H2O)</span>
                <span className="font-mono">{feeAmtDisplay} {fromToken.symbol}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Slippage máx</span>
                <span className="font-mono text-primary">1%</span>
              </div>
              {priceImpact !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    {priceImpact > MAX_IMPACT_WARN && <ShieldAlert className="w-3 h-3" />}
                    Impacto de precio
                  </span>
                  <span className={cn('font-mono font-semibold', impactColor)}>
                    {(priceImpact / 100).toFixed(2)}%
                  </span>
                </div>
              )}
              {quote && fromAmt && parseFloat(fromAmt) > 0 && (
                <div className="flex justify-between text-muted-foreground pt-0.5 border-t border-border/40">
                  <span>Tasa efectiva</span>
                  <span className="font-mono">
                    1 {fromToken.symbol} = {(
                      parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals)) /
                      parseFloat(fromAmt)
                    ).toFixed(6)} {toToken.symbol}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* High price impact warning */}
          {priceImpact !== null && priceImpact > MAX_IMPACT_WARN && (
            <div className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2',
              priceImpact > MAX_IMPACT_BLOCK
                ? 'border-red-500/40 bg-red-500/10'
                : 'border-yellow-500/30 bg-yellow-500/10'
            )}>
              <ShieldAlert className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', priceImpact > MAX_IMPACT_BLOCK ? 'text-red-400' : 'text-yellow-400')} />
              <p className={cn('text-xs', priceImpact > MAX_IMPACT_BLOCK ? 'text-red-300' : 'text-yellow-300')}>
                {priceImpact > MAX_IMPACT_BLOCK
                  ? `Impacto de precio muy alto (${(priceImpact/100).toFixed(1)}%). Swap bloqueado. Reduce el monto.`
                  : `Impacto de precio elevado (${(priceImpact/100).toFixed(1)}%). Considera reducir el monto.`}
              </p>
            </div>
          )}

          {/* No route warning */}
          {fromAmt && parseFloat(fromAmt) > 0 && !quoting && !quote && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
              <p className="text-xs text-yellow-400">Sin liquidez en Uniswap V3 para este par en World Chain</p>
            </div>
          )}

          {/* Swap button */}
          <Button
            className={cn('w-full h-12 text-base font-semibold', swapBlocked && 'opacity-50')}
            onClick={doSwap}
            disabled={swapping || !quote || !fromAmt || parseFloat(fromAmt) <= 0 || swapBlocked}>
            {swapping
              ? <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Ejecutando...</>
              : swapBlocked
                ? <><ShieldAlert className="w-5 h-5 mr-2" /> Impacto muy alto</>
                : 'Swap'}
          </Button>

          {swapMsg && (
            <p className={cn('text-xs text-center font-medium font-mono', swapMsg.ok ? 'text-green-400' : 'text-red-400')}>
              {swapMsg.text}
            </p>
          )}

          {/* Add custom token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Plus className="w-3 h-3" /> Agregar token personalizado
            </p>
            <div className="flex gap-2">
              <input value={addAddr} onChange={e => setAddAddr(e.target.value)}
                placeholder="0x... direccion del token"
                className="flex-1 min-w-0 text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono" />
              <Button size="sm" className="text-xs h-8 shrink-0" onClick={addToken} disabled={addLoading}>
                {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>
            {addMsg && <p className={cn('text-xs font-medium', addMsg.includes('agregado') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>}
          </div>
        </div>
      )}

      {/* Token picker modal */}
      {pickerFor && (
        <TokenPicker
          tokens={allTokens}
          onSelect={t => pickerFor === 'from' ? setFromToken(t) : setToToken(t)}
          onClose={() => setPickerFor(null)}
          exclude={pickerFor === 'from' ? toToken.address : fromToken.address}
        />
      )}
    </div>
  )
}
