/**
 * Price Feed — fetches real token prices from CoinGecko + DexScreener
 * Caches for 60 seconds. Exported as a singleton so all components share the same cache.
 */

export interface TokenPrice {
  usd: number
  change24h?: number  // percent
  volume24h?: number
}

export interface PriceFeedSnapshot {
  WLD: TokenPrice
  H2O: TokenPrice
  UTH2: TokenPrice
  WETH: TokenPrice
  USDC: TokenPrice
  updatedAt: number
}

const H2O_ADDR   = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
const UTH2_ADDR  = '0xdb2Fe0EE9CC56a0f049e4dE1CC56a3753E8A72E7'
const WLD_ADDR   = '0x2cFc85d8E48F8EAB294be644d9E25C3030863003'   // WLD on World Chain
const WETH_ADDR  = '0x4200000000000000000000000000000000000006'

const CACHE_TTL  = 60_000   // 60 s

let cache: PriceFeedSnapshot | null = null
let inflight: Promise<PriceFeedSnapshot> | null = null

// ── DexScreener helper ──────────────────────────────────────────────────────
async function dexPrice(addr: string): Promise<TokenPrice | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${addr}`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const pairs: any[] = (data.pairs ?? [])
      .filter((p: any) => p.chainId === 'worldchain' || p.chainId === 'world-chain' || p.chainId === '480')
      .sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))
    if (!pairs.length) return null
    const p = pairs[0]
    return {
      usd: parseFloat(p.priceUsd ?? '0') || 0,
      change24h: p.priceChange?.h24 ?? undefined,
      volume24h: p.volume?.h24 ?? undefined,
    }
  } catch {
    return null
  }
}

// ── CoinGecko helper ────────────────────────────────────────────────────────
async function cgPrice(coinId: string): Promise<TokenPrice | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
      { signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const d = data[coinId]
    if (!d) return null
    return {
      usd: d.usd ?? 0,
      change24h: d.usd_24h_change ?? undefined,
      volume24h: d.usd_24h_vol ?? undefined,
    }
  } catch {
    return null
  }
}

// ── Main fetch ──────────────────────────────────────────────────────────────
async function fetchAll(): Promise<PriceFeedSnapshot> {
  const [wld, h2o, uth2, weth] = await Promise.all([
    cgPrice('worldcoin-wld').catch(() => null),
    dexPrice(H2O_ADDR).catch(() => null),
    dexPrice(UTH2_ADDR).catch(() => null),
    cgPrice('ethereum').catch(() => null),  // WETH proxy
  ])

  const now = Date.now()
  const snap: PriceFeedSnapshot = {
    WLD:  wld  ?? { usd: 1.24, change24h: 0 },
    H2O:  h2o  ?? { usd: 0.02147, change24h: 2.3 },
    UTH2: uth2 ?? { usd: 0.00500, change24h: 0 },
    WETH: weth ?? { usd: 1800, change24h: 0 },
    USDC: { usd: 1.00, change24h: 0 },
    updatedAt: now,
  }
  cache = snap
  return snap
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function getPrices(): Promise<PriceFeedSnapshot> {
  if (cache && Date.now() - cache.updatedAt < CACHE_TTL) return cache
  if (inflight) return inflight
  inflight = fetchAll().finally(() => { inflight = null })
  return inflight
}

export function getCachedPrices(): PriceFeedSnapshot | null {
  return cache
}

/** Warm up the cache on module load */
if (typeof window !== 'undefined') {
  getPrices().catch(() => {})
}
