// SPDX-License-Identifier: MIT
// Helpers TypeScript para AcuaH2OV3LP — full ABI necesario para deposito,
// retiro, claim, harvest, lectura de pools y posiciones de usuario.

import { ethers } from 'ethers'
import deployed from '../contracts-hh/deployed-h2o-v3.json'

export const H2O_V3_ADDRESS: string | null = deployed?.contract || null
export const H2O_V3_DEPLOY = deployed

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

// ─── ABI tuple para Permit2 PermitTransferFrom (igual que stake-v2-panel) ─────
export const PERMIT_TUPLE_INPUT = {
  name: 'permit',
  type: 'tuple',
  internalType: 'struct IPermit2.PermitTransferFrom',
  components: [
    {
      name: 'permitted',
      type: 'tuple',
      internalType: 'struct IPermit2.TokenPermissions',
      components: [
        { name: 'token', type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

// ─── ABI principal para sendTransaction (deposit/withdraw/claim/harvest) ──────
export const H2O_V3_TX_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolId', type: 'uint256' },
      { ...PERMIT_TUPLE_INPUT, name: 'permit0' },
      { name: 'signature0', type: 'bytes' },
      { ...PERMIT_TUPLE_INPUT, name: 'permit1' },
      { name: 'signature1', type: 'bytes' },
      { name: 'amount0Min', type: 'uint256' },
      { name: 'amount1Min', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'poolId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0Min', type: 'uint256' },
      { name: 'amount1Min', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'poolId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'harvest',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'poolId', type: 'uint256' }],
    outputs: [],
  },
] as const

// ─── ABI human-readable para llamadas read-only via ethers ────────────────────
export const H2O_V3_VIEW_ABI = [
  'function poolsCount() view returns (uint256)',
  'function getPool(uint256 poolId) view returns (tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, address poolAddr, uint256 nftTokenId, uint128 totalLiquidity, uint256 accFee0PerLiqX128, uint256 accFee1PerLiqX128, uint256 totalFees0Collected, uint256 totalFees1Collected, uint256 firstDepositAt, bool active, bool comingSoon))',
  'function getAllPools() view returns (tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, address poolAddr, uint256 nftTokenId, uint128 totalLiquidity, uint256 accFee0PerLiqX128, uint256 accFee1PerLiqX128, uint256 totalFees0Collected, uint256 totalFees1Collected, uint256 firstDepositAt, bool active, bool comingSoon)[])',
  'function getUserPosition(uint256 poolId, address user) view returns (uint128 liquidity, uint256 pendingFee0, uint256 pendingFee1, uint256 grossH2O, uint256 netH2O)',
  'function tokenValueInH2O(address token, uint256 amount) view returns (uint256)',
  'function estimateAprBps(uint256 poolId) view returns (uint256)',
  'function depositFeeBps() view returns (uint256)',
  'function withdrawFeeBps() view returns (uint256)',
  'function claimFeeBps() view returns (uint256)',
  'function paused() view returns (bool)',
]

// ─── Pool V3 (slot0) para calcular ratio de deposito y precios ────────────────
export const UNIV3_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 obsIndex, uint16 obsCard, uint16 obsCardNext, uint8 feeProto, bool unlocked)',
  'function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

// ─── Tipos ────────────────────────────────────────────────────────────────────
export interface H2OV3Pool {
  poolId: number
  token0: string
  token1: string
  fee: number
  tickLower: number
  tickUpper: number
  nftTokenId: bigint
  totalLiquidity: bigint
  totalFees0Collected: bigint
  totalFees1Collected: bigint
  firstDepositAt: bigint
  active: boolean
  comingSoon: boolean
  // del archivo deployed-h2o-v3.json
  label?: string
  poolAddress?: string
  stable?: boolean
  needsInit?: boolean // pool en uniswap existe pero sin liquidez
}

// Datos en vivo del pool subyacente Uniswap V3
export interface PoolLiveData {
  sqrtPriceX96: bigint
  currentTick: number
  poolLiquidity: bigint     // liquidez total del pool en Uniswap
  priceToken1PerToken0: number  // human-readable price (token1 per token0, considerando decimals)
  priceChange24h: number | null // % change vs 24h ago, null si no disponible
  priceHistory: number[]    // sparkline data (precios al inicio del periodo)
  tvlInH2O: bigint          // TVL del bote del wrapper en H2O equivalente
}

export interface H2OV3Position {
  liquidity: bigint
  pendingFee0: bigint
  pendingFee1: bigint
  grossH2O: bigint
  netH2O: bigint
}

export interface TokenMeta {
  address: string
  symbol: string
  decimals: number
  logoUrl?: string
}

// Catalogo local de tokens (para mostrar simbolo, decimales, logo)
const TOKEN_META_BY_ADDR: Record<string, TokenMeta> = {
  '0x17392e5483983945deb92e0518a8f2c4eb6ba59d': { address: '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d', symbol: 'H2O',    decimals: 18, logoUrl: '/tokens/h2o.jpg' },
  '0x2cfc85d8e48f8eab294be644d9e25c3030863003': { address: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', symbol: 'WLD',    decimals: 18, logoUrl: '/tokens/wld.jpg' },
  '0x79a02482a880bce3f13e09da970dc34db4cd24d1': { address: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', symbol: 'USDC',   decimals: 6,  logoUrl: '/tokens/usdc.jpg' },
  '0xab09a728e53d3d6bc438be95eed46da0bbe7fb38': { address: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38', symbol: 'SUSHI',  decimals: 18, logoUrl: '/tokens/sushi.jpg' },
  '0xecc4dae4dc3d359a93046bd944e9ee3421a6a484': { address: '0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484', symbol: 'BTCH2O', decimals: 18, logoUrl: '/tokens/btch2o.jpg' },
  '0x4200000000000000000000000000000000000006': { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',   decimals: 18, logoUrl: '/tokens/weth.jpg' },
  '0x03c7054bcb39f7b2e5b2c7acb37583e32d70cfa3': { address: '0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3', symbol: 'WBTC',   decimals: 8,  logoUrl: '/tokens/wbtc.jpg' },
  '0x696ad02f0c7d68915ea39ca6e60934f7a8900fb1': { address: '0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1', symbol: 'VIBE',   decimals: 18, logoUrl: '/tokens/vibe.jpg' },
  '0xcd1e32b86953d79a6ac58e813d2ea7a1790cab63': { address: '0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63', symbol: 'ORO',    decimals: 18, logoUrl: '/tokens/oro.jpg' },
  '0xf3f92a60e6004f3982f0fde0d43602fc0a30a0db': { address: '0xF3F92A60e6004f3982F0FdE0d43602fC0a30a0dB', symbol: 'ORB',    decimals: 18, logoUrl: '/tokens/orb.jpg' },
  '0x1ae3498f1b417fe31be544b04b711f27ba437bd3': { address: '0x1aE3498f1B417fe31BE544B04B711F27Ba437bd3', symbol: 'PUF',    decimals: 18, logoUrl: '/tokens/puf.jpg' },
  '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d': { address: '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d', symbol: 'wARS',   decimals: 18, logoUrl: '/tokens/wars.jpg' },
  '0x30974f73a4ac9e606ed80da928e454977ac486d2': { address: '0x30974f73A4ac9E606Ed80da928e454977ac486D2', symbol: 'oXAUT',  decimals: 18, logoUrl: '/tokens/oxaut.jpg' },
  '0xdba88118551d5adf16a7ab943403aea7ea06762b': { address: '0xDBA88118551d5Adf16a7AB943403Aea7ea06762b', symbol: 'AIR',    decimals: 18, logoUrl: '/tokens/air.jpg' },
  '0x9ea8653640e22a5b69887985bb75d496dc97022a': { address: '0x9eA8653640E22A5b69887985BB75d496dc97022a', symbol: 'UTH2',   decimals: 18, logoUrl: '/tokens/uth2.jpg' },
}

export function tokenMeta(addr: string): TokenMeta {
  const k = (addr || '').toLowerCase()
  if (TOKEN_META_BY_ADDR[k]) return TOKEN_META_BY_ADDR[k]
  return { address: addr, symbol: addr.slice(0, 6) + '…' + addr.slice(-4), decimals: 18 }
}

export function getProvider() {
  return new ethers.JsonRpcProvider('https://worldchain-mainnet.g.alchemy.com/public')
}

// ─── Lecturas ─────────────────────────────────────────────────────────────────
export async function fetchAllPools(): Promise<H2OV3Pool[]> {
  if (!H2O_V3_ADDRESS) return []
  const provider = getProvider()
  const c = new ethers.Contract(H2O_V3_ADDRESS, H2O_V3_VIEW_ABI, provider)
  const raw = await c.getAllPools()
  const labels: any[] = (deployed as any).pools || []
  return raw.map((p: any, i: number) => {
    const fromFile = labels.find(x => x.id === i) || {}
    return {
      poolId: i,
      token0: p.token0,
      token1: p.token1,
      fee: Number(p.fee),
      tickLower: Number(p.tickLower),
      tickUpper: Number(p.tickUpper),
      nftTokenId: BigInt(p.nftTokenId),
      totalLiquidity: BigInt(p.totalLiquidity),
      totalFees0Collected: BigInt(p.totalFees0Collected),
      totalFees1Collected: BigInt(p.totalFees1Collected),
      firstDepositAt: BigInt(p.firstDepositAt),
      active: p.active,
      comingSoon: p.comingSoon,
      label: fromFile.label,
      poolAddress: p.poolAddr || fromFile.pool,
      stable: !!fromFile.stable,
      needsInit: !!fromFile.needsInit,
    }
  })
}

// Carga datos vivos de todas las pools en paralelo (limita concurrencia)
export async function fetchAllPoolsLive(pools: H2OV3Pool[]): Promise<Record<number, PoolLiveData>> {
  const out: Record<number, PoolLiveData> = {}
  await Promise.all(pools.map(async p => {
    const live = await fetchPoolLive(p)
    if (live) out[p.poolId] = live
  }))
  return out
}

export async function fetchUserPosition(poolId: number, user: string): Promise<H2OV3Position | null> {
  if (!H2O_V3_ADDRESS) return null
  const provider = getProvider()
  const c = new ethers.Contract(H2O_V3_ADDRESS, H2O_V3_VIEW_ABI, provider)
  const r = await c.getUserPosition(poolId, user)
  return {
    liquidity: BigInt(r.liquidity ?? r[0]),
    pendingFee0: BigInt(r.pendingFee0 ?? r[1]),
    pendingFee1: BigInt(r.pendingFee1 ?? r[2]),
    grossH2O: BigInt(r.grossH2O ?? r[3]),
    netH2O: BigInt(r.netH2O ?? r[4]),
  }
}

export async function fetchAprBps(poolId: number): Promise<bigint> {
  if (!H2O_V3_ADDRESS) return 0n
  try {
    const provider = getProvider()
    const c = new ethers.Contract(H2O_V3_ADDRESS, H2O_V3_VIEW_ABI, provider)
    return BigInt(await c.estimateAprBps(poolId))
  } catch { return 0n }
}

export async function fetchPoolSpot(poolAddr: string): Promise<{ sqrtPriceX96: bigint; tick: number } | null> {
  try {
    const provider = getProvider()
    const c = new ethers.Contract(poolAddr, UNIV3_POOL_ABI, provider)
    const s = await c.slot0()
    return { sqrtPriceX96: BigInt(s.sqrtPriceX96 ?? s[0]), tick: Number(s.tick ?? s[1]) }
  } catch { return null }
}

// Convert a tick to a price (token1 per token0) considering decimals
export function tickToPrice(tick: number, dec0: number, dec1: number): number {
  // 1.0001^tick * 10^(dec0 - dec1)
  const raw = Math.pow(1.0001, tick)
  return raw * Math.pow(10, dec0 - dec1)
}

// sqrtPriceX96 -> price (token1 per token0) human-readable
export function sqrtPriceToPrice(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  if (sqrtPriceX96 === 0n) return 0
  // price_raw = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
  // human price = price_raw * 10^(dec0 - dec1)
  const SCALE = 10n ** 36n
  const sq = (sqrtPriceX96 * sqrtPriceX96 * SCALE) >> 192n
  const num = Number(sq) / Number(SCALE)
  return num * Math.pow(10, dec0 - dec1)
}

// Lectura completa en vivo de un pool: slot0 + liquidity + observe(historico) + tvl
export async function fetchPoolLive(pool: H2OV3Pool): Promise<PoolLiveData | null> {
  if (!H2O_V3_ADDRESS || !pool.poolAddress) return null
  const provider = getProvider()
  const uni = new ethers.Contract(pool.poolAddress, UNIV3_POOL_ABI, provider)
  const wrapper = new ethers.Contract(H2O_V3_ADDRESS, H2O_V3_VIEW_ABI, provider)
  try {
    const [slot0, poolLiq] = await Promise.all([uni.slot0(), uni.liquidity()])
    const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96 ?? slot0[0])
    const currentTick = Number(slot0.tick ?? slot0[1])
    const t0Meta = tokenMeta(pool.token0)
    const t1Meta = tokenMeta(pool.token1)

    // Historial de precio: 0, 1h, 6h, 12h, 24h ago (sparkline 5 puntos)
    let priceHistory: number[] = []
    let priceChange24h: number | null = null
    try {
      const SECONDS = [86400, 21600, 10800, 3600, 0]
      const obs = await uni.observe(SECONDS)
      const cumulatives = obs.tickCumulatives ?? obs[0]
      const ticksAvg: number[] = []
      for (let i = 0; i < cumulatives.length - 1; i++) {
        const dt = SECONDS[i] - SECONDS[i + 1]
        const dCum = BigInt(cumulatives[i + 1]) - BigInt(cumulatives[i])
        ticksAvg.push(Number(dCum / BigInt(dt)))
      }
      ticksAvg.push(currentTick)
      priceHistory = ticksAvg.map(t => tickToPrice(t, t0Meta.decimals, t1Meta.decimals))
      if (priceHistory.length >= 2 && priceHistory[0] > 0) {
        priceChange24h = ((priceHistory[priceHistory.length - 1] - priceHistory[0]) / priceHistory[0]) * 100
      }
    } catch { /* observe puede revertir si no hay observaciones suficientes */ }

    // TVL del bote del wrapper en H2O = valor liquidez del wrapper convertida via tokenValueInH2O
    // Calculamos amount0/amount1 del wrapper full-range desde su totalLiquidity
    let tvlInH2O = 0n
    try {
      if (pool.totalLiquidity > 0n && sqrtPriceX96 > 0n) {
        // amount0 = L * 2^96 / sqrtP    (full-range upper >> current)
        // amount1 = L * sqrtP / 2^96
        const L = pool.totalLiquidity
        const Q96 = 1n << 96n
        const amount0 = (L * Q96) / sqrtPriceX96
        const amount1 = (L * sqrtPriceX96) / Q96
        const [v0, v1] = await Promise.all([
          wrapper.tokenValueInH2O(pool.token0, amount0).catch(() => 0n),
          wrapper.tokenValueInH2O(pool.token1, amount1).catch(() => 0n),
        ])
        tvlInH2O = BigInt(v0) + BigInt(v1)
      }
    } catch {}

    return {
      sqrtPriceX96,
      currentTick,
      poolLiquidity: BigInt(poolLiq),
      priceToken1PerToken0: sqrtPriceToPrice(sqrtPriceX96, t0Meta.decimals, t1Meta.decimals),
      priceChange24h,
      priceHistory,
      tvlInH2O,
    }
  } catch { return null }
}

// Dada amount0, calcula amount1 esperado segun el ratio actual del pool (full-range).
// price (token1/token0 raw) = sqrtPriceX96^2 / 2^192
// amount1_raw = amount0_raw * price
export function quoteAmount1FromAmount0(amount0Raw: bigint, sqrtPriceX96: bigint): bigint {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96
  return (amount0Raw * priceX192) >> 192n
}
export function quoteAmount0FromAmount1(amount1Raw: bigint, sqrtPriceX96: bigint): bigint {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96
  return (amount1Raw << 192n) / priceX192
}

export async function fetchUserBalance(token: string, user: string): Promise<{ balance: bigint; decimals: number; symbol: string }> {
  const provider = getProvider()
  const c = new ethers.Contract(token, ERC20_ABI, provider)
  const meta = tokenMeta(token)
  let decimals = meta.decimals
  let symbol = meta.symbol
  let balance = 0n
  try { balance = BigInt(await c.balanceOf(user)) } catch {}
  return { balance, decimals, symbol }
}

// ─── USDC conversion helper ──────────────────────────────────────────────────
// Returns how many USDC (in 6 decimals) equals 1 H2O (in 18 decimals).
// Internally: queries tokenValueInH2O(USDC, 1e6) to get H2O wei per 1 USDC,
// then inverts: USDC_per_H2O = 1e6 * 1e18 / h2oWeiPerUsdc.
const USDC_ADDR = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'
let H2O_USDC_CACHE: { rate: bigint; ts: number } | null = null

export async function fetchH2OUsdcRate(): Promise<bigint> {
  if (!H2O_V3_ADDRESS) return 0n
  // 60-second cache
  if (H2O_USDC_CACHE && Date.now() - H2O_USDC_CACHE.ts < 60000) return H2O_USDC_CACHE.rate
  try {
    const provider = getProvider()
    const c = new ethers.Contract(H2O_V3_ADDRESS, H2O_V3_VIEW_ABI, provider)
    const oneUsdcRaw = 1_000_000n // 1 USDC in 6 decimals
    const h2oForOneUsdc = BigInt(await c.tokenValueInH2O(USDC_ADDR, oneUsdcRaw))
    if (h2oForOneUsdc === 0n) return 0n
    // usdcPerH2O (in 6 decimals) = 1e18 * 1e6 / h2oForOneUsdc
    const rate = (10n ** 24n) / h2oForOneUsdc
    H2O_USDC_CACHE = { rate, ts: Date.now() }
    return rate
  } catch { return 0n }
}

// Convert H2O amount (wei) to USDC value (6 decimals)
export function h2oToUsdc(h2oWei: bigint, rate: bigint): bigint {
  if (rate === 0n || h2oWei === 0n) return 0n
  // (h2oWei * rate) / 1e18
  return (h2oWei * rate) / (10n ** 18n)
}

export function formatUsd(usdcRaw: bigint): string {
  if (usdcRaw === 0n) return '$0'
  const num = Number(ethers.formatUnits(usdcRaw, 6))
  if (num < 0.01) return '< $0.01'
  if (num >= 1_000_000) return '$' + (num / 1_000_000).toFixed(2) + 'M'
  if (num >= 1_000) return '$' + (num / 1_000).toFixed(2) + 'K'
  if (num >= 1) return '$' + num.toFixed(2)
  return '$' + num.toFixed(4)
}

// ─── Helpers UI ───────────────────────────────────────────────────────────────
export function formatToken(amount: bigint, decimals = 18, precision = 4): string {
  const formatted = ethers.formatUnits(amount, decimals)
  const num = parseFloat(formatted)
  if (num === 0) return '0'
  if (num < 0.0001) return '< 0.0001'
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: precision })
}

export function bpsToPct(bps: bigint | number): string {
  const n = typeof bps === 'bigint' ? Number(bps) : bps
  return (n / 100).toFixed(2) + '%'
}

export function feeTierLabel(fee: number): string {
  if (fee === 100) return '0.01%'
  if (fee === 500) return '0.05%'
  if (fee === 3000) return '0.3%'
  if (fee === 10000) return '1%'
  return (fee / 10000).toFixed(2) + '%'
}

export function randomNonce(): bigint {
  const arr = new Uint32Array(2)
  if (typeof window !== 'undefined' && window.crypto) window.crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}
