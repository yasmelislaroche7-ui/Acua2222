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
  Send, QrCode, History, Eye, Copy, CheckCheck, Globe,
  CandlestickChart, PieChart, Flame, Star, Target,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TOKENS, getProvider, ERC20_ABI, formatToken, randomNonce,
} from '@/lib/new-contracts'
import { swapEthers } from '@/lib/tx-signer'
import {
  fetchWDDClaimInfo, projectedRewards, buildWDDClaimBatch, fmtWDD,
  type ClaimInfo,
} from '@/lib/claim-manager'
import { cn } from '@/lib/utils'

// ─── Contracts ────────────────────────────────────────────────────────────────
const ACUA_SWAP_ROUTER    = '0xA2FD6cd36a661E270FC7AdaA82D0d22f4660706d'
const ACUA_VOLUME_REWARDS = '0xc74D6B65f8E30E040CE744117228118d107f77f1'

// ─── Constants ────────────────────────────────────────────────────────────────
const ACUA_FEE_BPS    = 210
const IMPACT_WARN_BPS = 300
const IMPACT_HIGH_BPS = 1500
const QUOTE_TTL_MS    = 25000

// ─── Electric Blue Theme ──────────────────────────────────────────────────────
const BLUE = 'oklch(0.65 0.22 255)'
const BLUE_RGB = '0, 122, 255'
const CARD_BG = 'rgba(0, 80, 255, 0.04)'
const CARD_BORDER = 'rgba(0, 163, 255, 0.14)'
const CARD_BORDER_ACTIVE = 'rgba(0, 163, 255, 0.38)'

// ─── LS helpers ───────────────────────────────────────────────────────────────
const LS_CUSTOMS = 'acua_custom_tokens_v2'
const LS_ENTRY   = 'acua_entry_prices_v1'
function lsGet(key: string, def = '') { try { return localStorage.getItem(key) ?? def } catch { return def } }
function lsSet(key: string, val: string) { try { localStorage.setItem(key, val) } catch {} }

// ─── Number formatters ────────────────────────────────────────────────────────
function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  if (n >= 1)   return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}
function shortNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}
function fmtWld(wld: number): string {
  if (wld >= 1000) return `${wld.toFixed(1)} WLD`
  if (wld >= 1)    return `${wld.toFixed(2)} WLD`
  if (wld >= 0.001) return `${wld.toFixed(4)} WLD`
  return `${wld.toFixed(6)} WLD`
}

// ─── Adaptive slippage ────────────────────────────────────────────────────────
function getAdaptiveSlippageBps(fromAddr: string, toAddr: string): number {
  const USDC_L  = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'.toLowerCase()
  const WLD_L   = '0x2cFc85d8E48F8EAB294be644d9E25C3030863003'.toLowerCase()
  const WETH_L  = '0x4200000000000000000000000000000000000006'.toLowerCase()
  const inL  = fromAddr.toLowerCase()
  const outL = toAddr.toLowerCase()
  const stables = new Set([USDC_L])
  if (stables.has(inL) && stables.has(outL)) return 30
  const majors = new Set([WLD_L, USDC_L, WETH_L])
  if (majors.has(inL) && majors.has(outL)) return 50
  if (majors.has(inL) || majors.has(outL)) return 100
  return 200
}
function slippageLabel(bps: number): string {
  if (bps <= 30)  return '0.3%'
  if (bps <= 50)  return '0.5%'
  if (bps <= 100) return '1%'
  return '2%'
}

const WETH_ADDR = '0x4200000000000000000000000000000000000006'

// ─── MiniKit error messages ────────────────────────────────────────────────────
const TX_ERROR_MESSAGES: Record<string, string> = {
  user_rejected: 'Cancelaste la transacción.',
  simulation_failed: 'Simulación falló. Intenta con monto menor.',
  input_error: 'Datos inválidos. Intenta de nuevo.',
  generic_error: 'Error inesperado. Intenta de nuevo.',
  invalid_contract: 'Contrato no reconocido por World App.',
  disallowed_operation: 'Contrato no autorizado. Agrega contratos en developer.worldcoin.org.',
  malicious_operation: 'Operación bloqueada por seguridad.',
  daily_tx_limit_reached: 'Límite diario alcanzado. Intenta mañana.',
  transaction_failed: 'TX falló en cadena. Posible slippage o liquidez insuficiente.',
  permitted_amount_exceeds_slippage: 'Monto supera límite de slippage.',
  timeout: 'Tiempo agotado. Intenta de nuevo.',
}
function parseMiniKitTxError(payload: any): string {
  if (!payload) return 'Sin respuesta de World App.'
  const code: string = payload.error_code ?? payload.errorCode ?? ''
  if (code && TX_ERROR_MESSAGES[code]) return TX_ERROR_MESSAGES[code]
  const details = payload.details
  if (typeof details === 'string' && details.length > 0) {
    if (details.includes('Too much slippage')) return 'Slippage excedido.'
    if (details.includes('insufficient')) return 'Liquidez insuficiente.'
    return details
  }
  if (typeof payload.message === 'string') return payload.message
  if (code) return `Error: ${code}`
  return 'Transacción no completada.'
}

// ─── Fee tiers ────────────────────────────────────────────────────────────────
const FEE_TIERS = [100, 500, 3000, 10000]

// ─── Token logos ─────────────────────────────────────────────────────────────
const TOKEN_LOGOS: Record<string, string> = {
  WLD:  'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  SUSHI:'https://assets.coingecko.com/coins/images/12271/small/sushi.png',
}

export interface TokenItem {
  symbol: string; name: string; address: string
  decimals: number; color: string; logoUri?: string; isCustom?: boolean
}

const DEFAULT_TOKENS: TokenItem[] = [
  { symbol: 'WLD',      name: 'Worldcoin',      address: TOKENS.WLD,  decimals: 18, color: '#3b82f6', logoUri: TOKEN_LOGOS.WLD  },
  { symbol: 'H2O',      name: 'H2O Token',      address: TOKENS.H2O,  decimals: 18, color: '#06b6d4' },
  { symbol: 'USDC',     name: 'USD Coin',        address: TOKENS.USDC, decimals: 6,  color: '#2563eb', logoUri: TOKEN_LOGOS.USDC },
  { symbol: 'WETH',     name: 'Wrapped ETH',     address: WETH_ADDR,   decimals: 18, color: '#627eea' },
  { symbol: 'WBTC',     name: 'Wrapped BTC',     address: '0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3', decimals: 8,  color: '#f7931a' },
  { symbol: 'EURC',     name: 'Euro Coin',       address: '0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B', decimals: 6,  color: '#2a6fdb' },
  { symbol: 'FIRE',     name: 'Fire Token',      address: TOKENS.FIRE, decimals: 18, color: '#f97316' },
  { symbol: 'wCOP',     name: 'wCOP',            address: TOKENS.wCOP, decimals: 18, color: '#f59e0b' },
  { symbol: 'wARS',     name: 'wARS',            address: TOKENS.wARS, decimals: 18, color: '#10b981' },
  { symbol: 'wBRL',     name: 'Wrapped BRL',     address: '0xD76f5Faf6888e24D9F04Bf92a0c8B921FE4390e0', decimals: 18, color: '#22c55e' },
  { symbol: 'BTCH2O',   name: 'BTC H2O',         address: TOKENS.BTCH2O, decimals: 18, color: '#f59e0b' },
  { symbol: 'AIR',      name: 'AIR Token',       address: TOKENS.AIR,  decimals: 18, color: '#8b5cf6' },
  { symbol: 'UTH2',     name: 'UTH2',            address: TOKENS.UTH2, decimals: 18, color: '#a78bfa' },
  { symbol: 'oXAUT',    name: 'Ounce of Gold',   address: '0x30974f73A4ac9E606Ed80da928e454977ac486D2', decimals: 6,  color: '#d4af37' },
  { symbol: 'ORO',      name: 'ORO Token',       address: '0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63', decimals: 18, color: '#f5c518' },
  { symbol: 'WDD',      name: 'WDD Token',       address: '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B', decimals: 18, color: '#64748b' },
  { symbol: 'ORB',      name: 'ORB Token',       address: '0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB', decimals: 18, color: '#7c3aed' },
  { symbol: 'PUF',      name: 'PUF Token',       address: '0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3', decimals: 18, color: '#ec4899' },
  { symbol: 'uDOGE',    name: 'Uni DOGE',        address: '0x12E96C2BFEA6E835CF8Dd38a5834fa61Cf723736', decimals: 18, color: '#c2a633' },
  { symbol: 'uSOL',     name: 'Uni SOL',         address: '0x9B8Df6E244526ab5F6e6400d331DB28C8fdDdb55', decimals: 18, color: '#9945ff' },
  { symbol: 'VIBE',     name: 'VIBE Token',      address: '0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1', decimals: 18, color: '#f472b6' },
  { symbol: 'DIAMANTE', name: 'Diamante',        address: '0x2ba918fec90Ca7AaC5753a2551593470815866e6', decimals: 18, color: '#67e8f9' },
  { symbol: 'BILLBOARD',name: 'Billboard',       address: '0x7a8892E9687704F7BE8C26dfC5e51B6A86c8098B', decimals: 18, color: '#fb923c' },
  { symbol: 'Cash',     name: 'Cash Token',      address: '0xbfdA4F50a2d5B9b864511579D7dfa1C72f118575', decimals: 18, color: '#4ade80' },
  { symbol: 'AION',     name: 'AION Token',      address: '0x26064DD7821f351202c61f0deB97678eef265E36', decimals: 18, color: '#38bdf8' },
  { symbol: 'SAMA',     name: 'SAMA Token',      address: '0x24e2f756AF6558818083E78B1205D156542bCe80', decimals: 18, color: '#e879f9' },
  { symbol: 'APE',      name: 'APE Token',       address: '0x13e20981D9bd3dC45e99802f06488C5AD7c28360', decimals: 18, color: '#3b82f6' },
  { symbol: 'GFY',      name: 'GFY Token',       address: '0x6A7B33B8A7f7B3535dc832ECD147F6dEC8A8e8Cf', decimals: 18, color: '#f87171' },
  { symbol: 'VEN',      name: 'VEN Token',       address: '0x1191a54c53DBe8487c3A258C2A4a84aAe7E936F5', decimals: 18, color: '#34d399' },
  { symbol: 'TIME',     name: 'TIME Token',      address: '0x212d7448720852D8Ad282a5d4A895B3461F9076E', decimals: 18, color: '#f5b041' },
  { symbol: 'SUSHI',    name: 'SUSHI Token',     address: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38', decimals: 18, color: '#fa52a0', logoUri: TOKEN_LOGOS.SUSHI },
  { symbol: 'PVO',      name: 'PVO Token',       address: '0xE977de70dd1F571Aa563E41525C28b4F1eDB69ba', decimals: 18, color: '#a855f7' },
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

// ─── Interfaces ───────────────────────────────────────────────────────────────
interface QuoteResult {
  amountOut: bigint; fee: number; fee2?: number
  multi?: boolean; hopToken?: string; label: string; timestamp: number
}

// ─── Price fetching ───────────────────────────────────────────────────────────
const CG_IDS: Record<string, string> = {
  [TOKENS.WLD.toLowerCase()]:  'worldcoin-wld',
  [TOKENS.USDC.toLowerCase()]: 'usd-coin',
}
const WORLDCHAIN_IDS = new Set(['worldchain', 'worldchain-mainnet', 'world-chain', 'worldcoin'])
const MIN_PAIR_LIQ_USD = 500

function pairScore(quoteAddr: string): number {
  const q = quoteAddr.toLowerCase()
  if (q === TOKENS.USDC.toLowerCase()) return 3
  if (q === TOKENS.WLD.toLowerCase())  return 2
  if (q === WETH_ADDR.toLowerCase())   return 1
  return 0
}

async function dexScreenerPrices(addresses: string[]): Promise<Record<string, { price: number; change24h?: number; volume24h?: number; liq: number }>> {
  const best: Record<string, { price: number; change24h?: number; volume24h?: number; liq: number; score: number }> = {}
  const chunks: string[][] = []
  for (let i = 0; i < addresses.length; i += 29) chunks.push(addresses.slice(i, i + 29))
  await Promise.allSettled(chunks.map(async chunk => {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`, { signal: AbortSignal.timeout(6000) })
      const data = await res.json()
      if (!Array.isArray(data.pairs)) return
      for (const pair of data.pairs) {
        const chainId: string = (pair.chainId ?? '').toLowerCase()
        if (!WORLDCHAIN_IDS.has(chainId)) continue
        const addr  = pair.baseToken?.address?.toLowerCase()
        const priceUsdStr = pair.priceUsd
        if (!addr || !priceUsdStr) continue
        const p    = parseFloat(priceUsdStr)
        const liq  = parseFloat(pair.liquidity?.usd ?? '0')
        if (liq < MIN_PAIR_LIQ_USD || !p || p <= 0) continue
        const score = pairScore(pair.quoteToken?.address ?? '')
        const cur = best[addr]
        if (!cur || score > cur.score || (score === cur.score && liq > cur.liq)) {
          best[addr] = { price: p, liq, score, change24h: pair.priceChange?.h24, volume24h: pair.volume?.h24 }
        }
      }
    } catch {}
  }))
  const result: Record<string, { price: number; change24h?: number; volume24h?: number; liq: number }> = {}
  for (const [addr, v] of Object.entries(best)) result[addr] = { price: v.price, change24h: v.change24h, volume24h: v.volume24h, liq: v.liq }
  return result
}

async function fetchAllTokenPrices(tokens: TokenItem[]): Promise<{
  usdPrices: Record<string, number>
  wldPrices: Record<string, number>
  change24h: Record<string, number>
  volume24h: Record<string, number>
}> {
  const usdPrices: Record<string, number> = {}
  const wldPrices: Record<string, number> = {}
  const change24h: Record<string, number> = {}
  const volume24h: Record<string, number> = {}
  const addresses = tokens.map(t => t.address)

  usdPrices[TOKENS.USDC.toLowerCase()] = 1.0
  const eurcAddr = '0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B'.toLowerCase()
  usdPrices[eurcAddr] = 1.08

  const cgAddrs = addresses.filter(a => CG_IDS[a.toLowerCase()])
  if (cgAddrs.length > 0) {
    try {
      const ids = [...new Set(cgAddrs.map(a => CG_IDS[a.toLowerCase()]))]
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
        { signal: AbortSignal.timeout(5000) }
      )
      const data = await res.json()
      for (const addr of cgAddrs) {
        const id = CG_IDS[addr.toLowerCase()]
        if (data[id]?.usd) {
          usdPrices[addr.toLowerCase()] = data[id].usd
          if (data[id].usd_24h_change != null) change24h[addr.toLowerCase()] = data[id].usd_24h_change
          if (data[id].usd_24h_vol != null) volume24h[addr.toLowerCase()] = data[id].usd_24h_vol
        }
      }
    } catch {}
  }

  const dsResult = await dexScreenerPrices(addresses)
  for (const [addr, v] of Object.entries(dsResult)) {
    if (!usdPrices[addr] || addr !== TOKENS.USDC.toLowerCase()) usdPrices[addr] = v.price
    if (v.change24h != null) change24h[addr] = v.change24h
    if (v.volume24h != null) volume24h[addr] = v.volume24h
  }

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

  const decimalsMap = new Map(tokens.map(t => [t.address.toLowerCase(), t.decimals]))
  const missing = addresses.filter(a => !usdPrices[a.toLowerCase()])
  if (missing.length > 0 && (wldUsd > 0 || usdPrices[TOKENS.USDC.toLowerCase()] > 0)) {
    const provider = getProvider()
    const router   = new ethers.Contract(ACUA_SWAP_ROUTER, ROUTER_QUOTE_ABI, provider)
    const MIN_PRICE_LIQ = 1_000_000_000n
    const usdcUsd = usdPrices[TOKENS.USDC.toLowerCase()] ?? 1.0
    const bridges: { addr: string; oneUnit: bigint; usd: number }[] = []
    if (wldUsd > 0)  bridges.push({ addr: TOKENS.WLD,  oneUnit: ethers.parseUnits('1', 18), usd: wldUsd })
    if (usdcUsd > 0) bridges.push({ addr: TOKENS.USDC, oneUnit: ethers.parseUnits('1', 6),  usd: usdcUsd })
    await Promise.allSettled(missing.map(async tokenAddr => {
      const tokenL   = tokenAddr.toLowerCase()
      const decimals = decimalsMap.get(tokenL) ?? 18
      let bestPriceUsd = 0; let bestLiq = 0n
      await Promise.all(bridges.flatMap(({ addr: bridge, oneUnit, usd: bridgeUsd }) =>
        FEE_TIERS.map(async fee => {
          try {
            const [rawOut, poolAddr] = await router.quoteSingle(bridge, tokenAddr, fee, oneUnit)
            const out = BigInt(rawOut.toString())
            if (out === 0n) return
            const pool = new ethers.Contract(poolAddr, POOL_LIQUIDITY_ABI, provider)
            const liq  = BigInt((await pool.liquidity()).toString())
            if (liq < MIN_PRICE_LIQ || liq <= bestLiq) return
            const tokensPerBridge = parseFloat(ethers.formatUnits(out.toString(), decimals))
            if (tokensPerBridge <= 0) return
            bestLiq = liq; bestPriceUsd = bridgeUsd / tokensPerBridge
          } catch {}
        })
      ))
      if (bestPriceUsd > 0) {
        usdPrices[tokenL] = bestPriceUsd
        if (wldUsd > 0) wldPrices[tokenL] = bestPriceUsd / wldUsd
      }
    }))
  }

  return { usdPrices, wldPrices, change24h, volume24h }
}

async function fetchFreshTokenPrice(token: TokenItem): Promise<number> {
  const addrL = token.address.toLowerCase()
  if (addrL === TOKENS.USDC.toLowerCase()) return 1.0
  if (addrL === '0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B'.toLowerCase()) return 1.08
  let bestPrice = 0; let bestLiq = 0; let bestScore = -1
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`, { signal: AbortSignal.timeout(5000) })
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
  return bestPrice
}

// ─── calcImpactBps ────────────────────────────────────────────────────────────
function calcImpactBps(
  amtIn: bigint, decIn: number, priceIn: number,
  amtOut: bigint, decOut: number, priceOut: number
): number | null {
  if (!priceIn || !priceOut) return null
  const inUsd  = parseFloat(ethers.formatUnits(amtIn, decIn))  * priceIn
  const outUsd = parseFloat(ethers.formatUnits(amtOut, decOut)) * priceOut
  if (inUsd <= 0) return null
  return Math.round((1 - outUsd / inUsd) * 10000)
}

// ─── Best route quote ─────────────────────────────────────────────────────────
async function getBestRouteQuote(
  tokenIn: string, tokenOut: string, netAmtIn: bigint
): Promise<QuoteResult | null> {
  const provider = getProvider()
  const router   = new ethers.Contract(ACUA_SWAP_ROUTER, ROUTER_QUOTE_ABI, provider)
  const poolAbi  = ['function liquidity() view returns (uint128)']
  const MIN_SWAP_POOL_LIQ = 100_000_000_000n

  let best: QuoteResult | null = null

  const singleResults = await Promise.allSettled(FEE_TIERS.map(async fee => {
    const [rawOut, poolAddr] = await router.quoteSingle(tokenIn, tokenOut, fee, netAmtIn)
    const out = BigInt(rawOut.toString())
    if (out === 0n) return null
    const pool = new ethers.Contract(poolAddr, poolAbi, provider)
    const liq  = BigInt((await pool.liquidity()).toString())
    if (liq < MIN_SWAP_POOL_LIQ) return null
    return { amountOut: out, fee, label: `V3 ${fee / 10000}%`, timestamp: Date.now() } as QuoteResult
  }))
  for (const r of singleResults) {
    if (r.status !== 'fulfilled' || !r.value) continue
    if (!best || r.value.amountOut > best.amountOut) best = r.value
  }

  const BRIDGE_TOKENS = [
    TOKENS.USDC, TOKENS.WLD, WETH_ADDR,
    '0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B',
  ].filter(b => b.toLowerCase() !== tokenIn.toLowerCase() && b.toLowerCase() !== tokenOut.toLowerCase())

  const multiResults = await Promise.allSettled(
    BRIDGE_TOKENS.flatMap(hop =>
      FEE_TIERS.flatMap(f1 => FEE_TIERS.map(async f2 => {
        try {
          const [r1] = await router.quoteSingle(tokenIn, hop, f1, netAmtIn)
          const mid = BigInt(r1.toString())
          if (mid === 0n) return null
          const [r2, poolAddr2] = await router.quoteSingle(hop, tokenOut, f2, mid)
          const out = BigInt(r2.toString())
          if (out === 0n) return null
          const pool2 = new ethers.Contract(poolAddr2, poolAbi, provider)
          const liq2  = BigInt((await pool2.liquidity()).toString())
          if (liq2 < MIN_SWAP_POOL_LIQ) return null
          const label = `Multi ${f1/10000}%→${f2/10000}%`
          return { amountOut: out, fee: f1, fee2: f2, multi: true, hopToken: hop, label, timestamp: Date.now() } as QuoteResult
        } catch { return null }
      }))
    )
  )
  for (const r of multiResults) {
    if (r.status !== 'fulfilled' || !r.value) continue
    if (!best || r.value.amountOut > best.amountOut) best = r.value
  }
  return best
}

// ─── Countdown component ──────────────────────────────────────────────────────
function Countdown({ secondsLeft }: { secondsLeft: number }) {
  const [secs, setSecs] = useState(secondsLeft)
  useEffect(() => { setSecs(secondsLeft) }, [secondsLeft])
  useEffect(() => {
    if (secs <= 0) return
    const id = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [secs])
  const d = Math.floor(secs / 86400); const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60); const s = secs % 60
  return (
    <span className="text-[9px] font-mono text-white/30">
      {d > 0 ? `${d}d ` : ''}{h > 0 ? `${h}h ` : ''}{m}m {s}s
    </span>
  )
}

// ─── TierRow ─────────────────────────────────────────────────────────────────
function TierRow({ threshold, reward, status, index }: { threshold: bigint; reward: bigint; status: number; index: number }) {
  const thNum  = (Number(threshold) / 1_000_000).toFixed(0)
  const rwNum  = parseFloat(ethers.formatEther(reward)).toFixed(2)
  const labels = ['🥉 Bronce', '🥈 Plata', '🥇 Oro', '💎 Diamante']
  const colors = [
    { bg: 'rgba(180,100,20,0.12)', border: 'rgba(180,100,20,0.25)', text: '#cd7f32' },
    { bg: 'rgba(160,160,180,0.12)', border: 'rgba(160,160,180,0.25)', text: '#b0b0c8' },
    { bg: 'rgba(255,215,0,0.12)', border: 'rgba(255,215,0,0.25)', text: '#ffd700' },
    { bg: 'rgba(0,200,255,0.12)', border: 'rgba(0,200,255,0.25)', text: '#00c8ff' },
  ]
  const c = colors[index % colors.length]
  const done = status >= 1
  return (
    <div className="rounded-lg p-1.5 flex items-center justify-between gap-1" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <div>
        <p className="text-[8px] font-bold" style={{ color: c.text }}>{labels[index] ?? `Tier ${index + 1}`}</p>
        <p className="text-[8px] text-white/40">Vol: ${thNum}</p>
      </div>
      <div className="text-right">
        <p className="text-[9px] font-bold font-mono" style={{ color: c.text }}>{rwNum} UTH2</p>
        {done && <p className="text-[7px] text-green-400">✓ completado</p>}
      </div>
    </div>
  )
}

// ─── TokenLogo ────────────────────────────────────────────────────────────────
function TokenLogo({ token, size = 'md' }: { token: TokenItem; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 26 : size === 'lg' ? 44 : 34
  const [err, setErr] = useState(false)
  return (
    <div className="rounded-full shrink-0 flex items-center justify-center overflow-hidden font-bold text-white"
      style={{ width: sz, height: sz, background: token.logoUri && !err ? 'transparent' : token.color + '33', flexShrink: 0 }}>
      {token.logoUri && !err
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={token.logoUri} alt={token.symbol} width={sz} height={sz} onError={() => setErr(true)} className="w-full h-full object-cover" />
        : <span style={{ fontSize: size === 'sm' ? 9 : size === 'lg' ? 15 : 11, color: token.color }}>{token.symbol.slice(0, 2)}</span>
      }
    </div>
  )
}

// ─── PnL helpers ─────────────────────────────────────────────────────────────
function loadEntryPrices(): Record<string, number> {
  try { return JSON.parse(lsGet(LS_ENTRY, '{}')) } catch { return {} }
}
function saveEntryPrice(addr: string, price: number) {
  try {
    const ep = loadEntryPrices()
    if (!ep[addr.toLowerCase()] && price > 0) {
      ep[addr.toLowerCase()] = price
      lsSet(LS_ENTRY, JSON.stringify(ep))
    }
  } catch {}
}

// ─── Mini stat card ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = '#00a3ff' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl p-2.5 space-y-0.5" style={{ background: `${color}0d`, border: `1px solid ${color}22` }}>
      <p className="text-[9px] text-white/40 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold font-mono" style={{ color }}>{value}</p>
      {sub && <p className="text-[9px] text-white/30">{sub}</p>}
    </div>
  )
}

// ─── Change badge ─────────────────────────────────────────────────────────────
function ChangeBadge({ pct, size = 'sm' }: { pct: number; size?: 'xs' | 'sm' }) {
  const up = pct >= 0
  const cls = size === 'xs' ? 'text-[8px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5'
  return (
    <span className={cn('rounded font-bold font-mono inline-flex items-center gap-0.5', cls,
      up ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400')}>
      {up ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
      {up ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

// ─── APR badge for known staking pools ────────────────────────────────────────
const TOKEN_APR: Record<string, string> = {
  H2O: '12% APY', WLD: '100% APR', SUSHI: '300% APR', FIRE: '~APR',
  USDC: '~APR', wCOP: '~APR', wARS: '~APR', BTCH2O: '~APR', AIR: '~APR',
}

// ═════════════════════════════════════════════════════════════════════════════
// ─── SwapPanel ────────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
export function SwapPanel({ userAddress, walletMode, importedSigner }: {
  userAddress: string
  isAdmin?: boolean
  walletMode?: import('@/lib/tx-signer').WalletMode
  importedSigner?: import('ethers').Wallet | null
}) {
  const [customTokens, setCustomTokens] = useState<TokenItem[]>(() => {
    try { return JSON.parse(lsGet(LS_CUSTOMS, '[]')) } catch { return [] }
  })
  const allTokens = [...DEFAULT_TOKENS, ...customTokens]

  // ── Main tab state ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'wallet' | 'swap' | 'markets' | 'send' | 'receive' | 'history'>('wallet')

  // ── Legacy view alias (for swap logic compatibility) ────────────────────────
  const view = activeTab === 'swap' ? 'swap' : 'wallet'
  const setView = (v: 'wallet' | 'swap') => setActiveTab(v)

  // ── Balances / prices ───────────────────────────────────────────────────────
  const [balances,   setBalances]   = useState<Record<string, bigint>>({})
  const [prices,     setPrices]     = useState<Record<string, number>>({})
  const [wldPrices,  setWldPrices]  = useState<Record<string, number>>({})
  const [changes24h, setChanges24h] = useState<Record<string, number>>({})
  const [volumes24h, setVolumes24h] = useState<Record<string, number>>({})
  const [entryPrices, setEntryPrices] = useState<Record<string, number>>({})
  const [loadingBal, setLoadingBal] = useState(false)
  const [lastPriceUpdate, setLastPriceUpdate] = useState(0)
  const [copied, setCopied] = useState(false)

  // ── Swap state ──────────────────────────────────────────────────────────────
  const [fromToken, setFromToken] = useState<TokenItem>(DEFAULT_TOKENS[0])
  const [toToken,   setToToken]   = useState<TokenItem>(DEFAULT_TOKENS[1])
  const [fromAmt,   setFromAmt]   = useState('')
  const [maxRawAmt, setMaxRawAmt] = useState<bigint | null>(null)
  const [quote,     setQuote]     = useState<QuoteResult | null>(null)
  const [quoting,   setQuoting]   = useState(false)
  const [swapping,  setSwapping]  = useState(false)
  const [swapStep,  setSwapStep]  = useState('')
  const [swapMsg,   setSwapMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null)
  const [impact,    setImpact]    = useState<number | null>(null)
  const [slipWarning, setSlipWarning] = useState<{ bps: number; level: 'warn' | 'high' } | null>(null)
  const [slippageMode, setSlippageMode]   = useState<'auto' | 'custom' | 'none'>('auto')
  const [customSlipPct, setCustomSlipPct] = useState('5')
  const [showSlipConfig, setShowSlipConfig] = useState(false)

  // ── Token expansion / stats ─────────────────────────────────────────────────
  const [expandedToken, setExpandedToken] = useState<string | null>(null)
  const [chartInterval, setChartInterval] = useState<'5' | '60' | '1D'>('60')
  const [tokenStats, setTokenStats] = useState<Record<string, {
    pairAddress?: string; priceUsd?: number; liquidityUsd?: number
    volume24h?: number; fdv?: number; change5m?: number; change1h?: number; change24h?: number
    loading?: boolean; fetched?: boolean
  }>>({})

  // ── Send ────────────────────────────────────────────────────────────────────
  const [sendToken, setSendToken] = useState<TokenItem>(DEFAULT_TOKENS[0])
  const [sendTo,    setSendTo]    = useState('')
  const [sendAmt,   setSendAmt]   = useState('')
  const [sending,   setSending]   = useState(false)
  const [sendMsg,   setSendMsg]   = useState<{ ok: boolean; text: string } | null>(null)
  const sendTokenRef = useRef(sendToken)
  useEffect(() => { sendTokenRef.current = sendToken }, [sendToken])

  // ── History ─────────────────────────────────────────────────────────────────
  const [txHistory,   setTxHistory]   = useState<{ hash: string; from: string; to: string; value: string; token: string; time: number }[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [histLoaded,  setHistLoaded]  = useState(false)

  // ── Add custom token ────────────────────────────────────────────────────────
  const [addAddr,    setAddAddr]    = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addMsg,     setAddMsg]     = useState('')
  const [searchQ,    setSearchQ]    = useState('')
  const [showPicker, setShowPicker] = useState(false)

  // ── Volume / WDD ────────────────────────────────────────────────────────────
  const [volOpen,     setVolOpen]     = useState(false)
  const [loadingVol,  setLoadingVol]  = useState(false)
  const [claimingVol, setClaimingVol] = useState(false)
  const [volMsg,      setVolMsg]      = useState<{ ok: boolean; text: string } | null>(null)
  const [volData, setVolData] = useState<{
    uth2Amount: bigint; userVolume: bigint; tierStatus: number[]
    monthId: bigint; secondsLeft: number; thresholds: bigint[]; rewards: bigint[]
    totalDistributed: bigint; userTotalClaimed: bigint; globalMonthVolume: bigint
  } | null>(null)
  const [wddInfo,     setWddInfo]     = useState<ClaimInfo | null>(null)
  const [wddPending,  setWddPending]  = useState<bigint>(0n)
  const [claimingWDD, setClaimingWDD] = useState(false)
  const [wddMsg,      setWddMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  // ── QR ─────────────────────────────────────────────────────────────────────
  function qrUrl(addr: string) {
    return `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(addr)}&choe=UTF-8`
  }

  // ── Load history ─────────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!userAddress || histLoading) return
    setHistLoading(true)
    try {
      const url = `https://worldscan.org/api?module=account&action=tokentx&address=${userAddress}&startblock=0&endblock=99999999&sort=desc&offset=25&page=1`
      const res = await fetch(url)
      const json = await res.json()
      if (json.status === '1' && Array.isArray(json.result)) {
        const entries = json.result.slice(0, 25).map((r: any) => ({
          hash: r.hash, from: r.from, to: r.to,
          value: ethers.formatUnits(r.value ?? '0', parseInt(r.tokenDecimal || '18')),
          token: r.tokenSymbol ?? '?', time: parseInt(r.timeStamp) * 1000,
        }))
        setTxHistory(entries)
      } else {
        const url2 = `https://worldscan.org/api?module=account&action=txlist&address=${userAddress}&startblock=0&endblock=99999999&sort=desc&offset=10&page=1`
        const res2 = await fetch(url2)
        const json2 = await res2.json()
        if (json2.status === '1' && Array.isArray(json2.result)) {
          setTxHistory(json2.result.slice(0, 10).map((r: any) => ({
            hash: r.hash, from: r.from, to: r.to,
            value: ethers.formatEther(r.value ?? '0'), token: 'WLD', time: parseInt(r.timeStamp) * 1000,
          })))
        }
      }
      setHistLoaded(true)
    } catch { setHistLoaded(true) }
    finally { setHistLoading(false) }
  }, [userAddress, histLoading])

  useEffect(() => {
    if (activeTab === 'history' && !histLoaded) loadHistory()
  }, [activeTab, histLoaded, loadHistory])

  // ── Detect wallet tokens ────────────────────────────────────────────────────
  const detectWalletTokens = useCallback(async () => {
    if (!userAddress) return
    try {
      const p = getProvider()
      const checks = await Promise.allSettled(
        DEFAULT_TOKENS.map(async t => {
          const c = new ethers.Contract(t.address, ERC20_ABI, p)
          const bal = BigInt((await c.balanceOf(userAddress)).toString())
          return { token: t, bal }
        })
      )
      const withBal: string[] = []
      checks.forEach(r => {
        if (r.status === 'fulfilled' && r.value.bal > 0n) withBal.push(r.value.token.address.toLowerCase())
      })
      if (withBal.length > 0) lsSet('acua_with_balance', JSON.stringify(withBal))
    } catch {}
  }, [userAddress])

  // ── Load balances + prices ──────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setLoadingBal(true)
    try {
      const p = getProvider()
      const settled = await Promise.allSettled(
        allTokens.map(async t => {
          const c = new ethers.Contract(t.address, ERC20_ABI, p)
          return { addr: t.address, bal: BigInt((await c.balanceOf(userAddress)).toString()) }
        })
      )
      const bals: Record<string, bigint> = {}
      settled.forEach(r => { if (r.status === 'fulfilled') bals[r.value.addr.toLowerCase()] = r.value.bal })
      setBalances(bals)

      const { usdPrices, wldPrices: wldP, change24h, volume24h } = await fetchAllTokenPrices(allTokens)
      setPrices(usdPrices); setWldPrices(wldP)
      setChanges24h(change24h); setVolumes24h(volume24h)
      setLastPriceUpdate(Date.now())

      // Store entry prices for PnL (only first time for each token with balance)
      const ep = loadEntryPrices()
      allTokens.forEach(t => {
        const addrL = t.address.toLowerCase()
        const bal   = bals[addrL] ?? 0n
        const price = usdPrices[addrL]
        if (bal > 0n && price && price > 0 && !ep[addrL]) {
          saveEntryPrice(t.address, price)
        }
      })
      setEntryPrices(loadEntryPrices())
    } catch (e) { console.error('[Swap] loadBalances', e) }
    finally { setLoadingBal(false) }
  }, [userAddress, allTokens.length]) // eslint-disable-line

  useEffect(() => { loadBalances(); detectWalletTokens() }, [loadBalances]) // eslint-disable-line

  // ── Auto-refresh prices every 30s ────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const { usdPrices, wldPrices: wldP, change24h, volume24h } = await fetchAllTokenPrices(allTokens)
        if (Object.keys(usdPrices).length > 0) {
          setPrices(usdPrices); setWldPrices(wldP)
          setChanges24h(change24h); setVolumes24h(volume24h)
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
        const imp = calcImpactBps(rawAmt, fTok.decimals, prices[fTok.address.toLowerCase()] ?? 0,
          result.amountOut, tTok.decimals, prices[tTok.address.toLowerCase()] ?? 0)
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

  // ── Token stats for market view ─────────────────────────────────────────────
  const fetchTokenStats = useCallback(async (tokenAddr: string) => {
    const key = tokenAddr.toLowerCase()
    setTokenStats(s => ({ ...s, [key]: { ...(s[key] ?? {}), loading: true } }))
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddr}`, { signal: AbortSignal.timeout(6000) })
      const data = await res.json()
      if (!Array.isArray(data.pairs)) { setTokenStats(s => ({ ...s, [key]: { loading: false, fetched: true } })); return }
      let best: any = null
      for (const pair of data.pairs) {
        const chainId = (pair.chainId ?? '').toLowerCase()
        if (!WORLDCHAIN_IDS.has(chainId)) continue
        const liq = parseFloat(pair.liquidity?.usd ?? '0')
        if (!liq || liq < 100) continue
        const score = pairScore(pair.quoteToken?.address ?? '')
        if (!best || score > best.score || (score === best.score && liq > best.liq)) best = { pair, liq, score }
      }
      if (!best) { setTokenStats(s => ({ ...s, [key]: { loading: false, fetched: true } })); return }
      const p = best.pair
      setTokenStats(s => ({
        ...s,
        [key]: {
          pairAddress: p.pairAddress,
          priceUsd:    parseFloat(p.priceUsd ?? '0') || undefined,
          liquidityUsd: parseFloat(p.liquidity?.usd ?? '0') || undefined,
          volume24h:   parseFloat(p.volume?.h24 ?? '0') || undefined,
          fdv:         parseFloat(p.fdv ?? '0') || undefined,
          change5m:    parseFloat(p.priceChange?.m5  ?? '0'),
          change1h:    parseFloat(p.priceChange?.h1  ?? '0'),
          change24h:   parseFloat(p.priceChange?.h24 ?? '0'),
          loading: false, fetched: true,
        },
      }))
    } catch { setTokenStats(s => ({ ...s, [key]: { loading: false, fetched: true } })) }
  }, [])

  const toggleExpand = useCallback((tokenAddr: string) => {
    const key = tokenAddr.toLowerCase()
    setExpandedToken(prev => {
      const next = prev === key ? null : key
      if (next && !tokenStats[key]?.fetched) fetchTokenStats(tokenAddr)
      return next
    })
  }, [tokenStats, fetchTokenStats])

  // ── MAX helper ───────────────────────────────────────────────────────────────
  const setMax = useCallback(() => {
    const bal = balances[fromToken.address.toLowerCase()] ?? 0n
    if (bal === 0n) return
    setMaxRawAmt(bal)
    setFromAmt(ethers.formatUnits(bal, fromToken.decimals))
  }, [balances, fromToken])
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
        uth2Amount: BigInt(uth2.toString()), userVolume: BigInt(vol.toString()),
        tierStatus: Array.from(tiers).map((v: any) => Number(v)), monthId: monthIdBig,
        secondsLeft: Number(secsLeft.toString()),
        thresholds: Array.from(ths).map((v: any) => BigInt(v.toString())),
        rewards: Array.from(rws).map((v: any) => BigInt(v.toString())),
        totalDistributed: BigInt(totalDist.toString()), userTotalClaimed, globalMonthVolume,
      })
    } catch (e) { console.error('[Vol]', e) }
    finally { setLoadingVol(false) }
  }, [userAddress]) // eslint-disable-line
  useEffect(() => { loadVolume() }, [loadVolume])

  // ── WDD ──────────────────────────────────────────────────────────────────────
  const loadWDD = useCallback(async () => {
    if (!userAddress) return
    try {
      const info = await fetchWDDClaimInfo(userAddress)
      setWddInfo(info)
      setWddPending(projectedRewards(info, BigInt(Math.floor(Date.now() / 1000))))
    } catch (e) { console.error('[WDD]', e) }
  }, [userAddress])
  useEffect(() => { loadWDD() }, [loadWDD])
  useEffect(() => {
    const id = setInterval(() => { loadWDD() }, 30_000)
    return () => clearInterval(id)
  }, [loadWDD])
  useEffect(() => {
    if (!wddInfo || wddInfo.amountStaked === 0n) return
    const id = setInterval(() => {
      setWddPending(projectedRewards(wddInfo, BigInt(Math.floor(Date.now() / 1000))))
    }, 1000)
    return () => clearInterval(id)
  }, [wddInfo])

  // ── Claim WDD ─────────────────────────────────────────────────────────────────
  const doClaimWDD = useCallback(async () => {
    if (!wddInfo) { setWddMsg({ ok: false, text: 'Cargando datos…' }); return }
    if (wddPending === 0n) { setWddMsg({ ok: false, text: 'Sin WDD pendiente.' }); return }
    if (!MiniKit.isInstalled()) { setWddMsg({ ok: false, text: 'World App no disponible.' }); return }
    setClaimingWDD(true); setWddMsg(null)
    try {
      const feeBps = BigInt(wddInfo.feeBps || 3000)
      const feeAmount = (wddPending * feeBps) / 10000n
      if (feeAmount === 0n) { setWddMsg({ ok: false, text: 'Monto muy bajo. Acumula más.' }); return }
      const batch = buildWDDClaimBatch(feeAmount)
      const res = await MiniKit.commandsAsync.sendTransaction(batch)
      const finalPayload = res?.finalPayload ?? null
      if (!finalPayload) { setWddMsg({ ok: false, text: 'Sin respuesta de World App.' }); return }
      if (finalPayload.status === 'success') {
        setWddMsg({ ok: true, text: `✓ ${fmtWDD(wddPending)} WDD reclamado!` })
        setTimeout(loadWDD, 2500)
      } else { setWddMsg({ ok: false, text: parseMiniKitTxError(finalPayload) }) }
    } catch (e: any) {
      setWddMsg({ ok: false, text: e?.shortMessage ?? e?.message ?? 'Error inesperado' })
    } finally { setClaimingWDD(false) }
  }, [wddInfo, wddPending, loadWDD])

  // ── Claim volume ─────────────────────────────────────────────────────────────
  const doClaimVolume = useCallback(async () => {
    if (!volData || volData.uth2Amount === 0n) return
    if (!MiniKit.isInstalled()) { setVolMsg({ ok: false, text: 'World App no disponible.' }); return }
    setClaimingVol(true); setVolMsg(null)
    try {
      const res = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: ACUA_VOLUME_REWARDS, abi: CLAIM_ABI, functionName: 'claimRewards', args: [volData.monthId.toString()] }]
      })
      const finalPayload = res?.finalPayload ?? null
      if (!finalPayload) { setVolMsg({ ok: false, text: 'Sin respuesta.' }); return }
      if (finalPayload.status === 'success') {
        setVolMsg({ ok: true, text: `✓ ${parseFloat(ethers.formatEther(volData.uth2Amount)).toFixed(4)} UTH2 reclamado!` })
        setTimeout(loadVolume, 2000)
      } else { setVolMsg({ ok: false, text: parseMiniKitTxError(finalPayload) }) }
    } catch (e: any) {
      setVolMsg({ ok: false, text: e?.shortMessage ?? e?.message ?? 'Error inesperado' })
    } finally { setClaimingVol(false) }
  }, [volData, loadVolume])

  // ── Execute swap ──────────────────────────────────────────────────────────────
  const executeSwap = useCallback(async () => {
    if (!fromAmt || !quote) return
    const isImported = walletMode === 'imported' && !!importedSigner
    if (!isImported && !MiniKit.isInstalled()) {
      setSwapMsg({ ok: false, text: 'Abre dentro de World App para hacer swaps.' }); return
    }
    setSwapping(true); setSwapMsg(null); setSwapStep(''); setSlipWarning(null)
    try {
      const userBal = balances[fromToken.address.toLowerCase()] ?? 0n
      let rawAmt: bigint
      if (maxRawAmt !== null && maxRawAmt > 0n) {
        rawAmt = maxRawAmt > userBal ? userBal : maxRawAmt
      } else {
        try { rawAmt = ethers.parseUnits(fromAmt, fromToken.decimals) }
        catch { setSwapMsg({ ok: false, text: 'Monto inválido.' }); return }
      }
      if (rawAmt === 0n) { setSwapMsg({ ok: false, text: 'Monto debe ser mayor a cero.' }); return }
      if (rawAmt > userBal) rawAmt = userBal
      if (rawAmt === 0n) { setSwapMsg({ ok: false, text: `Saldo insuficiente de ${fromToken.symbol}.` }); return }

      setSwapStep('Verificando cotización...')
      let activeQuote = quote
      if (Date.now() - quote.timestamp > QUOTE_TTL_MS) {
        const net = rawAmt - rawAmt * BigInt(ACUA_FEE_BPS) / 10000n
        const fresh = await getBestRouteQuote(fromToken.address, toToken.address, net)
        if (!fresh) { setSwapMsg({ ok: false, text: 'Sin liquidez. Prueba otro token.' }); return }
        activeQuote = fresh
      }

      let effectiveSlipBps: number
      if (slippageMode === 'none') effectiveSlipBps = 0
      else if (slippageMode === 'custom') {
        const pct = parseFloat(customSlipPct)
        effectiveSlipBps = isNaN(pct) ? 100 : Math.min(Math.max(Math.round(pct * 100), 1), 4999)
      } else effectiveSlipBps = getAdaptiveSlippageBps(fromToken.address, toToken.address)
      const minOut = effectiveSlipBps === 0 ? 0n : activeQuote.amountOut * BigInt(10000 - effectiveSlipBps) / 10000n

      setSwapStep('Obteniendo precio actualizado...')
      let priceUsd = await fetchFreshTokenPrice(fromToken)
      if (!priceUsd) {
        priceUsd = prices[fromToken.address.toLowerCase()] ?? 0
        if (!priceUsd) {
          const wldP = wldPrices[fromToken.address.toLowerCase()]
          const wldUsd = prices[TOKENS.WLD.toLowerCase()]
          if (wldP && wldUsd) priceUsd = wldP * wldUsd
        }
      }
      const floatAmt = parseFloat(ethers.formatUnits(rawAmt, fromToken.decimals))
      const usdcEquivNum = Math.floor(floatAmt * priceUsd * 1_000_000)
      const usdcEquiv = BigInt(isNaN(usdcEquivNum) || usdcEquivNum < 0 ? 0 : usdcEquivNum)
      const nonce = randomNonce()
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const rawAmtStr = rawAmt.toString(); const nonceStr = nonce.toString(); const deadlineStr = deadline.toString()
      const permitArg = { permitted: { token: fromToken.address, amount: rawAmtStr }, nonce: nonceStr, deadline: deadlineStr }

      let swapTx: any
      if (activeQuote.multi && activeQuote.hopToken && activeQuote.fee2 !== undefined) {
        swapTx = { address: ACUA_SWAP_ROUTER, abi: SWAP_MULTI_ABI, functionName: 'swapV3Multi',
          args: [activeQuote.hopToken, toToken.address, activeQuote.fee.toString(), activeQuote.fee2.toString(), minOut.toString(), usdcEquiv.toString(), permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'] }
      } else {
        swapTx = { address: ACUA_SWAP_ROUTER, abi: SWAP_SINGLE_ABI, functionName: 'swapV3Single',
          args: [toToken.address, activeQuote.fee.toString(), minOut.toString(), usdcEquiv.toString(), permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'] }
      }

      if (isImported) {
        setSwapStep('Firmando con wallet importada...')
        await swapEthers(importedSigner!, ACUA_SWAP_ROUTER, fromToken.address, toToken.address, rawAmt, minOut, usdcEquiv,
          activeQuote.fee, activeQuote.multi ? activeQuote.fee2 : undefined, activeQuote.multi ? activeQuote.hopToken : undefined, m => setSwapStep(m))
        setSwapMsg({ ok: true, text: '✓ Swap confirmado' })
        setFromAmt(''); setQuote(null); setImpact(null)
        setTimeout(() => { loadBalances(); loadVolume() }, 3000)
        return
      }

      setSwapStep('Confirma en World App...')
      let res: any
      try {
        res = await MiniKit.commandsAsync.sendTransaction({
          transaction: [swapTx],
          permit2: [{ permitted: { token: fromToken.address, amount: rawAmtStr }, spender: ACUA_SWAP_ROUTER, nonce: nonceStr, deadline: deadlineStr }],
        })
      } catch (e: any) {
        setSwapMsg({ ok: false, text: e?.shortMessage ?? e?.message ?? 'Error al comunicarse con World App.' }); return
      }
      const finalPayload = res?.finalPayload ?? null
      if (!finalPayload) { setSwapMsg({ ok: false, text: 'World App no respondió.' }); return }
      if (finalPayload.status === 'success') {
        const txId = (finalPayload as any).transaction_id ?? ''
        const shortId = txId ? ` · tx ${txId.slice(0, 8)}…` : ''
        setSwapMsg({ ok: true, text: `✓ Swap confirmado${shortId}` })
        setFromAmt(''); setQuote(null); setImpact(null)
        setTimeout(() => { loadBalances(); loadVolume() }, 3000)
      } else {
        setSwapMsg({ ok: false, text: parseMiniKitTxError(finalPayload) })
      }
    } catch (e: any) {
      setSwapMsg({ ok: false, text: e?.shortMessage ?? e?.message ?? 'Error inesperado.' })
    } finally { setSwapping(false); setSwapStep('') }
  }, [fromAmt, quote, fromToken, toToken, prices, wldPrices, balances, maxRawAmt, loadBalances, loadVolume, slippageMode, customSlipPct, walletMode, importedSigner]) // eslint-disable-line

  const doSwap = useCallback(() => {
    if (!quote || !fromAmt) return
    const impBps = impact ?? null
    if (slippageMode !== 'none' && impBps !== null && impBps > IMPACT_WARN_BPS && !slipWarning) {
      setSlipWarning({ bps: impBps, level: impBps > IMPACT_HIGH_BPS ? 'high' : 'warn' }); return
    }
    executeSwap()
  }, [quote, fromAmt, impact, slipWarning, slippageMode, executeSwap])

  // ── Add custom token ─────────────────────────────────────────────────────────
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

  // ── Send token ───────────────────────────────────────────────────────────────
  const doSendToken = useCallback(async () => {
    const text = sendAmt.trim()
    if (!text || !sendTo || !sendTo.startsWith('0x')) return
    if (!MiniKit.isInstalled()) { setSendMsg({ ok: false, text: 'Abre dentro de World App para enviar.' }); return }
    setSending(true); setSendMsg(null)
    try {
      const TRANSFER_ABI = [{
        name: 'transfer', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }],
      }]
      const tok = sendTokenRef.current
      const parsed = ethers.parseUnits(text, tok.decimals)
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: tok.address, abi: TRANSFER_ABI as any, functionName: 'transfer', args: [sendTo, parsed.toString()] }],
      })
      if (finalPayload?.status === 'success') {
        setSendAmt(''); setSendTo(''); setSendMsg({ ok: true, text: `✓ Enviado ${text} ${tok.symbol}` })
        setTimeout(() => loadBalances(), 3000)
      } else { setSendMsg({ ok: false, text: parseMiniKitTxError(finalPayload) }) }
    } catch (e: any) { setSendMsg({ ok: false, text: e?.message ?? 'Error al enviar' }) }
    finally { setSending(false) }
  }, [sendAmt, sendTo, loadBalances]) // eslint-disable-line

  // ── Computed helpers ─────────────────────────────────────────────────────────
  const getBal = (t: TokenItem) => balances[t.address.toLowerCase()] ?? 0n
  const getUsdVal = (t: TokenItem, bal: bigint) => {
    const p = prices[t.address.toLowerCase()]
    if (!p) return null
    return parseFloat(ethers.formatUnits(bal, t.decimals)) * p
  }
  const totalPortfolioUsd = (() => {
    let total = 0
    allTokens.forEach(t => {
      const v = getUsdVal(t, getBal(t))
      if (v) total += v
    })
    return total
  })()
  const portfolio24hChange = (() => {
    let weightedChange = 0; let totalWeight = 0
    allTokens.forEach(t => {
      const v = getUsdVal(t, getBal(t))
      const ch = changes24h[t.address.toLowerCase()]
      if (v && v > 0 && ch != null) { weightedChange += ch * v; totalWeight += v }
    })
    return totalWeight > 0 ? weightedChange / totalWeight : null
  })()

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

  // ── Token picker modal ───────────────────────────────────────────────────────
  const filteredTokens = allTokens.filter(t =>
    !searchQ || t.symbol.toLowerCase().includes(searchQ.toLowerCase()) || t.name.toLowerCase().includes(searchQ.toLowerCase())
  )

  // ─────────────────────────────────────────────────────────────────────────────
  // ─── RENDER ──────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-0 flex flex-col" style={{ minHeight: 0 }}>

      {/* ══════════════════════════════════════════════════════════════════════
          HEADER — ACUA DEX 2026
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl overflow-hidden mb-2" style={{
        background: 'linear-gradient(135deg, #030d1a 0%, #050f20 50%, #030d1a 100%)',
        border: '1px solid rgba(0,163,255,0.18)',
        boxShadow: '0 0 40px rgba(0,122,255,0.08), inset 0 1px 0 rgba(0,163,255,0.12)',
      }}>
        {/* Top status bar */}
        <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid rgba(0,163,255,0.08)', background: 'rgba(0,80,255,0.04)' }}>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[9px] font-bold text-green-400/80 tracking-wider">WORLD CHAIN · LIVE</span>
          </div>
          <div className="flex items-center gap-2">
            {lastPriceUpdate > 0 && (
              <span className="text-[9px] font-mono text-white/25">
                ● {Math.floor((Date.now() - lastPriceUpdate) / 1000)}s
              </span>
            )}
            <button onClick={() => { loadBalances(); loadVolume() }} disabled={loadingBal}
              className="w-5 h-5 flex items-center justify-center rounded text-white/25 hover:text-blue-400 transition-colors">
              <RefreshCw className={cn('w-3 h-3', loadingBal && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Portfolio overview */}
        <div className="px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] text-white/35 uppercase tracking-widest mb-0.5">Balance Total</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono" style={{
                  background: 'linear-gradient(135deg, #fff 0%, #7eb5ff 60%, #0084ff 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>
                  ${totalPortfolioUsd > 0 ? totalPortfolioUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </span>
                {portfolio24hChange != null && (
                  <ChangeBadge pct={portfolio24hChange} />
                )}
              </div>
              <a href={`https://worldscan.org/address/${userAddress}`} target="_blank" rel="noopener noreferrer"
                className="text-[9px] font-mono text-blue-400/40 hover:text-blue-300 transition-colors flex items-center gap-0.5 mt-0.5">
                {userAddress.slice(0, 8)}…{userAddress.slice(-6)} <ArrowRight className="w-2 h-2" />
              </a>
            </div>
            {/* Mini stats */}
            <div className="text-right shrink-0">
              {volData && volData.uth2Amount > 0n && (
                <div className="text-[9px] text-teal-400 font-bold mb-1">
                  ✦ {parseFloat(ethers.formatEther(volData.uth2Amount)).toFixed(3)} UTH2
                </div>
              )}
              {wddPending > 0n && (
                <div className="text-[9px] text-indigo-400 font-bold">
                  ✦ {fmtWDD(wddPending)} WDD
                </div>
              )}
              <div className="text-[9px] text-white/20 mt-1 font-mono">ACUA DEX v3</div>
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="grid grid-cols-6 gap-0" style={{ borderTop: '1px solid rgba(0,163,255,0.08)' }}>
          {([
            { key: 'wallet',  icon: <Wallet className="w-3.5 h-3.5" />,         label: 'Wallet'   },
            { key: 'swap',    icon: <Repeat2 className="w-3.5 h-3.5" />,         label: 'Swap'     },
            { key: 'markets', icon: <CandlestickChart className="w-3.5 h-3.5" />, label: 'Markets'  },
            { key: 'send',    icon: <Send className="w-3.5 h-3.5" />,            label: 'Enviar'   },
            { key: 'receive', icon: <QrCode className="w-3.5 h-3.5" />,          label: 'Recibir'  },
            { key: 'history', icon: <History className="w-3.5 h-3.5" />,         label: 'Historial'},
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="flex flex-col items-center gap-0.5 py-2.5 px-1 transition-all relative"
              style={{
                background: activeTab === tab.key ? 'rgba(0,122,255,0.12)' : 'transparent',
                color: activeTab === tab.key ? '#00a3ff' : 'rgba(255,255,255,0.3)',
              }}>
              {activeTab === tab.key && (
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-b" style={{ background: 'linear-gradient(90deg, transparent, #00a3ff, transparent)' }} />
              )}
              {tab.icon}
              <span className="text-[8px] font-bold">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          REWARDS STRIP (compact, always visible)
      ══════════════════════════════════════════════════════════════════════ */}
      {(volData?.uth2Amount ?? 0n) > 0n || wddPending > 0n ? (
        <div className="rounded-xl mb-2 overflow-hidden" style={{ background: 'rgba(0,30,60,0.7)', border: '1px solid rgba(0,163,255,0.12)' }}>
          <div className="flex items-center gap-0 divide-x" style={{ divideColor: 'rgba(0,163,255,0.08)' }}>
            {/* UTH2 */}
            {volData && volData.uth2Amount > 0n && (
              <div className="flex-1 flex items-center gap-2 px-3 py-2">
                <TrendingUp className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-teal-300 font-bold leading-tight">{parseFloat(ethers.formatEther(volData.uth2Amount)).toFixed(4)} UTH2</p>
                  <p className="text-[8px] text-white/30">Vol. rewards</p>
                </div>
                <button onClick={doClaimVolume} disabled={claimingVol}
                  className="h-6 px-2 rounded-lg text-[9px] font-bold text-white shrink-0 disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#14b8a6,#0891b2)' }}>
                  {claimingVol ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Reclamar'}
                </button>
              </div>
            )}
            {/* WDD */}
            {wddPending > 0n && (
              <div className="flex-1 flex items-center gap-2 px-3 py-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-indigo-300 font-bold leading-tight">{fmtWDD(wddPending)} WDD</p>
                  <p className="text-[8px] text-white/30">Acumulando</p>
                </div>
                <button onClick={doClaimWDD} disabled={claimingWDD || wddPending === 0n}
                  className="h-6 px-2 rounded-lg text-[9px] font-bold text-white shrink-0 disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                  {claimingWDD ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Reclamar'}
                </button>
              </div>
            )}
          </div>
          {(volMsg || wddMsg) && (
            <div className={cn('mx-3 mb-2 rounded-lg px-2 py-1 text-[9px] font-medium',
              (volMsg?.ok ?? wddMsg?.ok) ? 'bg-green-500/10 text-green-300 border border-green-500/15' : 'bg-red-500/10 text-red-300 border border-red-500/15')}>
              {volMsg?.text ?? wddMsg?.text}
            </div>
          )}
        </div>
      ) : null}

      {/* Token picker modal */}
      {pickerFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => { setPickerFor(null); setSearchQ('') }} />
          <div className="relative w-full max-w-sm rounded-t-3xl overflow-hidden flex flex-col" style={{ maxHeight: '70vh', background: '#030d1a', border: '1px solid rgba(0,163,255,0.2)', borderBottom: 'none' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(0,163,255,0.1)' }}>
              <p className="text-sm font-bold text-white">Seleccionar token</p>
              <button onClick={() => { setPickerFor(null); setSearchQ('') }} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5"><X className="w-4 h-4 text-white/50" /></button>
            </div>
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.15)' }}>
                <Search className="w-4 h-4 text-blue-400/50 shrink-0" />
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Buscar token..."
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-white/25 outline-none" autoFocus />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-2 pb-4">
              {filteredTokens.map(t => {
                const bal = getBal(t)
                const usd = getUsdVal(t, bal)
                return (
                  <button key={t.address}
                    onClick={() => {
                      if (pickerFor === 'from') setFromToken(t)
                      else if (pickerFor === 'to') setToToken(t)
                      else if (pickerFor === 'from') setSendToken(t)
                      setPickerFor(null); setSearchQ('')
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors">
                    <TokenLogo token={t} size="sm" />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold text-white">{t.symbol}</p>
                      <p className="text-[10px] text-white/30 truncate">{t.name}</p>
                    </div>
                    <div className="text-right">
                      {bal > 0n && <p className="text-xs font-mono text-white/70">{formatToken(bal, t.decimals, 4)}</p>}
                      {usd && usd > 0 && <p className="text-[10px] text-blue-400 font-mono">${usd.toFixed(2)}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB CONTENT
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-2xl overflow-hidden" style={{
        background: 'linear-gradient(180deg, #030d1a 0%, #050f20 100%)',
        border: '1px solid rgba(0,163,255,0.12)',
        boxShadow: '0 0 24px rgba(0,80,255,0.06)',
      }}>

        {/* ── WALLET TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'wallet' && (
          <div className="p-3 space-y-2">
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Portfolio" value={totalPortfolioUsd > 0 ? `$${shortNum(totalPortfolioUsd)}` : '—'} sub="Total USD" color="#00a3ff" />
              <StatCard label="24h Cambio" value={portfolio24hChange != null ? `${portfolio24hChange >= 0 ? '+' : ''}${portfolio24hChange.toFixed(2)}%` : '—'}
                sub={portfolio24hChange != null ? (portfolio24hChange >= 0 ? '▲ ganando' : '▼ perdiendo') : 'sin datos'}
                color={portfolio24hChange == null ? '#6b7280' : portfolio24hChange >= 0 ? '#22c55e' : '#ef4444'} />
              <StatCard label="Tokens" value={allTokens.filter(t => getBal(t) > 0n).length.toString()} sub="con saldo" color="#8b5cf6" />
            </div>

            {loadingBal && Object.keys(balances).length === 0 && (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-400" /></div>
            )}

            {/* Token list */}
            {allTokens.map(token => {
              const tokenKey = token.address.toLowerCase()
              const bal = getBal(token)
              const usdVal = getUsdVal(token, bal)
              const usdPrice = prices[tokenKey]
              const ch24 = changes24h[tokenKey]
              const vol24 = volumes24h[tokenKey]
              const entry = entryPrices[tokenKey]
              const pnlPct = entry && usdPrice && entry > 0 ? ((usdPrice - entry) / entry) * 100 : null
              const apr = TOKEN_APR[token.symbol]
              const isExpanded = expandedToken === tokenKey
              const stats = tokenStats[tokenKey]
              if (bal === 0n && !isExpanded) {
                return (
                  <button key={token.address} onClick={() => toggleExpand(token.address)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left hover:bg-white/[0.03] transition-colors"
                    style={{ background: 'rgba(0,50,100,0.03)', border: '1px solid rgba(0,163,255,0.06)' }}>
                    <TokenLogo token={token} size="sm" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-semibold text-white/50">{token.symbol}</span>
                    </div>
                    {usdPrice && <span className="text-[10px] font-mono text-white/30">{fmtUsd(usdPrice)}</span>}
                    {ch24 != null && <ChangeBadge pct={ch24} size="xs" />}
                    {apr && <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ background: 'rgba(0,122,255,0.15)', color: '#60a5fa' }}>{apr}</span>}
                    <ChevronDown className="w-3 h-3 text-white/20 shrink-0" />
                  </button>
                )
              }
              return (
                <div key={token.address} className="rounded-xl overflow-hidden transition-all"
                  style={{ background: isExpanded ? 'rgba(0,80,255,0.06)' : CARD_BG, border: `1px solid ${isExpanded ? CARD_BORDER_ACTIVE : CARD_BORDER}` }}>
                  <button onClick={() => toggleExpand(token.address)} className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.02] transition-colors">
                    <TokenLogo token={token} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-white">{token.symbol}</span>
                        {token.isCustom && <span className="text-[8px] text-white/25 border border-white/10 rounded px-1">custom</span>}
                        {apr && <span className="text-[8px] font-bold px-1 py-px rounded" style={{ background: 'rgba(0,163,255,0.15)', color: '#60a5fa' }}>{apr}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {usdPrice && <span className="text-[10px] font-mono text-blue-300/80">{fmtUsd(usdPrice)}</span>}
                        {ch24 != null && <ChangeBadge pct={ch24} size="xs" />}
                        {vol24 != null && vol24 > 0 && <span className="text-[9px] text-white/25 font-mono">vol ${shortNum(vol24)}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold font-mono text-white">{formatToken(bal, token.decimals, 4)}</p>
                      {usdVal != null && usdVal > 0.001 && <p className="text-[11px] font-mono text-blue-300">${usdVal.toFixed(2)}</p>}
                      {pnlPct != null && (
                        <p className={cn('text-[9px] font-mono font-bold mt-px', pnlPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pnlPct >= 0 ? '▲' : '▼'} {Math.abs(pnlPct).toFixed(1)}% PnL
                        </p>
                      )}
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-blue-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/25 shrink-0" />}
                  </button>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(0,163,255,0.1)' }}>
                      {/* PnL detail */}
                      {entry && usdPrice && (
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="rounded-lg p-2" style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.12)' }}>
                            <p className="text-[8px] text-white/35 uppercase tracking-wide">Precio entrada</p>
                            <p className="text-xs font-bold font-mono text-white/70">{fmtUsd(entry)}</p>
                          </div>
                          <div className="rounded-lg p-2" style={{
                            background: pnlPct != null && pnlPct >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                            border: `1px solid ${pnlPct != null && pnlPct >= 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}`,
                          }}>
                            <p className="text-[8px] text-white/35 uppercase tracking-wide">PnL</p>
                            <p className={cn('text-xs font-bold font-mono', pnlPct != null && pnlPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                              {pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : '—'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Stats grid: 5m / 1h / 24h changes */}
                      {stats?.fetched && (stats.change5m != null || stats.change1h != null || stats.change24h != null) && (
                        <div className="grid grid-cols-3 gap-1">
                          {[{ l: '5m', v: stats.change5m ?? 0 }, { l: '1h', v: stats.change1h ?? 0 }, { l: '24h', v: stats.change24h ?? 0 }].map(c => (
                            <div key={c.l} className="rounded-lg p-1.5 text-center font-mono"
                              style={{ background: c.v >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${c.v >= 0 ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)'}` }}>
                              <p className="text-[8px] text-white/35 uppercase">{c.l}</p>
                              <p className={cn('text-[10px] font-bold', c.v >= 0 ? 'text-green-400' : 'text-red-400')}>{c.v >= 0 ? '+' : ''}{c.v.toFixed(2)}%</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Market stats */}
                      {stats?.fetched && (stats.liquidityUsd || stats.volume24h || stats.fdv) && (
                        <div className="grid grid-cols-3 gap-1">
                          {stats.liquidityUsd != null && stats.liquidityUsd > 0 && (
                            <div className="rounded-lg p-1.5" style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.1)' }}>
                              <p className="text-[8px] text-white/35 flex items-center gap-0.5"><Droplets className="w-2 h-2" />Liq.</p>
                              <p className="text-[10px] font-bold font-mono text-blue-300">${shortNum(stats.liquidityUsd)}</p>
                            </div>
                          )}
                          {stats.volume24h != null && stats.volume24h > 0 && (
                            <div className="rounded-lg p-1.5" style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.1)' }}>
                              <p className="text-[8px] text-white/35 flex items-center gap-0.5"><Activity className="w-2 h-2" />Vol.</p>
                              <p className="text-[10px] font-bold font-mono text-blue-300">${shortNum(stats.volume24h)}</p>
                            </div>
                          )}
                          {stats.fdv != null && stats.fdv > 0 && (
                            <div className="rounded-lg p-1.5" style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.1)' }}>
                              <p className="text-[8px] text-white/35 flex items-center gap-0.5"><BarChart2 className="w-2 h-2" />FDV</p>
                              <p className="text-[10px] font-bold font-mono text-blue-300">${shortNum(stats.fdv)}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Chart */}
                      {stats?.loading && (
                        <div className="h-36 flex items-center justify-center rounded-lg" style={{ background: 'rgba(0,0,0,0.3)' }}>
                          <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                        </div>
                      )}
                      {stats?.fetched && stats.pairAddress && (
                        <div>
                          <div className="flex items-center gap-1 mb-1">
                            {(['5', '60', '1D'] as const).map(tf => (
                              <button key={tf} onClick={() => setChartInterval(tf)}
                                className={cn('px-2 py-0.5 text-[9px] font-bold rounded transition-colors',
                                  chartInterval === tf ? 'text-white' : 'text-white/30 hover:text-white/60')}
                                style={chartInterval === tf ? { background: 'rgba(0,122,255,0.3)', border: '1px solid rgba(0,163,255,0.4)' } : {}}>
                                {tf === '5' ? '5m' : tf === '60' ? '1h' : '1d'}
                              </button>
                            ))}
                          </div>
                          <div className="rounded-xl overflow-hidden" style={{ background: '#030d1a', border: '1px solid rgba(0,163,255,0.15)' }}>
                            <iframe
                              key={`${tokenKey}-${chartInterval}`}
                              src={`https://dexscreener.com/world/${stats.pairAddress}?embed=1&theme=dark&trades=0&info=0&interval=${chartInterval}`}
                              title={`${token.symbol} chart`} className="w-full" style={{ height: 240, border: 0 }} loading="lazy" />
                          </div>
                        </div>
                      )}

                      {/* Buy/Sell quick actions */}
                      <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <button onClick={() => {
                          const pay = token.address.toLowerCase() === TOKENS.USDC.toLowerCase()
                            ? DEFAULT_TOKENS.find(t => t.symbol === 'WLD')! : DEFAULT_TOKENS.find(t => t.symbol === 'USDC')!
                          setFromToken(pay); setToToken(token); setFromAmt(''); setMaxRawAmt(null); setExpandedToken(null); setActiveTab('swap')
                        }} className="h-9 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5"
                          style={{ background: 'linear-gradient(135deg,#10b981,#059669)', boxShadow: '0 0 12px rgba(16,185,129,0.2)' }}>
                          <ArrowDownToLine className="w-3.5 h-3.5" /> Comprar
                        </button>
                        <button onClick={() => {
                          const recv = token.address.toLowerCase() === TOKENS.USDC.toLowerCase()
                            ? DEFAULT_TOKENS.find(t => t.symbol === 'WLD')! : DEFAULT_TOKENS.find(t => t.symbol === 'USDC')!
                          setFromToken(token); setToToken(recv); setFromAmt(''); setMaxRawAmt(null); setExpandedToken(null); setActiveTab('swap')
                        }} disabled={bal === 0n}
                          className="h-9 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
                          style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)', boxShadow: '0 0 12px rgba(239,68,68,0.2)' }}>
                          <ArrowUpFromLine className="w-3.5 h-3.5" /> Vender
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Add custom token */}
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(0,40,80,0.5)', border: '1px solid rgba(0,163,255,0.08)' }}>
              <p className="text-[10px] font-semibold text-white/30 flex items-center gap-1"><Plus className="w-2.5 h-2.5" /> Agregar token por dirección</p>
              <div className="flex gap-2">
                <input value={addAddr} onChange={e => setAddAddr(e.target.value)} placeholder="0x..."
                  className="flex-1 min-w-0 text-xs font-mono rounded-lg px-3 py-2 text-white placeholder:text-white/20 outline-none"
                  style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.15)' }} />
                <Button size="sm" className="text-xs h-8 shrink-0 border-0" style={{ background: 'rgba(0,122,255,0.2)' }} onClick={addToken} disabled={addLoading}>
                  {addLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                </Button>
              </div>
              {addMsg && <p className={cn('text-[10px]', addMsg.includes('agregado') ? 'text-green-400' : 'text-red-400')}>{addMsg}</p>}
            </div>
          </div>
        )}

        {/* ── SWAP TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'swap' && (
          <div className="p-3 space-y-2.5">
            {/* Route + slippage bar */}
            <div className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: 'rgba(0,50,100,0.4)', border: '1px solid rgba(0,163,255,0.1)' }}>
              <span className="text-[10px] text-white/40 flex items-center gap-1">
                <Coins className="w-3 h-3 text-blue-400" /> 2.1% fee · Slippage:{' '}
                {slippageMode === 'none'
                  ? <strong className="text-red-400">Sin límite</strong>
                  : slippageMode === 'custom'
                    ? <strong className="text-yellow-400">{customSlipPct}%</strong>
                    : <strong className="text-green-400">{slippageLabel(getAdaptiveSlippageBps(fromToken.address, toToken.address))}</strong>}
              </span>
              <div className="flex items-center gap-1">
                {quote && (
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,122,255,0.15)', color: '#60a5fa' }}>
                    {quote.label}
                  </span>
                )}
                <button onClick={() => setShowSlipConfig(v => !v)} className="text-[9px] text-white/30 hover:text-blue-300 px-1 py-0.5 rounded transition-colors">
                  ⚙
                </button>
              </div>
            </div>

            {/* Slippage config */}
            {showSlipConfig && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(0,30,60,0.8)', border: '1px solid rgba(0,163,255,0.15)' }}>
                <p className="text-[10px] font-bold text-blue-300">Configurar slippage</p>
                <div className="flex gap-1.5">
                  {(['auto', 'custom', 'none'] as const).map(mode => (
                    <button key={mode} onClick={() => setSlippageMode(mode)}
                      className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors',
                        slippageMode === mode ? 'text-white' : 'text-white/40 hover:text-white/60')}
                      style={slippageMode === mode ? { background: 'rgba(0,122,255,0.3)', border: '1px solid rgba(0,163,255,0.4)' } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      {mode === 'auto' ? 'Auto' : mode === 'custom' ? 'Manual' : 'Sin límite'}
                    </button>
                  ))}
                </div>
                {slippageMode === 'custom' && (
                  <div className="flex items-center gap-2">
                    <input type="number" min="0.1" max="50" step="0.1" value={customSlipPct}
                      onChange={e => setCustomSlipPct(e.target.value)}
                      className="flex-1 text-xs font-mono rounded-lg px-3 py-1.5 text-white outline-none"
                      style={{ background: 'rgba(0,80,255,0.08)', border: '1px solid rgba(0,163,255,0.2)' }} />
                    <span className="text-[11px] text-white/40">%</span>
                  </div>
                )}
                {slippageMode === 'none' && (
                  <div className="flex items-center gap-1.5 text-[9px] text-red-400">
                    <AlertTriangle className="w-3 h-3" /> Riesgo alto. Puedes recibir mucho menos.
                  </div>
                )}
              </div>
            )}

            {/* FROM token */}
            <div className="rounded-2xl p-3.5 space-y-2" style={{ background: 'rgba(0,40,80,0.5)', border: '1px solid rgba(0,163,255,0.14)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/35 font-medium uppercase tracking-wider">De</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/30">
                    Saldo: <span className="text-blue-300 font-mono">{formatToken(getBal(fromToken), fromToken.decimals, 4)}</span>
                    {prices[fromToken.address.toLowerCase()] && getBal(fromToken) > 0n && (
                      <span className="text-blue-400/50 ml-1">${(parseFloat(ethers.formatUnits(getBal(fromToken), fromToken.decimals)) * (prices[fromToken.address.toLowerCase()] ?? 0)).toFixed(2)}</span>
                    )}
                  </span>
                  <button onClick={setMax} className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(0,122,255,0.2)', color: '#60a5fa', border: '1px solid rgba(0,163,255,0.3)' }}>MAX</button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setPickerFor('from')}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 hover:scale-[1.02] transition-all shrink-0"
                  style={{ background: 'rgba(0,80,255,0.1)', border: '1px solid rgba(0,163,255,0.2)' }}>
                  <TokenLogo token={fromToken} size="sm" />
                  <span className="text-sm font-bold text-white">{fromToken.symbol}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                </button>
                <input type="number" min="0" step="any" value={fromAmt} onChange={e => setFromAmt(e.target.value)} placeholder="0.00"
                  className="flex-1 text-right text-2xl font-bold font-mono bg-transparent text-white placeholder:text-white/15 outline-none" />
              </div>
              {fromAmt && prices[fromToken.address.toLowerCase()] && (
                <p className="text-[10px] text-white/30 text-right">
                  ≈ ${(parseFloat(fromAmt || '0') * (prices[fromToken.address.toLowerCase()] ?? 0)).toFixed(2)} USD
                </p>
              )}
            </div>

            {/* Flip button */}
            <div className="flex justify-center -my-1">
              <button onClick={() => { setFromToken(toToken); setToToken(fromToken); setFromAmt(''); setQuote(null) }}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                style={{ background: 'rgba(0,122,255,0.15)', border: '1px solid rgba(0,163,255,0.3)' }}>
                <ArrowUpDown className="w-4 h-4 text-blue-400" />
              </button>
            </div>

            {/* TO token */}
            <div className="rounded-2xl p-3.5 space-y-2" style={{ background: 'rgba(0,20,50,0.6)', border: '1px solid rgba(0,163,255,0.1)' }}>
              <span className="text-[10px] text-white/35 font-medium uppercase tracking-wider">A</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setPickerFor('to')}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 hover:scale-[1.02] transition-all shrink-0"
                  style={{ background: 'rgba(0,80,255,0.1)', border: '1px solid rgba(0,163,255,0.15)' }}>
                  <TokenLogo token={toToken} size="sm" />
                  <span className="text-sm font-bold text-white">{toToken.symbol}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                </button>
                <div className="flex-1 text-right">
                  {quoting ? (
                    <div className="flex items-center justify-end gap-1">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                      <span className="text-[11px] text-white/30">calculando…</span>
                    </div>
                  ) : quote ? (
                    <>
                      <p className="text-2xl font-bold font-mono text-white">{parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals)).toFixed(6)}</p>
                      {prices[toToken.address.toLowerCase()] && (
                        <p className="text-[10px] text-white/30">≈ ${(parseFloat(ethers.formatUnits(quote.amountOut, toToken.decimals)) * (prices[toToken.address.toLowerCase()] ?? 0)).toFixed(2)} USD</p>
                      )}
                    </>
                  ) : (
                    <p className="text-2xl font-bold font-mono text-white/15">0.000000</p>
                  )}
                </div>
              </div>
            </div>

            {/* Quote details */}
            {quote && (
              <div className="rounded-xl px-3 py-2 space-y-1" style={{ background: 'rgba(0,30,60,0.5)', border: '1px solid rgba(0,163,255,0.08)' }}>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/35">Tasa efectiva</span>
                  <span className="font-mono text-blue-300">1 {fromToken.symbol} = {effectiveRate} {toToken.symbol}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/35">Fee (2.1%)</span>
                  <span className="font-mono text-white/50">{feeAmt} {fromToken.symbol}</span>
                </div>
                {impactBps != null && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-white/35">Price impact</span>
                    <span className={cn('font-mono font-bold', impactBps > IMPACT_HIGH_BPS ? 'text-red-400' : impactBps > IMPACT_WARN_BPS ? 'text-yellow-400' : 'text-green-400')}>
                      {(impactBps / 100).toFixed(2)}%
                      {impactBps > IMPACT_HIGH_BPS && <AlertCircle className="w-3 h-3 inline ml-0.5" />}
                    </span>
                  </div>
                )}
                {quoteStale && (
                  <div className="flex items-center gap-1 text-[9px] text-yellow-400">
                    <Clock className="w-3 h-3" /> Cotización desactualizada ({quoteAge}s). Se refrescará al confirmar.
                  </div>
                )}
              </div>
            )}

            {/* Slip warning */}
            {slipWarning && (
              <div className="rounded-xl p-3 space-y-2" style={{
                background: slipWarning.level === 'high' ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.08)',
                border: `1px solid ${slipWarning.level === 'high' ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)'}`,
              }}>
                <div className="flex items-center gap-2">
                  <ShieldAlert className={cn('w-4 h-4 shrink-0', slipWarning.level === 'high' ? 'text-red-400' : 'text-yellow-400')} />
                  <div>
                    <p className="text-xs font-bold text-white">Price impact alto: {(slipWarning.bps / 100).toFixed(2)}%</p>
                    <p className="text-[10px] text-white/40">Perderás parte de tu dinero en este swap.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSlipWarning(null)} className="flex-1 h-8 rounded-lg text-xs font-bold text-white/60 hover:text-white transition-colors" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    Cancelar
                  </button>
                  <button onClick={() => { setSlipWarning(null); executeSwap() }}
                    className="flex-1 h-8 rounded-lg text-xs font-bold text-white"
                    style={{ background: slipWarning.level === 'high' ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : 'linear-gradient(135deg,#eab308,#ca8a04)' }}>
                    Confirmar igual
                  </button>
                </div>
              </div>
            )}

            {/* Status message */}
            {swapMsg && (
              <div className={cn('rounded-xl px-3 py-2.5 text-[11px] font-medium', swapMsg.ok ? 'bg-green-500/10 text-green-300 border border-green-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20')}>
                {swapMsg.text}
              </div>
            )}
            {swapStep && (
              <div className="flex items-center gap-2 text-[11px] text-blue-400/70">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> {swapStep}
              </div>
            )}

            {/* Swap button */}
            <button onClick={doSwap}
              disabled={swapping || quoting || !quote || !fromAmt || parseFloat(fromAmt) <= 0}
              className="w-full h-14 rounded-2xl text-base font-black text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #0066ff 0%, #0099ff 50%, #00ccff 100%)',
                boxShadow: '0 0 32px rgba(0,122,255,0.4), 0 4px 24px rgba(0,0,0,0.3)',
              }}>
              {swapping ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando…</> : <><Zap className="w-5 h-5" /> Swap {fromToken.symbol} → {toToken.symbol}</>}
            </button>

            {/* No liquidity warning */}
            {!quoting && fromAmt && parseFloat(fromAmt) > 0 && !quote && (
              <div className="rounded-xl px-3 py-2 flex items-center gap-2 text-[10px] text-yellow-400/80" style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.15)' }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Sin liquidez para este par en World Chain. Prueba otro token o monto.
              </div>
            )}
          </div>
        )}

        {/* ── MARKETS TAB ───────────────────────────────────────────────── */}
        {activeTab === 'markets' && (
          <div className="p-3 space-y-2">
            {/* Market overview */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl p-3 col-span-2" style={{ background: 'linear-gradient(135deg,rgba(0,80,255,0.08),rgba(0,40,120,0.08))', border: '1px solid rgba(0,163,255,0.15)' }}>
                <p className="text-[9px] text-white/35 uppercase tracking-widest mb-2 flex items-center gap-1"><Globe className="w-2.5 h-2.5" /> World Chain · Market Overview</p>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'WLD', addr: TOKENS.WLD },
                    { label: 'H2O', addr: TOKENS.H2O },
                    { label: 'USDC', addr: TOKENS.USDC },
                  ].map(t => {
                    const p = prices[t.addr.toLowerCase()]
                    const ch = changes24h[t.addr.toLowerCase()]
                    return (
                      <div key={t.label}>
                        <p className="text-[9px] text-white/40">{t.label}</p>
                        <p className="text-sm font-bold font-mono text-white">{p ? fmtUsd(p) : '—'}</p>
                        {ch != null && <ChangeBadge pct={ch} size="xs" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Token market list */}
            <p className="text-[10px] text-white/35 uppercase tracking-widest px-1 flex items-center gap-1"><CandlestickChart className="w-3 h-3" /> Todos los tokens</p>
            {DEFAULT_TOKENS.map(token => {
              const tokenKey = token.address.toLowerCase()
              const usdPrice = prices[tokenKey]
              const ch24 = changes24h[tokenKey]
              const vol24 = volumes24h[tokenKey]
              const wldP = wldPrices[tokenKey]
              const bal = getBal(token)
              const usdVal = getUsdVal(token, bal)
              const apr = TOKEN_APR[token.symbol]
              const entry = entryPrices[tokenKey]
              const pnlPct = entry && usdPrice && entry > 0 ? ((usdPrice - entry) / entry) * 100 : null
              const isExpanded = expandedToken === `mkt-${tokenKey}`
              const stats = tokenStats[tokenKey]

              return (
                <div key={token.address} className="rounded-xl overflow-hidden transition-all"
                  style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
                  <div className="flex items-center gap-2.5 p-2.5">
                    <TokenLogo token={token} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-white">{token.symbol}</span>
                        {apr && <span className="text-[8px] font-bold px-1 py-px rounded" style={{ background: 'rgba(0,163,255,0.12)', color: '#60a5fa' }}>{apr}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 mt-px flex-wrap">
                        <span className="text-[10px] font-mono text-white/60">{usdPrice ? fmtUsd(usdPrice) : '—'}</span>
                        {wldP && token.symbol !== 'WLD' && <span className="text-[9px] text-blue-400/50 font-mono">{fmtWld(wldP)}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      {ch24 != null && <div><ChangeBadge pct={ch24} size="xs" /></div>}
                      {vol24 != null && vol24 > 0 && <p className="text-[8px] text-white/25 font-mono">vol ${shortNum(vol24)}</p>}
                      {pnlPct != null && bal > 0n && (
                        <p className={cn('text-[8px] font-bold font-mono', pnlPct >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pnlPct >= 0 ? '▲' : '▼'}{Math.abs(pnlPct).toFixed(1)}% PnL
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={() => {
                        const pay = token.address.toLowerCase() === TOKENS.USDC.toLowerCase()
                          ? DEFAULT_TOKENS.find(t => t.symbol === 'WLD')! : DEFAULT_TOKENS.find(t => t.symbol === 'USDC')!
                        setFromToken(pay); setToToken(token); setFromAmt(''); setActiveTab('swap')
                      }} className="h-6 px-2 rounded text-[8px] font-bold text-white"
                        style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>Buy</button>
                      {bal > 0n && (
                        <button onClick={() => {
                          const recv = token.address.toLowerCase() === TOKENS.USDC.toLowerCase()
                            ? DEFAULT_TOKENS.find(t => t.symbol === 'WLD')! : DEFAULT_TOKENS.find(t => t.symbol === 'USDC')!
                          setFromToken(token); setToToken(recv); setFromAmt(''); setActiveTab('swap')
                        }} className="h-6 px-2 rounded text-[8px] font-bold text-white"
                          style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)' }}>Sell</button>
                      )}
                    </div>
                    <button onClick={() => {
                      const mktKey = `mkt-${tokenKey}`
                      setExpandedToken(prev => {
                        const next = prev === mktKey ? null : mktKey
                        if (next && !tokenStats[tokenKey]?.fetched) fetchTokenStats(token.address)
                        return next
                      })
                    }} className="ml-1">
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-blue-400" /> : <ChevronDown className="w-3.5 h-3.5 text-white/25" />}
                    </button>
                  </div>

                  {isExpanded && stats?.fetched && (
                    <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid rgba(0,163,255,0.08)' }}>
                      {/* Price changes */}
                      {(stats.change5m != null || stats.change1h != null || stats.change24h != null) && (
                        <div className="grid grid-cols-3 gap-1 mt-2">
                          {[{ l: '5m', v: stats.change5m ?? 0 }, { l: '1h', v: stats.change1h ?? 0 }, { l: '24h', v: stats.change24h ?? 0 }].map(c => (
                            <div key={c.l} className="rounded-lg p-1.5 text-center"
                              style={{ background: c.v >= 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${c.v >= 0 ? 'rgba(34,197,94,0.14)' : 'rgba(239,68,68,0.14)'}` }}>
                              <p className="text-[8px] text-white/35">{c.l}</p>
                              <p className={cn('text-[10px] font-bold font-mono', c.v >= 0 ? 'text-green-400' : 'text-red-400')}>{c.v >= 0 ? '+' : ''}{c.v.toFixed(2)}%</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Liquidity / Vol / FDV */}
                      {(stats.liquidityUsd || stats.volume24h || stats.fdv) && (
                        <div className="grid grid-cols-3 gap-1">
                          {stats.liquidityUsd != null && stats.liquidityUsd > 0 && (
                            <div className="rounded-lg p-1.5" style={{ background: 'rgba(0,50,100,0.4)', border: '1px solid rgba(0,163,255,0.1)' }}>
                              <p className="text-[8px] text-white/35">Liquidez</p>
                              <p className="text-[10px] font-bold font-mono text-blue-300">${shortNum(stats.liquidityUsd)}</p>
                            </div>
                          )}
                          {stats.volume24h != null && stats.volume24h > 0 && (
                            <div className="rounded-lg p-1.5" style={{ background: 'rgba(0,50,100,0.4)', border: '1px solid rgba(0,163,255,0.1)' }}>
                              <p className="text-[8px] text-white/35">Vol 24h</p>
                              <p className="text-[10px] font-bold font-mono text-blue-300">${shortNum(stats.volume24h)}</p>
                            </div>
                          )}
                          {stats.fdv != null && stats.fdv > 0 && (
                            <div className="rounded-lg p-1.5" style={{ background: 'rgba(0,50,100,0.4)', border: '1px solid rgba(0,163,255,0.1)' }}>
                              <p className="text-[8px] text-white/35">FDV</p>
                              <p className="text-[10px] font-bold font-mono text-blue-300">${shortNum(stats.fdv)}</p>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Chart */}
                      {stats.pairAddress && (
                        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(0,163,255,0.1)' }}>
                          <iframe
                            src={`https://dexscreener.com/world/${stats.pairAddress}?embed=1&theme=dark&trades=0&info=0&interval=60`}
                            title={`${token.symbol} chart`} className="w-full" style={{ height: 200, border: 0 }} loading="lazy" />
                        </div>
                      )}
                    </div>
                  )}
                  {isExpanded && stats?.loading && (
                    <div className="flex justify-center py-3">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── SEND TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'send' && (
          <div className="p-4 space-y-3">
            <div className="text-center mb-2">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-2" style={{ background: 'linear-gradient(135deg,rgba(239,68,68,0.15),rgba(185,28,28,0.15))', border: '1px solid rgba(239,68,68,0.25)' }}>
                <ArrowUpFromLine className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm font-bold text-white">Enviar Tokens</p>
              <p className="text-[10px] text-white/30">World Chain · via World App</p>
            </div>

            {/* Token selector */}
            <button onClick={() => setPickerFor('from')}
              className="w-full flex items-center gap-3 rounded-2xl p-3 hover:scale-[1.01] transition-all"
              style={{ background: 'rgba(0,40,80,0.5)', border: '1px solid rgba(0,163,255,0.15)' }}>
              <TokenLogo token={sendToken} size="md" />
              <div className="flex-1 text-left">
                <p className="text-sm font-bold text-white">{sendToken.symbol}</p>
                <p className="text-[10px] text-white/40">Saldo: {formatToken(getBal(sendToken), sendToken.decimals, 4)}</p>
                {prices[sendToken.address.toLowerCase()] && getBal(sendToken) > 0n && (
                  <p className="text-[10px] text-blue-400/60">
                    ≈ ${(parseFloat(ethers.formatUnits(getBal(sendToken), sendToken.decimals)) * (prices[sendToken.address.toLowerCase()] ?? 0)).toFixed(2)} USD
                  </p>
                )}
              </div>
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>

            {/* Amount */}
            <div className="relative rounded-2xl overflow-hidden" style={{ background: 'rgba(0,40,80,0.5)', border: '1px solid rgba(0,163,255,0.15)' }}>
              <input type="number" min="0" step="any" value={sendAmt} onChange={e => setSendAmt(e.target.value)} placeholder="0.00"
                className="w-full text-2xl font-bold font-mono bg-transparent px-4 py-3 text-white placeholder:text-white/15 outline-none pr-20" />
              <button onClick={() => setSendAmt(formatToken(getBal(sendToken), sendToken.decimals, 6))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2 py-1 rounded-lg"
                style={{ background: 'rgba(0,122,255,0.2)', color: '#60a5fa', border: '1px solid rgba(0,163,255,0.3)' }}>MAX</button>
            </div>

            {sendAmt && prices[sendToken.address.toLowerCase()] && (
              <p className="text-[11px] text-white/30 text-center">≈ ${(parseFloat(sendAmt || '0') * (prices[sendToken.address.toLowerCase()] ?? 0)).toFixed(2)} USD</p>
            )}

            {/* Recipient */}
            <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(0,40,80,0.5)', border: '1px solid rgba(0,163,255,0.15)' }}>
              <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="Dirección destino: 0x..."
                className="w-full text-xs font-mono bg-transparent px-4 py-3.5 text-white placeholder:text-white/25 outline-none" />
            </div>

            {sendMsg && (
              <div className={cn('rounded-xl px-3 py-2.5 text-[11px] font-medium', sendMsg.ok ? 'bg-green-500/10 text-green-300 border border-green-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20')}>
                {sendMsg.text}
              </div>
            )}

            <button onClick={doSendToken} disabled={sending || !sendAmt || !sendTo || !sendTo.startsWith('0x')}
              className="w-full h-14 rounded-2xl text-base font-black text-white flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg,#ef4444 0%,#dc2626 50%,#b91c1c 100%)', boxShadow: '0 0 24px rgba(239,68,68,0.3)' }}>
              {sending ? <><Loader2 className="w-5 h-5 animate-spin" /> Enviando…</> : <><Send className="w-5 h-5" /> Enviar {sendToken.symbol}</>}
            </button>

            <div className="rounded-xl px-3 py-2 flex items-start gap-2" style={{ background: 'rgba(234,179,8,0.05)', border: '1px solid rgba(234,179,8,0.12)' }}>
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-[9px] text-yellow-400/70 leading-relaxed">Verifica bien la dirección antes de enviar. Las transacciones en blockchain son irreversibles.</p>
            </div>
          </div>
        )}

        {/* ── RECEIVE TAB ────────────────────────────────────────────────── */}
        {activeTab === 'receive' && (
          <div className="p-4 space-y-4 text-center">
            <div>
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-2" style={{ background: 'linear-gradient(135deg,rgba(0,122,255,0.15),rgba(0,80,200,0.15))', border: '1px solid rgba(0,163,255,0.25)' }}>
                <QrCode className="w-6 h-6 text-blue-400" />
              </div>
              <p className="text-sm font-bold text-white">Tu dirección World Chain</p>
              <p className="text-[10px] text-white/30">Recibe cualquier token ERC-20</p>
            </div>

            {/* QR Code */}
            <div className="flex justify-center">
              <div className="rounded-3xl p-3 bg-white inline-block shadow-2xl" style={{ boxShadow: '0 0 48px rgba(0,122,255,0.3)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrUrl(userAddress)} alt="QR dirección" width={176} height={176} className="rounded-2xl block" />
              </div>
            </div>

            {/* Address */}
            <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(0,40,80,0.5)', border: '1px solid rgba(0,163,255,0.15)' }}>
              <p className="text-[11px] font-mono text-white/70 break-all leading-relaxed">{userAddress}</p>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={async () => {
                await navigator.clipboard?.writeText(userAddress)
                setCopied(true); setTimeout(() => setCopied(false), 2000)
              }} className="h-11 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02]"
                style={{ background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(0,122,255,0.15)', color: copied ? '#4ade80' : '#60a5fa', border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(0,163,255,0.3)'}` }}>
                {copied ? <><CheckCheck className="w-4 h-4" /> Copiado!</> : <><Copy className="w-4 h-4" /> Copiar</>}
              </button>
              <a href={`https://worldscan.org/address/${userAddress}`} target="_blank" rel="noopener noreferrer"
                className="h-11 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02]"
                style={{ background: 'rgba(0,80,255,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
                <Eye className="w-4 h-4" /> WorldScan
              </a>
            </div>

            {/* Compatible tokens */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(0,30,60,0.5)', border: '1px solid rgba(0,163,255,0.08)' }}>
              <p className="text-[9px] text-white/30 mb-2 uppercase tracking-wider">Compatible con</p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {DEFAULT_TOKENS.slice(0, 8).map(t => (
                  <span key={t.address} className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}33` }}>
                    {t.symbol}
                  </span>
                ))}
                <span className="text-[9px] text-white/25">+{DEFAULT_TOKENS.length - 8} más</span>
              </div>
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-blue-400" />
                <p className="text-sm font-bold text-white">Historial</p>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,122,255,0.12)', color: '#60a5fa', border: '1px solid rgba(0,163,255,0.2)' }}>World Chain</span>
              </div>
              <button onClick={() => { setHistLoaded(false); setTxHistory([]); setTimeout(loadHistory, 100) }} disabled={histLoading}
                className="flex items-center gap-1 text-[9px] text-white/30 hover:text-blue-300 transition-colors">
                <RefreshCw className={cn('w-3 h-3', histLoading && 'animate-spin')} /> Actualizar
              </button>
            </div>

            {/* WorldScan link */}
            <a href={`https://worldscan.org/address/${userAddress}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:scale-[1.01] transition-all"
              style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.12)' }}>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" />
                <div>
                  <p className="text-xs font-bold text-white">Ver en WorldScan</p>
                  <p className="text-[9px] text-white/30">Historial completo en blockchain explorer</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-blue-400" />
            </a>

            {histLoading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-blue-400" /></div>}

            {!histLoading && txHistory.length === 0 && histLoaded && (
              <div className="py-8 text-center space-y-2">
                <History className="w-8 h-8 text-white/10 mx-auto" />
                <p className="text-[11px] text-white/25">Sin transacciones recientes</p>
              </div>
            )}

            {!histLoading && !histLoaded && txHistory.length === 0 && (
              <div className="py-6 text-center">
                <button onClick={loadHistory} className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1.5 mx-auto px-4 py-2 rounded-xl transition-colors"
                  style={{ background: 'rgba(0,122,255,0.1)', border: '1px solid rgba(0,163,255,0.2)' }}>
                  <Clock className="w-3.5 h-3.5" /> Cargar historial
                </button>
              </div>
            )}

            {txHistory.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(0,163,255,0.1)' }}>
                {txHistory.map((tx, i) => {
                  const isSent = tx.from.toLowerCase() === userAddress.toLowerCase()
                  const short = (a: string) => `${a.slice(0,6)}…${a.slice(-4)}`
                  const date = new Date(tx.time).toLocaleDateString('es', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  const val = parseFloat(tx.value)
                  return (
                    <div key={tx.hash + i} className="flex items-center gap-3 px-3 py-3"
                      style={{ borderBottom: i < txHistory.length - 1 ? '1px solid rgba(0,163,255,0.06)' : 'none', background: i % 2 === 0 ? 'rgba(0,40,80,0.2)' : 'transparent' }}>
                      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm',
                        isSent ? 'text-red-400' : 'text-green-400')}
                        style={{ background: isSent ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', border: `1px solid ${isSent ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}` }}>
                        {isSent ? '↑' : '↓'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white">
                          {isSent ? 'Enviaste' : 'Recibiste'} <span className="font-mono text-blue-300">{val > 0.0001 ? val.toFixed(4) : val.toFixed(8)}</span> {tx.token}
                        </p>
                        <p className="text-[9px] text-white/30">
                          {isSent ? `→ ${short(tx.to)}` : `← ${short(tx.from)}`} · {date}
                        </p>
                      </div>
                      <a href={`https://worldscan.org/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-white/25 hover:text-blue-400 transition-colors shrink-0"
                        style={{ background: 'rgba(0,80,255,0.06)', border: '1px solid rgba(0,163,255,0.1)' }}>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── VOLUME REWARDS DETAILS (expandable) ───────────────────────── */}
      {volData && (
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(0,20,40,0.7)', border: '1px solid rgba(0,163,255,0.08)' }}>
          <button onClick={() => setVolOpen(v => !v)} className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-[10px] font-bold text-teal-300">Detalles de Volumen UTH2</span>
              {volData.uth2Amount > 0n && <span className="text-[8px] font-bold bg-green-500/20 text-green-300 border border-green-500/25 px-1 py-px rounded-full animate-pulse">✦ pendiente</span>}
              <Countdown secondsLeft={volData.secondsLeft} />
            </div>
            {volOpen ? <ChevronUp className="w-3.5 h-3.5 text-white/25" /> : <ChevronDown className="w-3.5 h-3.5 text-white/25" />}
          </button>

          {volOpen && (
            <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid rgba(0,163,255,0.06)' }}>
              {loadingVol ? (
                <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-teal-400" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    <StatCard label="Mi volumen" value={`$${(Number(volData.userVolume)/1_000_000).toFixed(2)}`} color="#14b8a6" />
                    <StatCard label="Vol. mes global" value={`$${(Number(volData.globalMonthVolume)/1_000_000).toFixed(2)}`} color="#6366f1" />
                    <StatCard label="UTH2 reclamado" value={parseFloat(ethers.formatEther(volData.userTotalClaimed)).toFixed(4)} color="#a855f7" />
                    <StatCard label="UTH2 distribuido" value={parseFloat(ethers.formatEther(volData.totalDistributed)).toFixed(2)} color="#eab308" />
                  </div>
                  {volData.thresholds.length > 0 && (() => {
                    const volNum = Number(volData.userVolume)
                    const maxT = Number(volData.thresholds[volData.thresholds.length - 1])
                    const pct = Math.min(100, maxT > 0 ? (volNum / maxT) * 100 : 0)
                    return (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px]">
                          <span className="text-white/35">Progreso mes</span>
                          <span className="text-teal-400 font-mono">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: 'rgba(255,255,255,0.05)' }}>
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#14b8a6,#22d3ee)' }} />
                        </div>
                      </div>
                    )
                  })()}
                  <div className="grid grid-cols-2 gap-1">
                    {volData.thresholds.map((th, i) => (
                      <TierRow key={i} threshold={th} reward={volData.rewards[i] ?? 0n} status={volData.tierStatus[i] ?? 0} index={i} />
                    ))}
                  </div>
                  <button onClick={loadVolume} disabled={loadingVol} className="w-full flex items-center justify-center gap-1 text-[9px] text-white/25 hover:text-white/50 transition-colors py-1">
                    <RefreshCw className={cn('w-2.5 h-2.5', loadingVol && 'animate-spin')} /> Actualizar datos
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
