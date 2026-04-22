'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { MiniKit } from '@worldcoin/minikit-js'
import { ethers } from 'ethers'
import {
  ArrowUpDown, RefreshCw, Plus, ChevronDown, Loader2, Search,
  X, Wallet, ChevronUp, AlertCircle, Repeat2, Clock,
  TrendingUp, TrendingDown, Coins, Award, Check, Zap, ShieldAlert,
  Sparkles, ArrowRight, BarChart2, Gift, AlertTriangle,
  ArrowDownToLine, ArrowUpFromLine, Droplets, Activity,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TOKENS, getProvider, ERC20_ABI, formatToken, randomNonce,
} from '@/lib/new-contracts'
import { cn } from '@/lib/utils'

// ─── Contracts ────────────────────────────────────────────────────────────────
const ACUA_SWAP_ROUTER    = '0xA2FD6cd36a661E270FC7AdaA82D0d22f4660706d'
const ACUA_VOLUME_REWARDS = '0xc74D6B65f8E30E040CE744117228118d107f77f1'

// ─── Constants ────────────────────────────────────────────────────────────────
// 50% slippage tolerance — allows swaps with any amount regardless of market conditions
const SLIPPAGE_BPS    = 5000
const ACUA_FEE_BPS    = 210   // 2.1% total fee (2% to owner + 0.1% H2O buyback via WLD)
const IMPACT_WARN_BPS = 300   // yellow warning >3%
const IMPACT_HIGH_BPS = 1500  // red warning >15%
const QUOTE_TTL_MS    = 25000

const WETH_ADDR = '0x4200000000000000000000000000000000000006'

// ─── MiniKit error code → friendly Spanish message ────────────────────────────
const TX_ERROR_MESSAGES: Record<string, string> = {
  user_rejected:                     'Cancelaste la transacción.',
  simulation_failed:                 'La simulación falló en World App. Intenta con un monto menor o cambia el par.',
  input_error:                       'Datos de transacción inválidos. Intenta de nuevo.',
  generic_error:                     'Error inesperado. Intenta de nuevo.',
  invalid_contract:                  'Contrato no reconocido por World App. Verifica el portal de desarrollador.',
  disallowed_operation:              'Contrato no autorizado en el portal de World App. Agrega los contratos en developer.worldcoin.org.',
  malicious_operation:               'Operación bloqueada por seguridad de World App.',
  daily_tx_limit_reached:            'Límite diario de transacciones alcanzado. Intenta mañana.',
  validation_error:                  'Error de validación. Verifica el monto e intenta de nuevo.',
  transaction_failed:                'La transacción falló en cadena. Puede ser slippage o liquidez insuficiente.',
  permitted_amount_exceeds_slippage: 'El monto supera el límite de slippage. Intenta de nuevo.',
  permitted_amount_not_found:        'Permiso de Permit2 no encontrado. Intenta de nuevo.',
  invalid_operation:                 'Operación inválida. Verifica los parámetros del swap.',
  unauthorized:                      'No autorizado. Verifica que los contratos estén registrados en World App.',
  timeout:                           'Tiempo de espera agotado. Intenta de nuevo.',
  network_error:                     'Error de red. Verifica tu conexión e intenta de nuevo.',
}

function parseMiniKitTxError(payload: any): string {
  if (!payload) return 'Sin respuesta de World App. Intenta de nuevo.'
  const code: string = payload.error_code ?? payload.errorCode ?? ''
  if (code && TX_ERROR_MESSAGES[code]) return TX_ERROR_MESSAGES[code]

  const details = payload.details
  if (details) {
    if (typeof details === 'string' && details.length > 0) {
      if (details.includes('Too much slippage')) return 'Slippage excedido. Confirma para continuar con el swap.'
      if (details.includes('Bad amount')) return 'Monto inválido para el contrato.'
      if (details.includes('No active swap')) return 'Error interno de callback. Intenta de nuevo.'
      if (details.includes('insufficient')) return 'Liquidez insuficiente en este par.'
      if (details.includes('allowance')) return 'Permiso insuficiente. Intenta de nuevo.'
      return details
    }
    if (typeof details === 'object') {
      try { const str = JSON.stringify(details); if (str !== '{}') return str } catch { /* skip */ }
    }
  }

  if (typeof payload.message === 'string' && payload.message.length > 0) return payload.message
  if (typeof payload.reason === 'string' && payload.reason.length > 0) return payload.reason
  if (code) return `Error de World App: ${code}`
  return 'Transacción no completada. Intenta de nuevo.'
}

// ─── Fee tiers ────────────────────────────────────────────────────────────────
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
  { symbol: 'WLD',      name: 'Worldcoin',      address: TOKENS.WLD,                                         decimals: 18, color: '#3b82f6', logoUri: TOKEN_LOGOS.WLD  },
  { symbol: 'H2O',      name: 'H2O Token',      address: TOKENS.H2O,                                         decimals: 18, color: '#06b6d4' },
  { symbol: 'USDC',     name: 'USD Coin',        address: TOKENS.USDC,                                        decimals: 6,  color: '#2563eb', logoUri: TOKEN_LOGOS.USDC },
  { symbol: 'WETH',     name: 'Wrapped ETH',     address: WETH_ADDR,                                          decimals: 18, color: '#627eea' },
  { symbol: 'WBTC',     name: 'Wrapped BTC',     address: '0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3',      decimals: 8,  color: '#f7931a' },
  { symbol: 'EURC',     name: 'Euro Coin',       address: '0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B',      decimals: 6,  color: '#2a6fdb' },
  { symbol: 'FIRE',     name: 'Fire Token',      address: TOKENS.FIRE,                                        decimals: 18, color: '#f97316' },
  { symbol: 'wCOP',     name: 'wCOP',            address: TOKENS.wCOP,                                        decimals: 18, color: '#f59e0b' },
  { symbol: 'wARS',     name: 'wARS',            address: TOKENS.wARS,                                        decimals: 18, color: '#10b981' },
  { symbol: 'wBRL',     name: 'Wrapped BRL',     address: '0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0',      decimals: 18, color: '#22c55e' },
  { symbol: 'BTCH2O',   name: 'BTC H2O',         address: TOKENS.BTCH2O,                                      decimals: 18, color: '#f59e0b' },
  { symbol: 'AIR',      name: 'AIR Token',       address: TOKENS.AIR,                                         decimals: 18, color: '#8b5cf6' },
  { symbol: 'UTH2',     name: 'UTH2',            address: TOKENS.UTH2,                                        decimals: 18, color: '#a78bfa' },
  { symbol: 'oXAUT',    name: 'Ounce of Gold',   address: '0x30974f73A4ac9E606Ed80da928e454977ac486D2',      decimals: 6,  color: '#d4af37' },
  { symbol: 'ORO',      name: 'ORO Token',       address: '0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63',      decimals: 18, color: '#f5c518' },
  { symbol: 'WDD',      name: 'WDD Token',       address: '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B',      decimals: 18, color: '#64748b' },
  { symbol: 'ORB',      name: 'ORB Token',       address: '0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB',      decimals: 18, color: '#7c3aed' },
  { symbol: 'PUF',      name: 'PUF Token',       address: '0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3',      decimals: 18, color: '#ec4899' },
  { symbol: 'uDOGE',    name: 'Uni DOGE',        address: '0x12E96C2BFEA6E835CF8Dd38a5834fa61Cf723736',      decimals: 18, color: '#c2a633' },
  { symbol: 'uSOL',     name: 'Uni SOL',         address: '0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55',      decimals: 18, color: '#9945ff' },
  { symbol: 'VIBE',     name: 'VIBE Token',      address: '0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1',      decimals: 18, color: '#f472b6' },
  { symbol: 'DIAMANTE', name: 'Diamante',        address: '0x2ba918fec90Ca7AaC5753a2551593470815866e6',      decimals: 18, color: '#67e8f9' },
  { symbol: 'BILLBOARD',name: 'Billboard',       address: '0x7a8892E9687704F7BE8C26dfC5e51B6A86c8098B',      decimals: 18, color: '#fb923c' },
  { symbol: 'Cash',     name: 'Cash Token',      address: '0xbfdA4F50a2d5B9b864511579D7dfa1C72f118575',      decimals: 18, color: '#4ade80' },
  { symbol: 'AION',     name: 'AION Token',      address: '0x26064DD7821f351202c61f0deB97678eef265E36',      decimals: 18, color: '#38bdf8' },
  { symbol: 'SAMA',     name: 'SAMA Token',      address: '0x24e2f756AF6558818083E78B1205D156542bCe80',      decimals: 18, color: '#e879f9' },
  { symbol: 'APE',      name: 'APE Token',       address: '0x13e20981D9bd3dC45e99802f06488C5AD7c28360',      decimals: 18, color: '#3b82f6' },
  { symbol: 'GFY',      name: 'GFY Token',       address: '0x6A7B33B8A7f7B3535dc832ECD147F6dEC8A8e8Cf',      decimals: 18, color: '#f87171' },
  { symbol: 'VEN',      name: 'VEN Token',       address: '0x1191a54c53DBe8487c3A258C2A4a84aAe7E936F5',      decimals: 18, color: '#34d399' },
  {
  symbol: 'TIME',
  name: 'TIME Token',
  address: '0x212d7448720852D8Ad282a5d4A895B3461F9076E',
  decimals: 18,
  color: '#f5b041'
  },
  {
  symbol: 'SUSHI',
  name: 'SUSHI Token',
  address: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38',
  decimals: 18,
  color: '#fa52a0'
},
]

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const PERMIT_STRUCT = {
  name: 'permit', type: 'tuple',
  components: [
    { name: 'permitted', type: 'tuple', components: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ]},
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}
const SWAP_SINGLE_ABI = [{
  name: 'swapV3Single', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'tokenOut', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'amountOutMin', type: 'uint256' },
    { name: 'usdcEquivalent', type: 'uint256' },
    PERMIT_STRUCT,
    { name: 'signature', type: 'bytes' },
  ],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}]
const SWAP_MULTI_ABI = [{
  name: 'swapV3Multi', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'hopToken', type: 'address' },
    { name: 'tokenOut', type: 'address' },
    { name: 'fee1', type: 'uint24' },
    { name: 'fee2', type: 'uint24' },
    { name: 'amountOutMin', type: 'uint256' },
    { name: 'usdcEquivalent', type: 'uint256' },
    PERMIT_STRUCT,
    { name: 'signature', type: 'bytes' },
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
  'function totalDistributed() view returns (uint256)',
  'event VolumeRecorded(address indexed user, uint256 indexed monthId, uint256 added, uint256 total)',
  'event RewardClaimed(address indexed user, uint256 indexed monthId, uint256 uth2Amount)',
]
const CLAIM_ABI = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'monthId', type: 'uint256' }], outputs: [],
}]
const POOL_LIQUIDITY_ABI = ['function liquidity() view returns (uint128)']

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

// ─── Enhanced price feed: USD + WLD-bridge pricing ───────────────────────────
const CG_IDS: Record<string, string> = {
  [TOKENS.WLD.toLowerCase()]:  'worldcoin-wld',
  [TOKENS.USDC.toLowerCase()]: 'usd-coin',
}

// World Chain identifiers used by DexScreener
const WORLDCHAIN_IDS = new Set(['worldchain', 'worldchain-mainnet', 'world-chain', 'worldcoin'])

// Minimum liquidity (USD) for a pair to be trusted for price discovery
const MIN_PAIR_LIQ_USD = 500

// Score a pair by quote token quality: USDC > WLD > WETH > others
function pairScore(quoteAddr: string): number {
  const q = quoteAddr.toLowerCase()
  if (q === TOKENS.USDC.toLowerCase()) return 3
  if (q === TOKENS.WLD.toLowerCase())  return 2
  if (q === WETH_ADDR.toLowerCase())   return 1
  return 0
}

// Fetch DexScreener in batches of 29 addresses, filter to World Chain + min liq
async function dexScreenerPrices(addresses: string[]): Promise<Record<string, number>> {
  const best: Record<string, { price: number; liq: number; score: number }> = {}

  // Batch into chunks of 29 (safe margin under 30 limit)
  const chunks: string[][] = []
  for (let i = 0; i < addresses.length; i += 29) chunks.push(addresses.slice(i, i + 29))

  await Promise.allSettled(chunks.map(async chunk => {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`,
        { signal: AbortSignal.timeout(6000) }
      )
      const data = await res.json()
      if (!Array.isArray(data.pairs)) return

      for (const pair of data.pairs) {
        // Only accept World Chain pairs — filters cross-chain price pollution
        const chainId: string = (pair.chainId ?? '').toLowerCase()
        if (!WORLDCHAIN_IDS.has(chainId)) continue

        const addr  = pair.baseToken?.address?.toLowerCase()
        const priceUsdStr = pair.priceUsd
        if (!addr || !priceUsdStr) continue

        const p    = parseFloat(priceUsdStr)
        const liq  = parseFloat(pair.liquidity?.usd ?? '0')

        // Skip dust/dead pools — require at least $500 liquidity
        if (liq < MIN_PAIR_LIQ_USD) continue
        // Skip clearly stale/broken price (negative or zero)
        if (!p || p <= 0) continue

        const score = pairScore(pair.quoteToken?.address ?? '')

        const cur = best[addr]
        // Prefer higher pair quality (USDC quote), then higher liquidity
        if (!cur || score > cur.score || (score === cur.score && liq > cur.liq)) {
          best[addr] = { price: p, liq, score }
        }
      }
    } catch {}
  }))

  const result: Record<string, number> = {}
  for (const [addr, v] of Object.entries(best)) result[addr] = v.price
  return result
}

// Returns { usdPrices, wldPrices } for all tokens
// - usdPrices: token address (lower) → USD price
// - wldPrices: token address (lower) → price expressed in WLD (how many WLD = 1 token)
async function fetchAllTokenPrices(tokens: TokenItem[]): Promise<{
  usdPrices: Record<string, number>
  wldPrices: Record<string, number>
}> {
  const usdPrices: Record<string, number> = {}
  const wldPrices: Record<string, number> = {}
  const addresses = tokens.map(t => t.address)

  // ── 1. Hardcode stablecoins ───────────────────────────────────────────────
  usdPrices[TOKENS.USDC.toLowerCase()] = 1.0
  // EURC ≈ $1.08 (Euro stablecoin) — good fallback; will be overridden by live price
  const eurcAddr = '0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B'.toLowerCase()
  usdPrices[eurcAddr] = 1.08

  // ── 2. CoinGecko for WLD & USDC (most reliable) ──────────────────────────
  const cgAddrs = addresses.filter(a => CG_IDS[a.toLowerCase()])
  if (cgAddrs.length > 0) {
    try {
      const ids = [...new Set(cgAddrs.map(a => CG_IDS[a.toLowerCase()]))]
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(5000) }
      )
      const data = await res.json()
      for (const addr of cgAddrs) {
        const id = CG_IDS[addr.toLowerCase()]
        if (data[id]?.usd) usdPrices[addr.toLowerCase()] = data[id].usd
      }
    } catch {}
  }

  // ── 3. DexScreener — World Chain only, min $500 liquidity ─────────────────
  const dsResult = await dexScreenerPrices(addresses)
  for (const [addr, price] of Object.entries(dsResult)) {
    // DexScreener overrides stablecoin fallbacks only if it has a real WC pair
    if (!usdPrices[addr] || (addr !== TOKENS.USDC.toLowerCase())) {
      usdPrices[addr] = price
    }
  }

  // ── 4. Derive WLD prices from USD prices ─────────────────────────────────
  const wldUsd = usdPrices[TOKENS.WLD.toLowerCase()] ?? 0
  if (wldUsd > 0) {
    wldPrices[TOKENS.WLD.toLowerCase()] = 1.0
    for (const addr of addresses) {
      const addrL = addr.toLowerCase()
      if (addrL === TOKENS.WLD.toLowerCase()) continue
      const tokenUsd = usdPrices[addrL]
      if (tokenUsd && tokenUsd > 0) wldPrices[addrL] = tokenUsd / wldUsd
    }
  }

  // ── 5. On-chain bridge-quote fallback for tokens with no price yet ────────
  // Tries BOTH WLD and USDC as bridge tokens with permissive liquidity so
  // tokens with smaller pools still get a visible price. Picks the deepest
  // pool across all (bridge, fee) combinations.
  const decimalsMap = new Map(tokens.map(t => [t.address.toLowerCase(), t.decimals]))
  const missing = addresses.filter(a => !usdPrices[a.toLowerCase()])
  if (missing.length > 0 && (wldUsd > 0 || usdPrices[TOKENS.USDC.toLowerCase()] > 0)) {
    const provider = getProvider()
    const router   = new ethers.Contract(ACUA_SWAP_ROUTER, ROUTER_QUOTE_ABI, provider)
    const poolAbi  = ['function liquidity() view returns (uint128)']
    // Permissive threshold for *price discovery only* — swap routing still
    // uses MIN_SWAP_POOL_LIQ. 1e9 keeps out completely empty pools while
    // letting low-cap tokens display a price.
    const MIN_PRICE_LIQ = 1_000_000_000n // 1e9

    const usdcUsd = usdPrices[TOKENS.USDC.toLowerCase()] ?? 1.0
    const bridges: { addr: string; oneUnit: bigint; usd: number }[] = []
    if (wldUsd > 0)  bridges.push({ addr: TOKENS.WLD,  oneUnit: ethers.parseUnits('1', 18), usd: wldUsd })
    if (usdcUsd > 0) bridges.push({ addr: TOKENS.USDC, oneUnit: ethers.parseUnits('1', 6),  usd: usdcUsd })

    await Promise.allSettled(missing.map(async tokenAddr => {
      const tokenL   = tokenAddr.toLowerCase()
      const decimals = decimalsMap.get(tokenL) ?? 18

      // Track the best (deepest-liquidity) quote across bridge+fee combos
      let bestPriceUsd = 0
      let bestLiq      = 0n
      let bestBridgeUsd = 0
      let bestTokensPerBridge = 0

      await Promise.all(bridges.flatMap(({ addr: bridge, oneUnit, usd: bridgeUsd }) =>
        FEE_TIERS.map(async fee => {
          try {
            const [rawOut, poolAddr] = await router.quoteSingle(bridge, tokenAddr, fee, oneUnit)
            const out = BigInt(rawOut.toString())
            if (out === 0n) return
            try {
              const pool = new ethers.Contract(poolAddr, poolAbi, provider)
              const liq  = BigInt((await pool.liquidity()).toString())
              if (liq < MIN_PRICE_LIQ) return
              if (liq <= bestLiq) return
              const tokensPerBridge = parseFloat(ethers.formatUnits(out.toString(), decimals))
              if (tokensPerBridge <= 0) return
              bestLiq             = liq
              bestBridgeUsd       = bridgeUsd
              bestTokensPerBridge = tokensPerBridge
              bestPriceUsd        = bridgeUsd / tokensPerBridge
            } catch { return }
          } catch { return }
        })
      ))

      if (bestPriceUsd > 0) {
        usdPrices[tokenL] = bestPriceUsd
        if (wldUsd > 0) wldPrices[tokenL] = bestPriceUsd / wldUsd
      }
      void bestBridgeUsd; void bestTokensPerBridge
    }))
  }

  return { usdPrices, wldPrices }
}

// ─── Fresh single-token price — called at swap execution time ─────────────────
// Always queries DexScreener live so the usdcEquivalent for volume tracking
// is accurate even if the cached price state is stale or missing.
async function fetchFreshTokenPrice(token: TokenItem): Promise<number> {
  // Stablecoins: never call network
  const addrL = token.address.toLowerCase()
  if (addrL === TOKENS.USDC.toLowerCase()) return 1.0
  if (addrL === '0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B'.toLowerCase()) return 1.08 // EURC

  let bestPrice = 0
  let bestLiq   = 0
  let bestScore = -1

  // 1. DexScreener — World Chain only, min $500 liq
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${token.address}`,
      { signal: AbortSignal.timeout(5000) }
    )
    const data = await res.json()
    if (Array.isArray(data.pairs)) {
      for (const pair of data.pairs) {
        const chainId = (pair.chainId ?? '').toLowerCase()
        if (!WORLDCHAIN_IDS.has(chainId)) continue

        const p   = parseFloat(pair.priceUsd ?? '0')
        const liq = parseFloat(pair.liquidity?.usd ?? '0')
        if (!p || p <= 0 || liq < MIN_PAIR_LIQ_USD) continue

        const score = pairScore(pair.quoteToken?.address ?? '')
        if (score > bestScore || (score === bestScore && liq > bestLiq)) {
          bestPrice = p; bestLiq = liq; bestScore = score
        }
      }
    }
  } catch {}

  if (bestPrice > 0) return bestPrice

  // 2. On-chain bridge quote fallback (WLD or USDC). Permissive liquidity
  // because this is for *display + volume tracking* only.
  try {
    const provider = getProvider()
    const router   = new ethers.Contract(ACUA_SWAP_ROUTER, ROUTER_QUOTE_ABI, provider)
    const poolAbi  = ['function liquidity() view returns (uint128)']

    let wldUsd = 0
    try {
      const wldRes  = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${TOKENS.WLD}`,
        { signal: AbortSignal.timeout(4000) }
      )
      const wldData = await wldRes.json()
      if (Array.isArray(wldData.pairs)) {
        let wldLiq = 0
        for (const pair of wldData.pairs) {
          if (!WORLDCHAIN_IDS.has((pair.chainId ?? '').toLowerCase())) continue
          const p   = parseFloat(pair.priceUsd ?? '0')
          const liq = parseFloat(pair.liquidity?.usd ?? '0')
          if (p > 0 && liq >= MIN_PAIR_LIQ_USD && liq > wldLiq) { wldUsd = p; wldLiq = liq }
        }
      }
    } catch {}

    const bridges: { addr: string; oneUnit: bigint; usd: number }[] = []
    if (wldUsd > 0) bridges.push({ addr: TOKENS.WLD,  oneUnit: ethers.parseUnits('1', 18), usd: wldUsd })
    bridges.push({ addr: TOKENS.USDC, oneUnit: ethers.parseUnits('1', 6),  usd: 1.0 })

    let bestPx = 0
    let topLiq = 0n
    await Promise.all(bridges.flatMap(({ addr: bridge, oneUnit, usd: bridgeUsd }) =>
      FEE_TIERS.map(async fee => {
        try {
          const [rawOut, poolAddr] = await router.quoteSingle(bridge, token.address, fee, oneUnit)
          const out = BigInt(rawOut.toString())
          if (out === 0n) return
          try {
            const pool = new ethers.Contract(poolAddr, poolAbi, provider)
            const liq  = BigInt((await pool.liquidity()).toString())
            if (liq < 1_000_000_000n) return // 1e9 min
            if (liq <= topLiq) return
            const tokensPerBridge = parseFloat(ethers.formatUnits(out.toString(), token.decimals))
            if (tokensPerBridge <= 0) return
            topLiq = liq
            bestPx = bridgeUsd / tokensPerBridge
          } catch { return }
        } catch { return }
      })
    ))
    if (bestPx > 0) return bestPx
  } catch {}

  return 0 // price unknown — volume will be recorded as 0
}

// ─── Pool liquidity check ─────────────────────────────────────────────────────
// Minimum liquidity for swap routing — filters dead/ghost pools
// Uniswap V3 liquidity() is in virtual units; 1e10 is tiny but distinguishes
// real pools from completely empty ones. Price feed uses a much higher threshold.
const MIN_SWAP_POOL_LIQ = 10_000_000_000n // 1e10

async function tryQuoteSingle(
  router: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  tokenIn: string, tokenOut: string, fee: number, amtIn: bigint
): Promise<{ amountOut: bigint; poolAddr: string } | null> {
  try {
    const [out, poolAddr] = await router.quoteSingle(tokenIn, tokenOut, fee, amtIn)
    const amountOut = BigInt(out.toString())
    if (amountOut === 0n) return null

    try {
      const pool = new ethers.Contract(poolAddr, POOL_LIQUIDITY_ABI, provider)
      const liq = BigInt((await pool.liquidity()).toString())
      // Reject ghost pools (liq = 0) and dust pools (liq < 1e10)
      if (liq < MIN_SWAP_POOL_LIQ) return null
    } catch { return null }

    return { amountOut, poolAddr }
  } catch { return null }
}

// ─── Smart multi-hop router ───────────────────────────────────────────────────
async function getBestRouteQuote(
  tokenIn: string, tokenOut: string, netAmountIn: bigint
): Promise<QuoteResult | null> {
  const p      = getProvider()
  const router = new ethers.Contract(ACUA_SWAP_ROUTER, ROUTER_QUOTE_ABI, p)
  const results: { amountOut: bigint; fee: number; fee2?: number; hopToken?: string; label: string }[] = []

  const inL  = tokenIn.toLowerCase()
  const outL = tokenOut.toLowerCase()

  await Promise.all(FEE_TIERS.map(async fee => {
    const r = await tryQuoteSingle(router, p, tokenIn, tokenOut, fee, netAmountIn)
    if (r) {
      const pct = fee >= 10000 ? '1%' : fee >= 3000 ? '0.3%' : fee >= 500 ? '0.05%' : '0.01%'
      results.push({ amountOut: r.amountOut, fee, label: `Directo ${pct}` })
    }
  }))

  const HOP_CANDIDATES = [
    { addr: TOKENS.WLD,  sym: 'WLD'  },
    { addr: TOKENS.USDC, sym: 'USDC' },
    { addr: WETH_ADDR,   sym: 'WETH' },
  ].filter(h => h.addr.toLowerCase() !== inL && h.addr.toLowerCase() !== outL)

  await Promise.all(HOP_CANDIDATES.flatMap(({ addr: hop, sym: hopSym }) =>
    FEE_TIERS.flatMap(f1 =>
      FEE_TIERS.map(async f2 => {
        const r1 = await tryQuoteSingle(router, p, tokenIn, hop, f1, netAmountIn)
        if (!r1 || r1.amountOut === 0n) return

        const r2 = await tryQuoteSingle(router, p, hop, tokenOut, f2, r1.amountOut)
        if (!r2 || r2.amountOut === 0n) return

        const pct1 = f1 >= 10000 ? '1%' : f1 >= 3000 ? '0.3%' : f1 >= 500 ? '0.05%' : '0.01%'
        const pct2 = f2 >= 10000 ? '1%' : f2 >= 3000 ? '0.3%' : f2 >= 500 ? '0.05%' : '0.01%'
        results.push({
          amountOut: r2.amountOut, fee: f1, fee2: f2, hopToken: hop,
          label: `Vía ${hopSym} (${pct1}+${pct2})`,
        })
      })
    )
  ))

  if (results.length === 0) return null

  results.sort((a, b) => {
    if (a.amountOut !== b.amountOut) return a.amountOut > b.amountOut ? -1 : 1
    return (a.fee + (a.fee2 ?? 0)) - (b.fee + (b.fee2 ?? 0))
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

// ─── Format price helpers ────────────────────────────────────────────────────
function fmtUsd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1)    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toExponential(2)}`
}
function fmtWld(n: number): string {
  if (n >= 1000) return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} WLD`
  if (n >= 1)    return `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} WLD`
  if (n >= 0.0001) return `${n.toFixed(5)} WLD`
  return `${n.toExponential(2)} WLD`
}
function shortNum(n: number): string {
  if (!isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)         return (n / 1_000).toFixed(2) + 'K'
  return n.toFixed(0)
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
function TokenPicker({ tokens, onSelect, onClose, exclude, usdPrices, wldPrices }: {
  tokens: TokenItem[]
  onSelect: (t: TokenItem) => void
  onClose: () => void
  exclude?: string
  usdPrices: Record<string, number>
  wldPrices: Record<string, number>
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
          {filtered.map(t => {
            const addrL = t.address.toLowerCase()
            const usdP = usdPrices[addrL]
            const wldP = wldPrices[addrL]
            return (
              <button key={t.address} onClick={() => { onSelect(t); onClose() }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left">
                <TokenLogo token={t} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{t.symbol}</p>
                  <p className="text-xs text-white/40">{t.name}</p>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  {usdP && <p className="text-xs font-mono text-green-400/80">{fmtUsd(usdP)}</p>}
                  {wldP && t.symbol !== 'WLD' && <p className="text-[10px] font-mono text-blue-400/70">{fmtWld(wldP)}</p>}
                  {t.isCustom && <span className="text-[9px] text-white/30 border border-white/10 rounded px-1">custom</span>}
                </div>
              </button>
            )
          })}
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
  if (bps > IMPACT_HIGH_BPS) return 'text-red-400'
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
  const [prices,     setPrices]     = useState<Record<string, number>>({})    // USD prices
  const [wldPrices,  setWldPrices]  = useState<Record<string, number>>({})    // WLD prices
  const [loadingBal, setLoadingBal] = useState(false)
  const [lastPriceUpdate, setLastPriceUpdate] = useState(0)

  const [fromToken, setFromToken] = useState<TokenItem>(DEFAULT_TOKENS[0])
  const [toToken,   setToToken]   = useState<TokenItem>(DEFAULT_TOKENS[1])
  const [fromAmt,   setFromAmt]   = useState('')
  // When the user picks MAX we keep the exact bigint balance so we don't lose
  // precision through formatUnits → parseUnits roundtrip on the Permit2 amount.
  const [maxRawAmt, setMaxRawAmt] = useState<bigint | null>(null)
  const [quote,     setQuote]     = useState<QuoteResult | null>(null)
  const [quoting,   setQuoting]   = useState(false)
  const [swapping,  setSwapping]  = useState(false)
  const [swapStep,  setSwapStep]  = useState<string>('')
  const [swapMsg,   setSwapMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null)
  const [impact,    setImpact]    = useState<number | null>(null)

  // Slippage warning: shown when impact is high before executing swap
  const [slipWarning, setSlipWarning] = useState<{ bps: number; level: 'warn' | 'high' } | null>(null)

  const [addAddr,    setAddAddr]    = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMsg,     setAddMsg]     = useState('')

  // Token detail expansion (mini chart + stats + buy/sell)
  const [expandedToken, setExpandedToken] = useState<string | null>(null)
  const [chartInterval, setChartInterval] = useState<'5' | '60' | '1D'>('60')
  const [tokenStats, setTokenStats] = useState<Record<string, {
    pairAddress?: string
    priceUsd?: number
    liquidityUsd?: number
    volume24h?: number
    fdv?: number
    change5m?: number
    change1h?: number
    change24h?: number
    loading?: boolean
    fetched?: boolean
  }>>({})

  // Volume panel
  const [volOpen,    setVolOpen]    = useState(true)
  const [loadingVol, setLoadingVol] = useState(false)
  const [claimingVol, setClaimingVol] = useState(false)
  const [volMsg,     setVolMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [volData, setVolData] = useState<{
    uth2Amount: bigint; userVolume: bigint; tierStatus: number[]
    monthId: bigint; secondsLeft: number; thresholds: bigint[]; rewards: bigint[]
    totalDistributed: bigint; userTotalClaimed: bigint; globalMonthVolume: bigint
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

      const { usdPrices, wldPrices: wldP } = await fetchAllTokenPrices(allTokens)
      setPrices(usdPrices)
      setWldPrices(wldP)
      setLastPriceUpdate(Date.now())
    } catch (e) { console.error('[Swap] loadBalances', e) }
    finally { setLoadingBal(false) }
  }, [userAddress, allTokens.length]) // eslint-disable-line

  useEffect(() => { loadBalances() }, [loadBalances])

  // Auto-refresh prices every 30s
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const { usdPrices, wldPrices: wldP } = await fetchAllTokenPrices(allTokens)
        if (Object.keys(usdPrices).length > 0) {
          setPrices(usdPrices)
          setWldPrices(wldP)
          setLastPriceUpdate(Date.now())
        }
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
    setQuote(null); setSwapMsg(null); setImpact(null); setSlipWarning(null)
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(() => runQuote(fromToken, toToken, fromAmt), 500)
  }, [fromAmt, fromToken, toToken]) // eslint-disable-line

  // ── Token stats fetch (DexScreener) — for expanded chart panel ──────────────
  const fetchTokenStats = useCallback(async (tokenAddr: string) => {
    const key = tokenAddr.toLowerCase()
    setTokenStats(s => ({ ...s, [key]: { ...(s[key] ?? {}), loading: true } }))
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`,
        { signal: AbortSignal.timeout(6000) },
      )
      const data = await res.json()
      if (!Array.isArray(data.pairs)) {
        setTokenStats(s => ({ ...s, [key]: { loading: false, fetched: true } }))
        return
      }
      // Pick best WC pair: highest liquidity, prefer USDC/WLD/WETH quote
      let best: any = null
      for (const pair of data.pairs) {
        const chainId = (pair.chainId ?? '').toLowerCase()
        if (!WORLDCHAIN_IDS.has(chainId)) continue
        const liq = parseFloat(pair.liquidity?.usd ?? '0')
        if (!liq || liq < 100) continue
        const score = pairScore(pair.quoteToken?.address ?? '')
        const cur = best
        if (!cur) { best = { pair, liq, score }; continue }
        if (score > cur.score || (score === cur.score && liq > cur.liq)) {
          best = { pair, liq, score }
        }
      }
      if (!best) {
        setTokenStats(s => ({ ...s, [key]: { loading: false, fetched: true } }))
        return
      }
      const p = best.pair
      setTokenStats(s => ({
        ...s,
        [key]: {
          pairAddress:  p.pairAddress,
          priceUsd:     parseFloat(p.priceUsd ?? '0') || undefined,
          liquidityUsd: parseFloat(p.liquidity?.usd ?? '0') || undefined,
          volume24h:    parseFloat(p.volume?.h24 ?? '0') || undefined,
          fdv:          parseFloat(p.fdv ?? '0') || undefined,
          change5m:     parseFloat(p.priceChange?.m5  ?? '0'),
          change1h:     parseFloat(p.priceChange?.h1  ?? '0'),
          change24h:    parseFloat(p.priceChange?.h24 ?? '0'),
          loading: false,
          fetched: true,
        },
      }))
    } catch {
      setTokenStats(s => ({ ...s, [key]: { loading: false, fetched: true } }))
    }
  }, [])

  const toggleExpand = useCallback((tokenAddr: string) => {
    const key = tokenAddr.toLowerCase()
    setExpandedToken(prev => {
      const next = prev === key ? null : key
      if (next && !tokenStats[key]?.fetched) fetchTokenStats(tokenAddr)
      return next
    })
  }, [tokenStats, fetchTokenStats])

  // ── MAX helper ──────────────────────────────────────────────────────────────
  // Stores the exact raw bigint balance so the Permit2 amount and the V3 swap
  // amount match the wallet to the wei. This fixes "swap full balance" errors.
  const setMax = useCallback(() => {
    const bal = balances[fromToken.address.toLowerCase()] ?? 0n
    if (bal === 0n) return
    setMaxRawAmt(bal)
    setFromAmt(ethers.formatUnits(bal, fromToken.decimals))
  }, [balances, fromToken])

  // Drop the "max" lock as soon as the user types or changes token
  useEffect(() => { setMaxRawAmt(null) }, [fromToken.address, toToken.address])

  // ── Load volume ──────────────────────────────────────────────────────────────
  const loadVolume = useCallback(async () => {
    setLoadingVol(true)
    try {
      const p  = getProvider()
      const vc = new ethers.Contract(ACUA_VOLUME_REWARDS, VOLUME_REWARDS_ABI, p)

      const [[uth2, vol, tiers], [monthId,,, secsLeft], [ths, rws], totalDist] =
        await Promise.all([
          vc.pendingNow(userAddress),
          vc.getPeriodInfo(),
          vc.getAllTiers(),
          vc.totalDistributed().catch(() => 0n),
        ])

      const monthIdBig = BigInt(monthId.toString())

      const [claimedLogs, volumeLogs] = await Promise.all([
        vc.queryFilter(vc.filters.RewardClaimed(userAddress), 0, 'latest').catch(() => []),
        vc.queryFilter(vc.filters.VolumeRecorded(null, monthIdBig), 0, 'latest').catch(() => []),
      ])

      let userTotalClaimed = 0n
      for (const log of claimedLogs as any[]) {
        try { userTotalClaimed += BigInt(log.args.uth2Amount.toString()) } catch {}
      }

      const latestPerUser = new Map<string, bigint>()
      for (const log of volumeLogs as any[]) {
        try {
          const user  = (log.args.user as string).toLowerCase()
          const total = BigInt(log.args.total.toString())
          const prev  = latestPerUser.get(user) ?? 0n
          if (total > prev) latestPerUser.set(user, total)
        } catch {}
      }
      let globalMonthVolume = 0n
      for (const v of latestPerUser.values()) globalMonthVolume += v

      setVolData({
        uth2Amount:   BigInt(uth2.toString()),
        userVolume:   BigInt(vol.toString()),
        tierStatus:   Array.from(tiers).map((v: any) => Number(v)),
        monthId:      monthIdBig,
        secondsLeft:  Number(secsLeft.toString()),
        thresholds:   Array.from(ths).map((v: any) => BigInt(v.toString())),
        rewards:      Array.from(rws).map((v: any) => BigInt(v.toString())),
        totalDistributed: BigInt(totalDist.toString()),
        userTotalClaimed,
        globalMonthVolume,
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
  const executeSwap = useCallback(async () => {
    if (!fromAmt || !quote) return

    if (!MiniKit.isInstalled()) {
      setSwapMsg({ ok: false, text: 'Abre la app dentro de World App para hacer swaps.' })
      return
    }

    setSwapping(true); setSwapMsg(null); setSwapStep(''); setSlipWarning(null)

    try {
      const userBal = balances[fromToken.address.toLowerCase()] ?? 0n
      let rawAmt: bigint
      // If user clicked MAX, use the exact bigint balance to avoid any
      // formatUnits/parseUnits precision drift that can cause Permit2 to
      // request slightly more (or less) than the wallet holds.
      if (maxRawAmt !== null && maxRawAmt > 0n) {
        rawAmt = maxRawAmt > userBal ? userBal : maxRawAmt
      } else {
        try {
          rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals)
        } catch {
          setSwapMsg({ ok: false, text: 'Monto inválido.' }); return
        }
      }
      if (rawAmt === 0n) {
        setSwapMsg({ ok: false, text: 'El monto debe ser mayor a cero.' }); return
      }
      // Cap at wallet balance — never request more than the user actually has
      if (rawAmt > userBal) rawAmt = userBal
      if (rawAmt === 0n) {
        setSwapMsg({ ok: false, text: `Saldo insuficiente de ${fromToken.symbol}.` }); return
      }

      setSwapStep('Verificando cotización...')
      let activeQuote = quote
      if (Date.now() - quote.timestamp > QUOTE_TTL_MS) {
        const net = rawAmt - rawAmt * BigInt(ACUA_FEE_BPS) / 10000n
        const fresh = await getBestRouteQuote(fromToken.address, toToken.address, net)
        if (!fresh) {
          setSwapMsg({ ok: false, text: 'Sin liquidez disponible para este par. Prueba con otro token.' }); return
        }
        activeQuote = fresh
      }

      // Very permissive minOut (50% tolerance) — allows high-volume & volatile market swaps
      const minOut = activeQuote.amountOut * BigInt(10000 - SLIPPAGE_BPS) / 10000n

      // ── USDC equivalent for volume tracking ───────────────────────────────
      // Fetch fresh price from DexScreener at swap time so volume is always
      // recorded correctly even if the cached price state is stale.
      setSwapStep('Obteniendo precio actualizado...')
      let priceUsd = await fetchFreshTokenPrice(fromToken)
      // If DexScreener didn't return anything, fall back to cached state
      if (!priceUsd) {
        priceUsd = prices[fromToken.address.toLowerCase()] ?? 0
        if (!priceUsd) {
          const wldP   = wldPrices[fromToken.address.toLowerCase()]
          const wldUsd = prices[TOKENS.WLD.toLowerCase()]
          if (wldP && wldUsd) priceUsd = wldP * wldUsd
        }
      }

      const floatAmt = parseFloat(ethers.formatUnits(rawAmt, fromToken.decimals))
      const usdcEquivNum = Math.floor(floatAmt * priceUsd * 1_000_000)
      const usdcEquiv = BigInt(isNaN(usdcEquivNum) || usdcEquivNum < 0 ? 0 : usdcEquivNum)

      const nonce    = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const rawAmtStr  = rawAmt.toString()
      const nonceStr   = nonce.toString()
      const deadlineStr = deadline.toString()

      const permitArg = {
        permitted: { token: fromToken.address, amount: rawAmtStr },
        nonce:     nonceStr,
        deadline:  deadlineStr,
      }

      let swapTx: any
      if (activeQuote.multi && activeQuote.hopToken && activeQuote.fee2 !== undefined) {
        swapTx = {
          address:      ACUA_SWAP_ROUTER,
          abi:          SWAP_MULTI_ABI,
          functionName: 'swapV3Multi',
          args: [
            activeQuote.hopToken,
            toToken.address,
            activeQuote.fee.toString(),
            activeQuote.fee2.toString(),
            minOut.toString(),
            usdcEquiv.toString(),
            permitArg,
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }
      } else {
        swapTx = {
          address:      ACUA_SWAP_ROUTER,
          abi:          SWAP_SINGLE_ABI,
          functionName: 'swapV3Single',
          args: [
            toToken.address,
            activeQuote.fee.toString(),
            minOut.toString(),
            usdcEquiv.toString(),
            permitArg,
            'PERMIT2_SIGNATURE_PLACEHOLDER_0',
          ],
        }
      }

      setSwapStep('Confirma en World App...')

      let res: any
      try {
        res = await MiniKit.commandsAsync.sendTransaction({
          transaction: [swapTx],
          permit2: [{
            permitted: { token: fromToken.address, amount: rawAmtStr },
            spender:   ACUA_SWAP_ROUTER,
            nonce:     nonceStr,
            deadline:  deadlineStr,
          }],
        })
      } catch (e: any) {
        const msg = e?.shortMessage ?? e?.reason ?? e?.message ?? 'Error al comunicarse con World App.'
        setSwapMsg({ ok: false, text: msg }); return
      }

      const finalPayload = res?.finalPayload ?? null
      if (!finalPayload) {
        setSwapMsg({ ok: false, text: 'World App no respondió. Intenta de nuevo.' }); return
      }

      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        const shortId = txId ? ` · tx ${txId.slice(0, 8)}…` : ''
        setSwapMsg({ ok: true, text: `✓ Swap confirmado${shortId}` })
        setFromAmt(''); setQuote(null); setImpact(null)
        setTimeout(() => { loadBalances(); loadVolume() }, 3000)
      } else {
        console.error('[Swap] error payload:', JSON.stringify(finalPayload))
        setSwapMsg({ ok: false, text: parseMiniKitTxError(finalPayload) })
      }
    } catch (e: any) {
      console.error('[Swap] unexpected:', e)
      setSwapMsg({ ok: false, text: e?.shortMessage ?? e?.reason ?? e?.message ?? 'Error inesperado.' })
    } finally {
      setSwapping(false)
      setSwapStep('')
    }
  }, [fromAmt, quote, fromToken, toToken, prices, wldPrices, balances, maxRawAmt, loadBalances, loadVolume]) // eslint-disable-line

  // ── doSwap: check slippage warning first ─────────────────────────────────────
  const doSwap = useCallback(() => {
    if (!quote || !fromAmt) return
    const impBps = impact ?? null
    if (impBps !== null && impBps > IMPACT_WARN_BPS && !slipWarning) {
      // Show warning and wait for user confirmation
      setSlipWarning({ bps: impBps, level: impBps > IMPACT_HIGH_BPS ? 'high' : 'warn' })
      return
    }
    executeSwap()
  }, [quote, fromAmt, impact, slipWarning, executeSwap])

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

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">

      {/* ═══ VOLUME REWARDS ════════════════════════════════════════════════════ */}
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
                {/* ── 4 stat cards ─────────────────────────────────────────── */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="rounded-xl p-2.5 space-y-0.5" style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.18)' }}>
                    <p className="text-[9px] text-white/40 uppercase tracking-wide">Mi volumen (mes)</p>
                    <p className="text-sm font-bold font-mono text-teal-300">
                      ${(Number(volData.userVolume)/1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-xl p-2.5 space-y-0.5" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
                    <p className="text-[9px] text-white/40 uppercase tracking-wide">Vol. total (mes)</p>
                    <p className="text-sm font-bold font-mono text-indigo-300">
                      ${(Number(volData.globalMonthVolume)/1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="rounded-xl p-2.5 space-y-0.5" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.18)' }}>
                    <p className="text-[9px] text-white/40 uppercase tracking-wide">Mi UTH2 reclamado</p>
                    <p className="text-sm font-bold font-mono text-purple-300">
                      {parseFloat(ethers.formatEther(volData.userTotalClaimed)).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </p>
                  </div>
                  <div className="rounded-xl p-2.5 space-y-0.5" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.18)' }}>
                    <p className="text-[9px] text-white/40 uppercase tracking-wide">UTH2 total (todos)</p>
                    <p className="text-sm font-bold font-mono text-yellow-300">
                      {parseFloat(ethers.formatEther(volData.totalDistributed)).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </p>
                  </div>
                </div>

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
                        {nextT !== null && <span className="text-white/40">${((nextT - volNum)/1_000_000).toFixed(2)} más para siguiente tier</span>}
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

                {/* Claim button — always visible. Disabled if nothing to claim. */}
                {(() => {
                  const hasClaim = volData.uth2Amount > 0n
                  return (
                    <button onClick={doClaimVolume} disabled={claimingVol || !hasClaim}
                      className="w-full h-10 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
                      style={{
                        background: hasClaim
                          ? 'linear-gradient(135deg, #14b8a6 0%, #0891b2 100%)'
                          : 'linear-gradient(135deg, rgba(20,184,166,0.35) 0%, rgba(8,145,178,0.35) 100%)',
                        boxShadow: hasClaim ? '0 0 18px rgba(20,184,166,0.3)' : 'none',
                      }}>
                      {claimingVol ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Reclamando...</>
                      ) : hasClaim ? (
                        <><Gift className="w-4 h-4" /> Reclamar {parseFloat(ethers.formatEther(volData.uth2Amount)).toFixed(4)} UTH2</>
                      ) : (
                        <><Gift className="w-4 h-4" /> Reclamar UTH2 (haz swap para acumular)</>
                      )}
                    </button>
                  )
                })()}

                {volMsg && (
                  <div className={cn('rounded-xl px-3 py-2 text-xs',
                    volMsg.ok ? 'bg-green-500/10 border border-green-500/20 text-green-300'
                              : 'bg-red-500/10 border border-red-500/20 text-red-300')}>
                    {volMsg.text}
                  </div>
                )}

                {/* Refresh button */}
                <button onClick={loadVolume} disabled={loadingVol}
                  className="w-full flex items-center justify-center gap-1.5 text-[10px] text-white/25 hover:text-white/50 transition-colors py-1">
                  <RefreshCw className={cn('w-2.5 h-2.5', loadingVol && 'animate-spin')} />
                  Actualizar estadísticas
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4">
                <p className="text-xs text-white/30">Haz swap para empezar a acumular volumen y ganar UTH2</p>
                <button onClick={loadVolume} className="text-[10px] text-teal-400 hover:text-teal-300 transition-colors flex items-center gap-1">
                  <RefreshCw className="w-2.5 h-2.5" /> Cargar datos
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ MAIN SWAP CARD ════════════════════════════════════════════════════ */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, #0f1923 0%, #0a1118 100%)', border: '1px solid rgba(255,255,255,0.07)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
              <Repeat2 className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <span className="text-xs font-bold text-white">Acua Swap</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8' }}>Smart Route</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => { setView('wallet'); loadBalances() }}
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
                const tokenKey = token.address.toLowerCase()
                const bal = getBal(token)
                const usd = getUsd(token, bal)
                const usdPrice = prices[tokenKey]
                const wldPrice = wldPrices[tokenKey]
                const isExpanded = expandedToken === tokenKey
                const stats = tokenStats[tokenKey]
                return (
                  <div key={token.address}
                    className="rounded-xl overflow-hidden transition-all"
                    style={{
                      background: isExpanded ? 'rgba(99,102,241,0.06)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isExpanded ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)'}`,
                    }}>
                    {/* Card header — click toggles expansion */}
                    <button
                      onClick={() => toggleExpand(token.address)}
                      className="w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-white/[0.02]">
                      <TokenLogo token={token} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-white">{token.symbol}</span>
                          {token.isCustom && <span className="text-[9px] text-white/30 border border-white/10 rounded px-1">custom</span>}
                        </div>
                        <p className="text-xs text-white/30">{token.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {usdPrice && <span className="text-[10px] text-green-400/70 font-mono">{fmtUsd(usdPrice)}</span>}
                          {wldPrice && token.symbol !== 'WLD' && <span className="text-[10px] text-blue-400/60 font-mono">{fmtWld(wldPrice)}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-mono font-semibold text-white">{bal === 0n ? '0' : formatToken(bal, token.decimals, 4)}</p>
                        {usd && parseFloat(usd) > 0 && <p className="text-[10px] text-green-400 font-mono">${usd}</p>}
                      </div>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-indigo-400 shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-white/30 shrink-0" />}
                    </button>

                    {/* Expanded chart + stats panel */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 space-y-2.5"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>

                        {/* 24h price change banner */}
                        {stats?.fetched && stats.priceUsd != null && (
                          <div className="flex items-center justify-between gap-2 mt-2">
                            <div>
                              <p className="text-[9px] text-white/30 uppercase tracking-widest">Precio</p>
                              <p className="text-base font-bold text-white font-mono">{fmtUsd(stats.priceUsd)}</p>
                            </div>
                            {stats.change24h != null && (() => {
                              const up = stats.change24h >= 0
                              return (
                                <div className={cn('flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold font-mono',
                                  up ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400')}>
                                  {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                  {up ? '+' : ''}{stats.change24h.toFixed(2)}% 24h
                                </div>
                              )
                            })()}
                          </div>
                        )}

                        {/* Timeframe tabs */}
                        <div className="flex items-center gap-1 rounded-lg p-0.5 w-fit"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                          {([
                            { key: '5'  as const, label: '5m' },
                            { key: '60' as const, label: '1h' },
                            { key: '1D' as const, label: '1d' },
                          ]).map(tf => (
                            <button key={tf.key} onClick={() => setChartInterval(tf.key)}
                              className={cn('px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-colors',
                                chartInterval === tf.key ? 'bg-indigo-500/30 text-indigo-200' : 'text-white/40 hover:text-white/70')}>
                              {tf.label}
                            </button>
                          ))}
                          <span className="text-[9px] text-white/25 pl-1.5 pr-1 self-center">
                            cambia velas/línea adentro
                          </span>
                        </div>

                        {/* Chart iframe */}
                        {stats?.loading && (
                          <div className="h-44 flex items-center justify-center rounded-lg" style={{ background: 'rgba(0,0,0,0.3)' }}>
                            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                          </div>
                        )}
                        {stats?.fetched && stats.pairAddress && (
                          <div className="rounded-lg overflow-hidden" style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <iframe
                              key={`${tokenKey}-${chartInterval}`}
                              src={`https://dexscreener.com/world/${stats.pairAddress}?embed=1&theme=dark&trades=0&info=0&interval=${chartInterval}`}
                              title={`${token.symbol} chart`}
                              className="w-full"
                              style={{ height: 280, border: 0 }}
                              loading="lazy"
                            />
                          </div>
                        )}
                        {stats?.fetched && !stats.pairAddress && (
                          <div className="h-24 flex items-center justify-center rounded-lg text-[11px] text-white/40 text-center px-3"
                            style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            Sin datos de mercado en World Chain para este token aún.
                          </div>
                        )}

                        {/* Stats grid */}
                        {stats?.fetched && (stats.liquidityUsd || stats.volume24h || stats.fdv) && (
                          <div className="grid grid-cols-3 gap-1.5">
                            {stats.liquidityUsd != null && stats.liquidityUsd > 0 && (
                              <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <p className="text-[9px] text-white/35 uppercase tracking-wider flex items-center gap-1"><Droplets className="w-2.5 h-2.5" />Liquidez</p>
                                <p className="text-[11px] font-bold text-white font-mono mt-0.5">${shortNum(stats.liquidityUsd)}</p>
                              </div>
                            )}
                            {stats.volume24h != null && stats.volume24h > 0 && (
                              <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <p className="text-[9px] text-white/35 uppercase tracking-wider flex items-center gap-1"><Activity className="w-2.5 h-2.5" />Vol 24h</p>
                                <p className="text-[11px] font-bold text-white font-mono mt-0.5">${shortNum(stats.volume24h)}</p>
                              </div>
                            )}
                            {stats.fdv != null && stats.fdv > 0 && (
                              <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <p className="text-[9px] text-white/35 uppercase tracking-wider flex items-center gap-1"><BarChart2 className="w-2.5 h-2.5" />FDV</p>
                                <p className="text-[11px] font-bold text-white font-mono mt-0.5">${shortNum(stats.fdv)}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Mini change row 5m / 1h / 24h */}
                        {stats?.fetched && (stats.change5m != null || stats.change1h != null || stats.change24h != null) && (
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { label: '5m',  v: stats.change5m  ?? 0 },
                              { label: '1h',  v: stats.change1h  ?? 0 },
                              { label: '24h', v: stats.change24h ?? 0 },
                            ].map(c => {
                              const up = c.v >= 0
                              return (
                                <div key={c.label}
                                  className={cn('rounded-lg p-1.5 text-center font-mono',
                                    up ? 'text-green-400' : 'text-red-400')}
                                  style={{ background: up ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${up ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}>
                                  <p className="text-[8px] text-white/40 uppercase">{c.label}</p>
                                  <p className="text-[11px] font-bold">{up ? '+' : ''}{c.v.toFixed(2)}%</p>
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* Buy / Sell action buttons */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            onClick={() => {
                              // Comprar este token: pago en USDC (o WLD si es USDC)
                              const pay = token.address.toLowerCase() === TOKENS.USDC.toLowerCase()
                                ? DEFAULT_TOKENS.find(t => t.symbol === 'WLD')!
                                : DEFAULT_TOKENS.find(t => t.symbol === 'USDC')!
                              setFromToken(pay); setToToken(token); setFromAmt('')
                              setMaxRawAmt(null); setExpandedToken(null); setView('swap')
                            }}
                            className="h-10 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-1.5"
                            style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 0 14px rgba(16,185,129,0.25)' }}>
                            <ArrowDownToLine className="w-4 h-4" />
                            Comprar {token.symbol}
                          </button>
                          <button
                            onClick={() => {
                              // Vender este token: recibir USDC (o WLD si es USDC)
                              const recv = token.address.toLowerCase() === TOKENS.USDC.toLowerCase()
                                ? DEFAULT_TOKENS.find(t => t.symbol === 'WLD')!
                                : DEFAULT_TOKENS.find(t => t.symbol === 'USDC')!
                              setFromToken(token); setToToken(recv); setFromAmt('')
                              setMaxRawAmt(null); setExpandedToken(null); setView('swap')
                            }}
                            disabled={bal === 0n}
                            className="h-10 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', boxShadow: '0 0 14px rgba(239,68,68,0.25)' }}>
                            <ArrowUpFromLine className="w-4 h-4" />
                            Vender {token.symbol}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
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
              {/* Fee + route info bar */}
              <div className="flex items-center justify-between rounded-lg px-3 py-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="text-white/40 flex items-center gap-1">
                  <Coins className="w-3 h-3" /> 2% owner · 0.1% H2O vía WLD · Slippage: <strong className="text-white/60">{(SLIPPAGE_BPS / 100).toFixed(0)}%</strong>
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
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-white/40 font-mono">
                      Saldo: {formatToken(getBal(fromToken), fromToken.decimals, 4)}
                    </span>
                    <button onClick={setMax}
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md transition-all hover:scale-105"
                      style={{ background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' }}>
                      Max
                    </button>
                  </div>
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
                    onChange={e => { setMaxRawAmt(null); setFromAmt(e.target.value) }} placeholder="0.0"
                    className="flex-1 min-w-0 bg-transparent text-right text-2xl font-bold font-mono text-white placeholder:text-white/15 outline-none" />
                </div>
                {fromAmt && parseFloat(fromAmt) > 0 && (() => {
                  const usdP = prices[fromToken.address.toLowerCase()]
                  const wldP = wldPrices[fromToken.address.toLowerCase()]
                  const floatAmt = parseFloat(fromAmt)
                  return (
                    <div className="flex items-center justify-end gap-2">
                      {usdP && <p className="text-[10px] text-white/30 font-mono">≈ ${(floatAmt * usdP).toFixed(2)} USD</p>}
                      {wldP && fromToken.symbol !== 'WLD' && <p className="text-[10px] text-blue-400/50 font-mono">≈ {(floatAmt * wldP).toFixed(4)} WLD</p>}
                    </div>
                  )
                })()}
              </div>

              {/* Flip button */}
              <div className="flex justify-center -my-0.5">
                <button
                  onClick={() => { setFromToken(toToken); setToToken(fromToken); setFromAmt(''); setQuote(null); setImpact(null); setSlipWarning(null) }}
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
                {quote && (() => {
                  const usdP = prices[toToken.address.toLowerCase()]
                  const wldP = wldPrices[toToken.address.toLowerCase()]
                  const floatOut = parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals))
                  return (
                    <div className="flex items-center justify-end gap-2">
                      {usdP && <p className="text-[10px] text-white/30 font-mono">≈ ${(floatOut * usdP).toFixed(2)} USD</p>}
                      {wldP && toToken.symbol !== 'WLD' && <p className="text-[10px] text-blue-400/50 font-mono">≈ {(floatOut * wldP).toFixed(4)} WLD</p>}
                    </div>
                  )
                })()}
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
                      <span className={cn('flex items-center gap-1',
                        impactBps > IMPACT_HIGH_BPS ? 'text-red-400' :
                        impactBps > IMPACT_WARN_BPS ? 'text-yellow-400' : 'text-white/40')}>
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

              {/* ── Slippage warning card (replaces hard block) ─────────────── */}
              {slipWarning && (
                <div className={cn('rounded-xl px-3 py-3 space-y-2.5',
                  slipWarning.level === 'high'
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-yellow-500/8 border border-yellow-500/25')}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className={cn('w-4 h-4 shrink-0 mt-0.5',
                      slipWarning.level === 'high' ? 'text-red-400' : 'text-yellow-400')} />
                    <div className="flex-1">
                      <p className={cn('text-xs font-bold',
                        slipWarning.level === 'high' ? 'text-red-300' : 'text-yellow-300')}>
                        {slipWarning.level === 'high' ? '⚠ Slippage alto — Mercado volátil' : '⚡ Slippage elevado — Mercado normal'}
                      </p>
                      <p className="text-[10px] text-white/50 mt-0.5">
                        El impacto de precio es <strong className={slipWarning.level === 'high' ? 'text-red-300' : 'text-yellow-300'}>{(slipWarning.bps / 100).toFixed(1)}%</strong>.
                        Puedes continuar el swap o esperar una mejor conversión.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={executeSwap}
                      className={cn('flex-1 h-9 rounded-lg text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]',
                        slipWarning.level === 'high'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30'
                          : 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25 hover:bg-yellow-500/25')}>
                      Continuar swap
                    </button>
                    <button onClick={() => setSlipWarning(null)}
                      className="flex-1 h-9 rounded-lg text-xs font-bold bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 transition-all hover:scale-[1.02] active:scale-[0.98]">
                      Esperar conversión
                    </button>
                  </div>
                </div>
              )}

              {/* Price impact info (when no warning panel open) */}
              {!slipWarning && impactBps !== null && impactBps > IMPACT_WARN_BPS && (
                <div className={cn('flex items-start gap-2 rounded-xl px-3 py-2.5',
                  impactBps > IMPACT_HIGH_BPS ? 'bg-red-500/8 border border-red-500/20' : 'bg-yellow-500/6 border border-yellow-500/15')}>
                  <ShieldAlert className={cn('w-3.5 h-3.5 shrink-0 mt-0.5',
                    impactBps > IMPACT_HIGH_BPS ? 'text-red-400' : 'text-yellow-400')} />
                  <p className={cn('text-[11px]',
                    impactBps > IMPACT_HIGH_BPS ? 'text-red-300' : 'text-yellow-300')}>
                    {impactBps > IMPACT_HIGH_BPS
                      ? `Mercado muy volátil (${(impactBps/100).toFixed(1)}% impacto). Se pedirá confirmación antes del swap.`
                      : `Impacto elevado (${(impactBps/100).toFixed(1)}%). Se pedirá confirmación antes del swap.`}
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

              {/* Swap button — always enabled when quote exists */}
              {!slipWarning && (
                <button
                  onClick={doSwap}
                  disabled={swapping || !quote || !fromAmt || parseFloat(fromAmt) <= 0}
                  className={cn(
                    'w-full h-12 rounded-xl text-sm font-bold transition-all duration-200 text-white',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    swapping ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.01] active:scale-[0.99]',
                  )}
                  style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', boxShadow: quote && !swapping ? '0 0 20px rgba(99,102,241,0.3)' : 'none' }}>
                  {swapping
                    ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{swapStep || 'Procesando...'}</span>
                    : <span className="flex items-center justify-center gap-2"><Zap className="w-4 h-4" /> Swap</span>}
                </button>
              )}

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
        <TokenPicker
          tokens={allTokens}
          onSelect={t => pickerFor === 'from' ? setFromToken(t) : setToToken(t)}
          onClose={() => setPickerFor(null)}
          exclude={pickerFor === 'from' ? toToken.address : fromToken.address}
          usdPrices={prices}
          wldPrices={wldPrices}
        />
      )}
    </div>
  )
}
