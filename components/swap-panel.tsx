'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  ArrowUpDown, RefreshCw, Plus, ChevronDown, Loader2, Search,
  X, Wallet, ChevronUp, Check, AlertCircle, Repeat2,
  TrendingUp, Coins, Award, Gift,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TOKENS, getProvider, ERC20_ABI, shortenAddress, formatToken,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Uniswap V3 — World Chain (480) ──────────────────────────────────────────
const UNISWAP_V3_QUOTER  = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'
const FEE_TIERS = [100, 500, 3000, 10000]

// ─── SushiSwap V2 — World Chain (480) ────────────────────────────────────────
const SUSHI_V2_ROUTER = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'

// ─── Permit2 ──────────────────────────────────────────────────────────────────
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

// ─── Acua contracts (fill after deploy) ──────────────────────────────────────
// TODO: replace AFTER running `npm run deploy:swap-router` and `npm run deploy:volume-rewards`
const ACUA_SWAP_ROUTER   = '0x0000000000000000000000000000000000000000'
const ACUA_VOLUME_REWARDS= '0x0000000000000000000000000000000000000000'

// ─── LocalStorage ────────────────────────────────────────────────────────────
const LS_CUSTOMS = 'acua_swap_customTokens'

function lsGet(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}
function lsSet(key: string, val: string) {
  try { localStorage.setItem(key, val) } catch {}
}

const routerDeployed = ACUA_SWAP_ROUTER !== '0x0000000000000000000000000000000000000000'

// ─── Token logos (CDN URLs for known tokens; others use colored circle) ───────
const TOKEN_LOGOS: Record<string, string> = {
  WLD:    'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
  USDC:   'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  SUSHI:  'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f363.svg',
}

// ─── Token item ───────────────────────────────────────────────────────────────
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
  { symbol: 'WLD',    name: 'Worldcoin',   address: TOKENS.WLD,    decimals: 18, color: '#3b82f6', logoUri: TOKEN_LOGOS.WLD  },
  { symbol: 'H2O',    name: 'H2O Token',   address: TOKENS.H2O,    decimals: 18, color: '#06b6d4' },
  { symbol: 'FIRE',   name: 'Fire Token',  address: TOKENS.FIRE,   decimals: 18, color: '#f97316' },
  { symbol: 'SUSHI',  name: 'Sushi',   address: TOKENS.SUSHI,  decimals: 18, color: '#ec4899', logoUri: TOKEN_LOGOS.SUSHI },
  { symbol: 'USDC',   name: 'USD Coin',    address: TOKENS.USDC,   decimals: 6,  color: '#2563eb', logoUri: TOKEN_LOGOS.USDC },
  { symbol: 'wCOP',   name: 'wCOP',        address: TOKENS.wCOP,   decimals: 18, color: '#f59e0b' },
  { symbol: 'wARS',   name: 'wARS',        address: TOKENS.wARS,   decimals: 18, color: '#10b981' },
  { symbol: 'BTCH2O', name: 'BTC H2O',     address: TOKENS.BTCH2O, decimals: 18, color: '#f59e0b' },
  { symbol: 'AIR',    name: 'AIR Token',   address: TOKENS.AIR,    decimals: 18, color: '#8b5cf6' },
  { symbol: 'UTH2',   name: 'UTH2',        address: TOKENS.UTH2,   decimals: 18, color: '#a78bfa' },
]

// ─── Token Logo Component ──────────────────────────────────────────────────────
function TokenLogo({ token, size = 'md' }: { token: TokenItem; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const [imgError, setImgError] = useState(false)
  const sizeMap = { xs: 'w-5 h-5', sm: 'w-7 h-7', md: 'w-8 h-8', lg: 'w-10 h-10' }
  const textMap = { xs: 'text-[8px]', sm: 'text-[9px]', md: 'text-xs', lg: 'text-sm' }
  const cls = sizeMap[size]

  if (token.logoUri && !imgError) {
    return (
      <img
        src={token.logoUri}
        alt={token.symbol}
        onError={() => setImgError(true)}
        className={cn(cls, 'rounded-full object-cover shrink-0')}
      />
    )
  }

  return (
    <div
      className={cn(cls, 'rounded-full flex items-center justify-center font-bold shrink-0', textMap[size])}
      style={{ background: token.color + '22', color: token.color }}
    >
      {token.symbol.slice(0, size === 'xs' ? 3 : 4)}
    </div>
  )
}

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const APPROVE_ABI = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}]

// Permit2 AllowanceTransfer.approve — lets our router pull tokens in one batch tx
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

// AcuaSwapRouter — swapV3 (Uniswap V3 path)
const ACUA_SWAP_V3_ABI = [{
  name: 'swapV3', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn',        type: 'address' },
    { name: 'tokenOut',       type: 'address' },
    { name: 'amountIn',       type: 'uint256' },
    { name: 'amountOutMin',   type: 'uint256' },
    { name: 'v3Path',         type: 'bytes'   },
    { name: 'usdcEquivalent', type: 'uint256' },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]

// AcuaSwapRouter — swapV2 (SushiSwap V2 path)
const ACUA_SWAP_V2_ABI = [{
  name: 'swapV2', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenIn',        type: 'address'   },
    { name: 'tokenOut',       type: 'address'   },
    { name: 'amountIn',       type: 'uint256'   },
    { name: 'amountOutMin',   type: 'uint256'   },
    { name: 'v2Path',         type: 'address[]' },
    { name: 'usdcEquivalent', type: 'uint256'   },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]

const VOLUME_REWARDS_ABI = [
  'function pendingNow(address user) view returns (uint256 uth2Amount, uint256 userVolume, uint8[4] tierStatus)',
  'function currentMonth() view returns (uint256)',
  'function claimRewards(uint256 monthId) nonpayable',
  'function tierThresholds(uint256) view returns (uint256)',
  'function tierRewards(uint256) view returns (uint256)',
]

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
]

const SUSHI_V2_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
]

// ─── Quote result type ────────────────────────────────────────────────────────
type QuoteSource = 'v3-direct' | 'v3-multihop' | 'v2-direct' | 'v2-multihop'

interface QuoteResult {
  amountOut: bigint
  fee: number
  source: QuoteSource
  v3Path?: string          // encoded bytes for V3 multi-hop
  v2Path?: string[]        // address array for V2
  hopLabel?: string        // e.g. "WLD" or "USDC"
}

// ─── Price fetcher via DexScreener ───────────────────────────────────────────
async function fetchUsdPrices(addresses: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  try {
    const chunk = addresses.slice(0, 30).join(',')
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`, {
      headers: { 'Accept': 'application/json' },
    })
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

// ─── V3 Direct quote (best fee tier) ─────────────────────────────────────────
async function getV3DirectQuote(
  tokenIn: string, tokenOut: string, amountIn: bigint
): Promise<QuoteResult | null> {
  const p = getProvider()
  const quoter = new ethers.Contract(UNISWAP_V3_QUOTER, QUOTER_V2_ABI, p)
  let best: QuoteResult | null = null
  await Promise.allSettled(
    FEE_TIERS.map(async (fee) => {
      try {
        const [amountOut] = await quoter.quoteExactInputSingle.staticCall({
          tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n,
        })
        if (!best || amountOut > best.amountOut) {
          best = { amountOut, fee, source: 'v3-direct' }
        }
      } catch {}
    })
  )
  return best
}

// ─── V3 Multi-hop quote ───────────────────────────────────────────────────────
async function getV3MultiHopQuote(
  tokenIn: string, tokenOut: string, amountIn: bigint,
  hopToken: string, hopLabel: string
): Promise<QuoteResult | null> {
  if (
    tokenIn.toLowerCase() === hopToken.toLowerCase() ||
    tokenOut.toLowerCase() === hopToken.toLowerCase()
  ) return null

  const p = getProvider()
  const quoter = new ethers.Contract(UNISWAP_V3_QUOTER, QUOTER_V2_ABI, p)
  let best: QuoteResult | null = null

  const feePairs = [[500, 500], [500, 3000], [3000, 500], [3000, 3000], [100, 500], [500, 100]]

  await Promise.allSettled(
    feePairs.map(async ([fee1, fee2]) => {
      try {
        const path = ethers.solidityPacked(
          ['address', 'uint24', 'address', 'uint24', 'address'],
          [tokenIn, fee1, hopToken, fee2, tokenOut]
        )
        const [amountOut] = await quoter.quoteExactInput.staticCall(path, amountIn)
        if (!best || amountOut > best.amountOut) {
          best = { amountOut, fee: fee1, source: 'v3-multihop', v3Path: path, hopLabel }
        }
      } catch {}
    })
  )
  return best
}

// ─── SushiSwap V2 quote ───────────────────────────────────────────────────────
async function getSushiV2Quote(
  tokenIn: string, tokenOut: string, amountIn: bigint
): Promise<QuoteResult | null> {
  const p = getProvider()
  const router = new ethers.Contract(SUSHI_V2_ROUTER, SUSHI_V2_ABI, p)

  // Try direct
  try {
    const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut])
    const amountOut: bigint = amounts[amounts.length - 1]
    if (amountOut > 0n) return { amountOut, fee: 3000, source: 'v2-direct', v2Path: [tokenIn, tokenOut] }
  } catch {}

  // Try via WLD
  const wld = TOKENS.WLD
  if (tokenIn.toLowerCase() !== wld.toLowerCase() && tokenOut.toLowerCase() !== wld.toLowerCase()) {
    try {
      const path = [tokenIn, wld, tokenOut]
      const amounts = await router.getAmountsOut(amountIn, path)
      const amountOut: bigint = amounts[amounts.length - 1]
      if (amountOut > 0n) return { amountOut, fee: 3000, source: 'v2-multihop', v2Path: path, hopLabel: 'WLD' }
    } catch {}
  }

  // Try via USDC
  const usdc = TOKENS.USDC
  if (tokenIn.toLowerCase() !== usdc.toLowerCase() && tokenOut.toLowerCase() !== usdc.toLowerCase()) {
    try {
      const path = [tokenIn, usdc, tokenOut]
      const amounts = await router.getAmountsOut(amountIn, path)
      const amountOut: bigint = amounts[amounts.length - 1]
      if (amountOut > 0n) return { amountOut, fee: 3000, source: 'v2-multihop', v2Path: path, hopLabel: 'USDC' }
    } catch {}
  }

  return null
}

// ─── Combined best quote ──────────────────────────────────────────────────────
async function getBestQuote(
  tokenIn: string, tokenOut: string, amountIn: bigint
): Promise<QuoteResult | null> {
  // Run all quote strategies in parallel
  const [v3Direct, v3ViaWLD, v3ViaUSDC, v2] = await Promise.all([
    getV3DirectQuote(tokenIn, tokenOut, amountIn),
    getV3MultiHopQuote(tokenIn, tokenOut, amountIn, TOKENS.WLD,  'WLD'),
    getV3MultiHopQuote(tokenIn, tokenOut, amountIn, TOKENS.USDC, 'USDC'),
    getSushiV2Quote(tokenIn, tokenOut, amountIn),
  ])

  const candidates = [v3Direct, v3ViaWLD, v3ViaUSDC, v2].filter(Boolean) as QuoteResult[]
  if (candidates.length === 0) return null

  // Pick best output amount
  return candidates.reduce((best, c) => c.amountOut > best.amountOut ? c : best)
}

// ─── Token symbol from contract ──────────────────────────────────────────────
async function fetchTokenMeta(address: string): Promise<{ symbol: string; name: string; decimals: number } | null> {
  try {
    const p = getProvider()
    const c = new ethers.Contract(address, ERC20_ABI, p)
    const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()])
    return { symbol, name: symbol, decimals: Number(decimals) }
  } catch { return null }
}

// ─── Token Picker Modal ───────────────────────────────────────────────────────
function TokenPicker({
  tokens, onSelect, onClose, exclude,
}: { tokens: TokenItem[]; onSelect: (t: TokenItem) => void; onClose: () => void; exclude?: string }) {
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
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar token..."
              className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-border">
          {filtered.map(t => (
            <button
              key={t.address}
              onClick={() => { onSelect(t); onClose() }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 transition-colors text-left"
            >
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

// ─── Source badge ─────────────────────────────────────────────────────────────
function SourceBadge({ source, hopLabel }: { source: QuoteSource; hopLabel?: string }) {
  const labels: Record<QuoteSource, string> = {
    'v3-direct': 'Uniswap V3',
    'v3-multihop': `V3 → ${hopLabel ?? '?'}`,
    'v2-direct': 'SushiSwap V2',
    'v2-multihop': `V2 → ${hopLabel ?? '?'}`,
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
      {labels[source]}
    </span>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function SwapPanel({ userAddress, isAdmin }: { userAddress: string; isAdmin?: boolean }) {
  const [customTokens, setCustomTokens] = useState<TokenItem[]>(() => {
    try { return JSON.parse(lsGet(LS_CUSTOMS, '[]')) } catch { return [] }
  })
  const allTokens = [...DEFAULT_TOKENS, ...customTokens]

  const [view, setView] = useState<'wallet' | 'swap'>('wallet')

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
  const [slippage,  setSlippage]  = useState(50)

  const [addAddr,    setAddAddr]    = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMsg,     setAddMsg]     = useState('')

  // ── Volume tracker ──────────────────────────────────────────────────────────
  const [volumeOpen,    setVolumeOpen]    = useState(false)
  const [volumeData,    setVolumeData]    = useState<{
    uth2Amount: bigint; userVolume: bigint; tierStatus: number[]; monthId: bigint
  } | null>(null)
  const [loadingVolume, setLoadingVolume] = useState(false)
  const [claimingVol,   setClaimingVol]   = useState(false)
  const [volMsg,        setVolMsg]         = useState<{ ok: boolean; text: string } | null>(null)

  const VOLUME_DEPLOYED = ACUA_VOLUME_REWARDS !== '0x0000000000000000000000000000000000000000'

  // ── Load balances & prices ──────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setLoadingBal(true)
    try {
      const p = getProvider()
      const addrs = allTokens.map(t => t.address)
      const results = await Promise.allSettled(
        addrs.map(async addr => {
          const c = new ethers.Contract(addr, ERC20_ABI, p)
          return { addr, bal: await c.balanceOf(userAddress) }
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

  // ── Quote (uses net amount after 2.1% total fee for accurate price estimate) ──
  const quoteTimeout = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    setQuote(null); setSwapMsg(null)
    if (!fromAmt || isNaN(Number(fromAmt)) || Number(fromAmt) <= 0) return
    if (quoteTimeout.current) clearTimeout(quoteTimeout.current)
    quoteTimeout.current = setTimeout(async () => {
      setQuoting(true)
      try {
        const rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals)
        // Total fee = swapFeeBps(200) + h2oFeeBps(10) = 210 bps = 2.1%
        const totalFeeBps = 210n
        const netAmt = rawAmt - rawAmt * totalFeeBps / 10000n
        const result = await getBestQuote(fromToken.address, toToken.address, netAmt)
        setQuote(result)
      } catch (e) { console.error('[Swap] quote error', e) }
      finally { setQuoting(false) }
    }, 600)
  }, [fromAmt, fromToken, toToken]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load volume tracker data ─────────────────────────────────────────────────
  const loadVolume = useCallback(async () => {
    if (!VOLUME_DEPLOYED) return
    setLoadingVolume(true)
    try {
      const p = getProvider()
      const vc = new ethers.Contract(ACUA_VOLUME_REWARDS, VOLUME_REWARDS_ABI, p)
      const [uth2Amount, userVolume, tierStatus] = await vc.pendingNow(userAddress)
      const monthId = await vc.currentMonth()
      setVolumeData({
        uth2Amount: BigInt(uth2Amount.toString()),
        userVolume: BigInt(userVolume.toString()),
        tierStatus: Array.from(tierStatus).map((v: any) => Number(v)),
        monthId: BigInt(monthId.toString()),
      })
    } catch (e) { console.error('[Volume]', e) }
    finally { setLoadingVolume(false) }
  }, [userAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (volumeOpen) loadVolume() }, [volumeOpen, loadVolume])

  // ── Claim volume rewards ─────────────────────────────────────────────────────
  const doClaimVolume = useCallback(async () => {
    if (!volumeData || volumeData.uth2Amount === 0n) return
    setClaimingVol(true); setVolMsg(null)
    try {
      const CLAIM_ABI = [{ name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'monthId', type: 'uint256' }], outputs: [] }]
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_VOLUME_REWARDS, abi: CLAIM_ABI,
          functionName: 'claimRewards', args: [volumeData.monthId.toString()] }]
      })
      if (finalPayload.status === 'success') {
        setVolMsg({ ok: true, text: `✓ ${ethers.formatEther(volumeData.uth2Amount)} UTH2 reclamado!` })
        setTimeout(loadVolume, 2000)
      } else {
        setVolMsg({ ok: false, text: 'Transacción cancelada' })
      }
    } catch (e: any) {
      setVolMsg({ ok: false, text: e?.message ?? 'Error' })
    } finally { setClaimingVol(false) }
  }, [volumeData, loadVolume])

  // ── Swap via AcuaSwapRouter (fees on-chain, Permit2 AllowanceTransfer) ───────
  const doSwap = useCallback(async () => {
    if (!fromAmt || !quote) return
    setSwapping(true); setSwapMsg(null)
    try {
      const rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals)
      const minOut = quote.amountOut * BigInt(10000 - slippage) / 10000n

      // USDC equivalent for volume tracking (6 decimals)
      const priceUsd = prices[fromToken.address.toLowerCase()] ?? 0
      const floatAmt = parseFloat(ethers.formatUnits(rawAmt, fromToken.decimals))
      const usdcEquiv = BigInt(Math.floor(floatAmt * priceUsd * 1_000_000))

      // Permit2 expiration: 24 hours from now (uint48)
      const expiration = Math.floor(Date.now() / 1000) + 86400

      // Batch:
      // 1. ERC20 max-approve Permit2 (idempotent — safe to always include)
      // 2. Permit2.approve(token, AcuaSwapRouter, amount, expiration)
      // 3. AcuaSwapRouter.swapV3 or swapV2
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
          args: [fromToken.address, ACUA_SWAP_ROUTER, rawAmt.toString(), expiration.toString()],
        },
      ]

      if (quote.source === 'v2-direct' || quote.source === 'v2-multihop') {
        // SushiSwap V2 path
        txs.push({
          address: ACUA_SWAP_ROUTER,
          abi: ACUA_SWAP_V2_ABI,
          functionName: 'swapV2',
          args: [
            fromToken.address, toToken.address,
            rawAmt.toString(), minOut.toString(),
            quote.v2Path!, usdcEquiv.toString(),
          ],
        })
      } else {
        // Uniswap V3 path (single-hop or multi-hop)
        const v3Path = quote.v3Path ?? ethers.solidityPacked(
          ['address', 'uint24', 'address'],
          [fromToken.address, quote.fee, toToken.address]
        )
        txs.push({
          address: ACUA_SWAP_ROUTER,
          abi: ACUA_SWAP_V3_ABI,
          functionName: 'swapV3',
          args: [
            fromToken.address, toToken.address,
            rawAmt.toString(), minOut.toString(),
            v3Path, usdcEquiv.toString(),
          ],
        })
      }

      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({ transaction: txs })
      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        setSwapMsg({ ok: true, text: txId ? `✓ Tx: ${txId.slice(0, 16)}…` : '✓ Swap ejecutado' })
        setFromAmt(''); setQuote(null)
        setTimeout(() => { loadBalances(); if (VOLUME_DEPLOYED) loadVolume() }, 3000)
      } else {
        setSwapMsg({ ok: false, text: (finalPayload as any).message ?? 'Transacción rechazada' })
      }
    } catch (e: any) {
      setSwapMsg({ ok: false, text: e?.message ?? 'Error desconocido' })
    } finally { setSwapping(false) }
  }, [fromAmt, quote, fromToken, toToken, slippage, userAddress, prices, loadBalances, loadVolume]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add custom token ─────────────────────────────────────────────────────────
  const addToken = useCallback(async () => {
    const addr = addAddr.trim()
    if (!ethers.isAddress(addr)) return setAddMsg('Dirección inválida')
    if (allTokens.find(t => t.address.toLowerCase() === addr.toLowerCase())) return setAddMsg('Token ya existe')
    setAddLoading(true); setAddMsg('')
    const meta = await fetchTokenMeta(addr)
    if (!meta) { setAddLoading(false); return setAddMsg('No se pudo leer el token') }
    const newToken: TokenItem = { ...meta, address: addr, color: '#94a3b8', isCustom: true }
    const updated = [...customTokens, newToken]
    setCustomTokens(updated)
    lsSet(LS_CUSTOMS, JSON.stringify(updated))
    setAddAddr(''); setAddMsg(`✓ ${meta.symbol} agregado`)
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
  const TOTAL_FEE_BPS = 210 // 2% swap + 0.1% H2O = 2.1%
  const fromAmtNum = parseFloat(fromAmt || '0')
  const feeAmtDisplay = isNaN(fromAmtNum) ? '0' : (fromAmtNum * TOTAL_FEE_BPS / 10000).toFixed(6)

  // ── Render ───────────────────────────────────────────────────────────────────
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
            <p className="text-xs text-muted-foreground">Uniswap V3 · SushiSwap V2 · World Chain</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={loadBalances} disabled={loadingBal} className="text-muted-foreground hover:text-foreground">
            <RefreshCw className={cn('w-4 h-4', loadingBal && 'animate-spin')} />
          </button>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setView('wallet')}
              className={cn('px-3 py-1 text-xs font-medium transition-colors', view === 'wallet' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            ><Wallet className="w-3.5 h-3.5 inline mr-1" />Tokens</button>
            <button
              onClick={() => setView('swap')}
              className={cn('px-3 py-1 text-xs font-medium transition-colors', view === 'swap' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
            ><Repeat2 className="w-3.5 h-3.5 inline mr-1" />Swap</button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════ WALLET VIEW ════════════════════════════ */}
      {view === 'wallet' && (
        <div className="space-y-2">
          {/* Total portfolio value */}
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
                <p className="text-2xl font-bold font-mono text-primary">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            ) : null
          })()}

          {/* Token cards */}
          <div className="space-y-2">
            {loadingBal && Object.keys(balances).length === 0 && (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            )}
            {allTokens.map(token => {
              const bal = getBalance(token)
              const usd = getUsdVal(token, bal)
              const price = prices[token.address.toLowerCase()]
              return (
                <div
                  key={token.address}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface-2 hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => { setFromToken(token); setView('swap') }}
                >
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
              <Plus className="w-3 h-3" /> Agregar token por dirección
            </p>
            <div className="flex gap-2">
              <input
                value={addAddr}
                onChange={e => setAddAddr(e.target.value)}
                placeholder="0x... dirección del token"
                className="flex-1 min-w-0 text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
              />
              <Button size="sm" className="text-xs h-8 shrink-0" onClick={addToken} disabled={addLoading}>
                {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>
            {addMsg && (
              <p className={cn('text-xs font-medium', addMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════ SWAP VIEW ══════════════════════════════ */}
      {view === 'swap' && (
        <div className="space-y-3">
          {/* Fee info bar */}
          <div className="flex items-center justify-between text-xs text-muted-foreground bg-surface-2 rounded-lg px-3 py-2 border border-border">
            <span className="flex items-center gap-1">
              <Coins className="w-3 h-3" />
              Comisión: <strong className="text-foreground">2%</strong>
              <span className="text-muted-foreground/60">+ 0.1% H2O</span>
              {routerDeployed
                ? <span className="text-green-400 text-[9px] ml-1">on-chain</span>
                : <span className="text-yellow-400 text-[9px] ml-1">pendiente deploy</span>
              }
            </span>
            {quote && <SourceBadge source={quote.source} hopLabel={quote.hopLabel} />}
          </div>

          {/* From token */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">De</span>
              <button
                onClick={() => setFromAmt(ethers.formatUnits(getBalance(fromToken), fromToken.decimals))}
                className="text-xs text-primary hover:underline font-mono"
              >
                Saldo: {formatToken(getBalance(fromToken), fromToken.decimals, 4)}
              </button>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setPickerFor('from')}
                className="flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 hover:border-primary/40 transition-colors shrink-0"
              >
                <TokenLogo token={fromToken} size="xs" />
                <span className="text-xs font-bold">{fromToken.symbol}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              </button>
              <input
                type="number"
                min="0"
                step="any"
                value={fromAmt}
                onChange={e => setFromAmt(e.target.value)}
                placeholder="0.0"
                className="flex-1 min-w-0 bg-transparent text-right text-xl font-mono font-bold text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
            </div>
            {fromAmt && parseFloat(fromAmt) > 0 && prices[fromToken.address.toLowerCase()] && (
              <p className="text-xs text-muted-foreground text-right">
                ≈ ${(parseFloat(fromAmt) * prices[fromToken.address.toLowerCase()]).toFixed(2)} USD
              </p>
            )}
          </div>

          {/* Flip button */}
          <div className="flex justify-center">
            <button
              onClick={() => { setFromToken(toToken); setToToken(fromToken); setFromAmt(''); setQuote(null) }}
              className="w-9 h-9 rounded-full border border-border bg-surface-2 flex items-center justify-center hover:border-primary/40 hover:bg-primary/10 transition-colors"
            >
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
              <button
                onClick={() => setPickerFor('to')}
                className="flex items-center gap-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 hover:border-primary/40 transition-colors shrink-0"
              >
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

          {/* Fee breakdown */}
          {fromAmt && parseFloat(fromAmt) > 0 && (
            <div className="rounded-lg border border-border bg-surface-2/50 p-2.5 space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Comisión 2% (owners) + 0.1% → H2O</span>
                <span className="font-mono">{feeAmtDisplay} {fromToken.symbol}</span>
              </div>
              {quote && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Slippage máx.</span>
                  <span>{(slippage / 100).toFixed(1)}%</span>
                </div>
              )}
            </div>
          )}

          {/* Slippage selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Slippage:</span>
            {[25, 50, 100].map(s => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                className={cn('text-xs px-2 py-1 rounded border transition-colors', slippage === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40')}
              >{(s / 100).toFixed(1)}%</button>
            ))}
          </div>

          {/* No quote warning */}
          {fromAmt && parseFloat(fromAmt) > 0 && !quoting && !quote && (
            <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
              <p className="text-xs text-yellow-400">Sin liquidez en Uniswap V3 ni SushiSwap V2 para este par</p>
            </div>
          )}

          {/* Swap button */}
          <Button
            className="w-full h-12 text-base font-semibold"
            onClick={doSwap}
            disabled={swapping || !quote || !fromAmt || parseFloat(fromAmt) <= 0}
          >
            {swapping ? <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Ejecutando swap…</> : 'Swap'}
          </Button>

          {swapMsg && (
            <p className={cn('text-xs text-center font-medium font-mono', swapMsg.ok ? 'text-green-400' : 'text-red-400')}>
              {swapMsg.text}
            </p>
          )}

          {/* Add custom token in swap view */}
          <div className="rounded-xl border border-border bg-surface-2 p-3 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Plus className="w-3 h-3" /> Agregar token personalizado
            </p>
            <div className="flex gap-2">
              <input
                value={addAddr}
                onChange={e => setAddAddr(e.target.value)}
                placeholder="0x... dirección del token"
                className="flex-1 min-w-0 text-xs bg-background border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/60 transition-colors font-mono"
              />
              <Button size="sm" className="text-xs h-8 shrink-0" onClick={addToken} disabled={addLoading}>
                {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>
            {addMsg && <p className={cn('text-xs font-medium', addMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>}
          </div>
        </div>
      )}

      {/* ─── Volume Rewards Panel ──────────────────────────────────────────────── */}
      {VOLUME_DEPLOYED && (
        <div className="rounded-2xl border border-teal-500/20 bg-gradient-to-br from-teal-950/30 to-cyan-900/20 overflow-hidden">
          <button
            onClick={() => setVolumeOpen(v => !v)}
            className="w-full flex items-center justify-between p-3.5"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-teal-400" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-teal-300">Rewards por Volumen</p>
                  {volumeData && volumeData.uth2Amount > 0n && (
                    <span className="text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full animate-pulse">
                      RECLAMAR
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Haz swap · Gana UTH2 mensual</p>
              </div>
            </div>
            {volumeOpen
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>

          {volumeOpen && (
            <div className="px-4 pb-4 pt-1 border-t border-border/50 space-y-3">
              {loadingVolume ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
                </div>
              ) : volumeData ? (() => {
                const TIERS = [
                  { usdc: '1', uth2: '0.0001' },
                  { usdc: '10', uth2: '0.001' },
                  { usdc: '100', uth2: '0.01' },
                  { usdc: '1,000', uth2: '0.1' },
                ]
                const volUsd = Number(volumeData.userVolume) / 1_000_000
                const maxTier = 1_000_000_000 // $1000 USDC in 6-dec
                const pct = Math.min(100, (Number(volumeData.userVolume) / maxTier) * 100)
                return (
                  <div className="space-y-3">
                    {/* Volume this month */}
                    <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-muted-foreground">Volumen este mes</p>
                        <p className="text-sm font-bold font-mono text-teal-300">${volUsd.toFixed(2)} USDC</p>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-teal-500 to-cyan-400 rounded-full transition-all duration-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    {/* Tiers */}
                    <div className="grid grid-cols-2 gap-2">
                      {TIERS.map((t, i) => {
                        const status = volumeData.tierStatus[i]
                        return (
                          <div key={i} className={cn(
                            'rounded-xl p-2.5 border text-center',
                            status === 2 ? 'border-green-500/30 bg-green-500/5' :
                            status === 1 ? 'border-teal-500/40 bg-teal-500/10 animate-pulse' :
                            'border-white/5 bg-black/20'
                          )}>
                            <p className="text-[10px] text-muted-foreground">${t.usdc} USDC</p>
                            <p className={cn('text-xs font-bold font-mono',
                              status === 2 ? 'text-green-400 line-through' :
                              status === 1 ? 'text-teal-300' : 'text-muted-foreground/50'
                            )}>{t.uth2} UTH2</p>
                            {status === 2 && <p className="text-[9px] text-green-400">✓ cobrado</p>}
                            {status === 1 && <p className="text-[9px] text-teal-400">reclamable</p>}
                          </div>
                        )
                      })}
                    </div>

                    {/* Claim button */}
                    {volumeData.uth2Amount > 0n ? (
                      <div className="bg-teal-500/10 border border-teal-500/30 rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-teal-400 font-semibold">Disponible para reclamar</p>
                          <p className="text-base font-bold text-teal-300 font-mono">
                            {ethers.formatEther(volumeData.uth2Amount)} UTH2
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="bg-teal-600 hover:bg-teal-500 text-white"
                          onClick={doClaimVolume}
                          disabled={claimingVol}
                        >
                          {claimingVol
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <><Gift className="w-3.5 h-3.5 mr-1" />Reclamar</>
                          }
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-center text-muted-foreground py-1">
                        Haz swaps para acumular volumen y ganar UTH2 🏆
                      </p>
                    )}

                    {volMsg && (
                      <p className={cn('text-xs text-center font-medium', volMsg.ok ? 'text-green-400' : 'text-red-400')}>
                        {volMsg.text}
                      </p>
                    )}

                    <button onClick={loadVolume} className="text-xs text-muted-foreground hover:text-teal-400 flex items-center gap-1 mx-auto">
                      <RefreshCw className="w-3 h-3" /> Actualizar
                    </button>
                  </div>
                )
              })() : (
                <p className="text-xs text-center text-muted-foreground py-2">Error cargando datos</p>
              )}
            </div>
          )}
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
