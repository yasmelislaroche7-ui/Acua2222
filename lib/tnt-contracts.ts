import { ethers } from 'ethers'
import { WORLD_CHAIN_RPC, PERMIT2_ADDRESS } from './new-contracts'

// ─── Addresses ────────────────────────────────────────────────────────────────
// Deployed 2026-05-30 on World Chain (chainId 480)
export const TNT_DEPLOYED        = true
export const H2O_SWAP_V1         = '0x3a174c852B922C4182Bb5F754E63651b7065A400'
export const H2O_FUNDING_PROXY   = '0x86cbE1063c83897A6bbFb1B62cB732eA59792BC1'

// H2O viejo — base del exchange
export const H2O_OLD_TOKEN       = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
// H2O 2.0 — token del staking (para FundingProxy)
export const H2O2_TOKEN          = '0x08131A6f780AEF79E86518c4A10c06387Ec74636'
// H2OStake2 destino del FundingProxy (mismo que H2O_STAKE2_CONTRACT en new-contracts.ts)
export const H2O_STAKE2_ADDR     = '0x7f78b1B2c881E90D49C780461a88cb6CAC875afc'

// Owner2 para swap y proxy
export const TNT_OWNER2          = '0xC2Ef127734F296952DE75c1B58A6Cec605Cc2E59'.toLowerCase()

// ─── Tokens por defecto para los pares ───────────────────────────────────────
export interface TntTokenMeta {
  symbol:   string
  name:     string
  address:  string
  decimals: number
  logoUrl?: string
  // Precio inicial sugerido: token-wei por 1 H2O (escalado x1e18)
  // Ejemplo WLD: 1 H2O = 0.0000001 WLD → 0.0000001 * 1e18 = 1e11
  defaultPrice: bigint
  defaultFeeBps: number
}

export const TNT_DEFAULT_TOKENS: TntTokenMeta[] = [
  {
    symbol: 'WLD',  name: 'Worldcoin',
    address: '0x2cFc85d8E48F8EAB294be644d9E25C3030863003', decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
    defaultPrice:  100_000_000_000n,  // 1e11 = 0.0000001 WLD por 1 H2O
    defaultFeeBps: 200,
  },
  {
    symbol: 'FIRE', name: 'Fire Token',
    address: '0x22c40632c13a7f3cae9c343480607d886832c686', decimals: 18,
    logoUrl: '/tokens/fire.jpg',
    defaultPrice:  1_000_000_000_000n,  // 0.000001 FIRE
    defaultFeeBps: 200,
  },
  {
    symbol: 'H2O2', name: 'H2O 2.0',
    address: '0x08131A6f780AEF79E86518c4A10c06387Ec74636', decimals: 18,
    logoUrl: '/tokens/h2o2.webp',
    defaultPrice:  1_000_000_000_000_000n,  // 1:1000 ratio inicial
    defaultFeeBps: 100,
  },
  {
    symbol: 'SUSHI', name: 'SushiSwap',
    address: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38', decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/12271/small/sushi.png',
    defaultPrice:  500_000_000_000n,  // 0.0000005 SUSHI
    defaultFeeBps: 200,
  },
  {
    symbol: 'WDD', name: 'WDD Token',
    address: '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B', decimals: 18,
    defaultPrice:  1_000_000_000_000n,
    defaultFeeBps: 200,
  },
  {
    symbol: 'ORO', name: 'ORO Token',
    address: '0xcd1E32B86953D79a6AC58e813D2EA7a1790cAb63', decimals: 18,
    logoUrl: '/tokens/oro.jpg',
    defaultPrice:  1_000_000_000_000n,
    defaultFeeBps: 200,
  },
  {
    symbol: 'VIBE', name: 'VIBE Token',
    address: '0x696aD02f0c7d68915ea39cA6e60934f7a8900FB1', decimals: 18,
    logoUrl: '/tokens/vibe.jpg',
    defaultPrice:  1_000_000_000_000n,
    defaultFeeBps: 200,
  },
  {
    symbol: 'wARS', name: 'Wrapped ARS',
    address: '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d', decimals: 18,
    logoUrl: '/tokens/wars.jpg',
    defaultPrice:  10_000_000_000n,   // más barato
    defaultFeeBps: 200,
  },
  {
    symbol: 'wCOP', name: 'Wrapped COP',
    address: '0x8a1d45e102e886510e891d2ec656a708991e2d76', decimals: 18,
    logoUrl: '/tokens/wcop.jpg',
    defaultPrice:  5_000_000_000n,
    defaultFeeBps: 200,
  },
]

// ─── ABIs ─────────────────────────────────────────────────────────────────────
// PERMIT2_TUPLE — shared between read ABI and MiniKit TX ABI
const PERMIT2_TUPLE = {
  name: 'permit', type: 'tuple', components: [
    { name: 'permitted', type: 'tuple', components: [
      { name: 'token',  type: 'address' },
      { name: 'amount', type: 'uint256' },
    ]},
    { name: 'nonce',    type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

// SWAP_ABI — for ethers.js reads (supports string + object format)
export const SWAP_ABI: any[] = [
  'function getTokenList() view returns (address[])',
  'function pairs(address) view returns (bool active, bool paused, uint256 price, uint256 feeBps, string symbol, uint8 decimals)',
  'function h2oLiquidity() view returns (uint256)',
  'function tokenLiquidity(address) view returns (uint256)',
  'function quoteBuy(address payToken, uint256 h2oOut) view returns (uint256 tokenCost, uint256 fee, uint256 totalCost)',
  'function quoteSell(address getToken, uint256 h2oIn) view returns (uint256 tokenOut, uint256 fee, uint256 userGets)',
  'function getContractInfo() view returns (uint256 h2oBalance, uint256 numPairs, bool paused_)',
  'function globalPause() view returns (bool)',
  'function owner() view returns (address)',
  'function owner2() view returns (address)',
  'function h2oToken() view returns (address)',
]

// SWAP_TX_ABI — for MiniKit sendTransaction (pure JSON object format only)
export const SWAP_TX_ABI: any[] = [
  {
    name: 'buyH2OWithPermit2', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'payToken', type: 'address' },
      { name: 'h2oOut',   type: 'uint256' },
      PERMIT2_TUPLE,
      { name: 'sig',      type: 'bytes' },
    ], outputs: [],
  },
  {
    name: 'sellH2OWithPermit2', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'getToken', type: 'address' },
      { name: 'h2oIn',    type: 'uint256' },
      PERMIT2_TUPLE,
      { name: 'sig',      type: 'bytes' },
    ], outputs: [],
  },
  {
    name: 'fundWithPermit2', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'fundToken', type: 'address' },
      { name: 'amount',    type: 'uint256' },
      PERMIT2_TUPLE,
      { name: 'sig',       type: 'bytes' },
    ], outputs: [],
  },
  { name: 'withdraw',       type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tkn', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'to', type: 'address' }], outputs: [] },
  { name: 'addPair',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tkn', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'feeBps', type: 'uint256' }, { name: 'symbol', type: 'string' }], outputs: [] },
  { name: 'removePair',     type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tkn', type: 'address' }], outputs: [] },
  { name: 'setPrice',       type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tkn', type: 'address' }, { name: 'newPrice', type: 'uint256' }], outputs: [] },
  { name: 'setFee',         type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tkn', type: 'address' }, { name: 'newFeeBps', type: 'uint256' }], outputs: [] },
  { name: 'setPairPaused',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tkn', type: 'address' }, { name: 'paused', type: 'bool' }], outputs: [] },
  { name: 'setGlobalPause', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'paused', type: 'bool' }], outputs: [] },
  { name: 'setOwner2',      type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newOwner2', type: 'address' }], outputs: [] },
]

// PROXY_ABI — for ethers.js reads
export const PROXY_ABI: any[] = [
  'function owner() view returns (address)',
  'function owner2() view returns (address)',
  'function stakeContract() view returns (address)',
  'function token() view returns (address)',
]

// PROXY_TX_ABI — for MiniKit sendTransaction (pure JSON object format only)
export const PROXY_TX_ABI: any[] = [
  {
    name: 'fund', type: 'function', stateMutability: 'nonpayable',
    inputs: [PERMIT2_TUPLE, { name: 'sig', type: 'bytes' }, { name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  { name: 'setOwner2',        type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newOwner2', type: 'address' }], outputs: [] },
  { name: 'setStakeContract', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newStake', type: 'address' }], outputs: [] },
  { name: 'setToken',         type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'newToken', type: 'address' }], outputs: [] },
]

export const ERC20_TNT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function getProvider() {
  return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
}

export interface PairInfo {
  address: string
  symbol: string
  decimals: number
  active: boolean
  paused: boolean
  price: bigint
  feeBps: bigint
  h2oLiquidity: bigint
  tokenLiquidity: bigint
}

export async function fetchAllPairs(): Promise<PairInfo[]> {
  const provider = getProvider()
  const swap = new ethers.Contract(H2O_SWAP_V1, SWAP_ABI, provider)
  const addrs: string[] = await swap.getTokenList()
  const results = await Promise.all(addrs.map(async (addr) => {
    const [cfg, h2oLiq, tokLiq] = await Promise.all([
      swap.pairs(addr),
      swap.h2oLiquidity(),
      swap.tokenLiquidity(addr),
    ])
    return {
      address: addr,
      symbol: cfg.symbol,
      decimals: Number(cfg.decimals),
      active: cfg.active,
      paused: cfg.paused,
      price: BigInt(cfg.price),
      feeBps: BigInt(cfg.feeBps),
      h2oLiquidity: BigInt(h2oLiq),
      tokenLiquidity: BigInt(tokLiq),
    } as PairInfo
  }))
  return results.filter(p => p.active)
}

export function formatH2OPrice(price: bigint, symbol: string): string {
  if (price === 0n) return '0'
  // price = token-wei por 1 H2O (1e18)
  const scaled = Number(price) / 1e18
  if (scaled < 0.000001) return `${(scaled * 1e9).toFixed(4)}n ${symbol}`
  if (scaled < 0.001)    return `${(scaled * 1e6).toFixed(4)}μ ${symbol}`
  if (scaled < 1)        return `${scaled.toFixed(8)} ${symbol}`
  return `${scaled.toFixed(4)} ${symbol}`
}

export function fmt18(wei: bigint, decimals = 18): string {
  if (wei === 0n) return '0'
  const d = Number(ethers.formatUnits(wei, decimals))
  if (d < 0.0001) return d.toExponential(3)
  if (d < 1)      return d.toFixed(6)
  if (d < 1000)   return d.toFixed(4)
  return d.toLocaleString('en', { maximumFractionDigits: 2 })
}

export function randomNonce(): bigint {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return BigInt('0x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(''))
}
