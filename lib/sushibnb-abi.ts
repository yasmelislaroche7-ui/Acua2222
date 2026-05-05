// lib/sushibnb-abi.ts
// ABI verificado on-chain para contrato SUSHI Staking BNB
// Contrato: 0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08
// Verificado via bytecode selector matching (May 2026)

export const SUSHI_BNB_CONTRACT = '0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08'

// SUSHI token en BNB Chain
export const SUSHI_BNB_TOKEN = '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38'

// BNB Chain RPC
export const BNB_RPC = 'https://bsc-dataseed1.binance.org'
export const BNB_CHAIN_ID = 56

// Precio BNB en USD aproximado para mostrar fee
export const BNB_USD_APPROX = 620

// Membership tier definitions — precios en BNB
export const MEMBERSHIP_TIERS = [
  { id: 0, name: 'Sin membresía', cookMinutes: 15,   priceBNB: BigInt(0),                  color: '#6b7280' },
  { id: 1, name: 'Silver',        cookMinutes: 45,   priceBNB: BigInt('25000000000000000'), color: '#94a3b8' }, // 0.025 BNB
  { id: 2, name: 'Gold',          cookMinutes: 180,  priceBNB: BigInt('125000000000000000'),color: '#f59e0b' }, // 0.125 BNB
  { id: 3, name: 'Diamond',       cookMinutes: 2880, priceBNB: BigInt('375000000000000000'),color: '#67e8f9' }, // 0.375 BNB
]

// ─── ABI verificado on-chain ────────────────────────────────────────────────
// Selectores confirmados mediante análisis de bytecode + eth_call probing
export const SUSHI_BNB_ABI = [
  // ── Core Staking (VERIFIED) ────────────────────────────────────────────────
  // 0xb6b55f25 — deposit(uint256): stake SUSHI tokens. Requiere approve previo.
  'function deposit(uint256 amount)',
  // 0x3ccfd60b — withdraw(): retira TODOS los tokens stakeados (sin parámetro!)
  'function withdraw()',
  // 0x372500ab — claimRewards(): reclama recompensas acumuladas
  'function claimRewards()',

  // ── View Functions (VERIFIED) ──────────────────────────────────────────────
  // 0x6386c1c7 — getUserInfo(address): info del usuario
  // returns: (uint256 staked, uint256 pendingRewards, uint256 cookingRewardsAcum, uint256 lastActionTime)
  'function getUserInfo(address user) view returns (uint256 staked, uint256 pendingRewards, uint256 cookingRewards, uint256 lastActionTs)',
  // 0x817b1cd2 — totalStaked(): SUSHI total en el contrato
  'function totalStaked() view returns (uint256)',
  // 0x5c975abb — paused()
  'function paused() view returns (bool)',
  // 0x8da5cb5b — owner()
  'function owner() view returns (address)',

  // ── Cook / Boost (UNVERIFIED — intenta cook(uint256 seconds)) ─────────────
  // Nota: cook/membership pueden necesitar stake > 0 on-chain para no revertir
  'function cook(uint256 cookingTime)',

  // ── Membership (UNVERIFIED — payable, paga en BNB) ────────────────────────
  'function subscribeMembership(uint8 tier) payable',

  // ── Membership View (UNVERIFIED) ──────────────────────────────────────────
  'function getMembership(address user) view returns (uint8 tier, uint256 expiresAt)',
  'function getStreakMultiplier(address user) view returns (uint256 multiplierBps)',

  // ── Referral (UNVERIFIED) ──────────────────────────────────────────────────
  'function applyReferral(string calldata code)',
  'function createReferralCode(string calldata code)',
  'function referralEarnings(address user) view returns (uint256)',
  'function referralCodeOf(address user) view returns (string)',

  // ── View extras (UNVERIFIED) ───────────────────────────────────────────────
  'function aprBps() view returns (uint256)',
  'function projectRewards(address user, uint256 cookSeconds) view returns (uint256 projected)',

  // ── Admin (VERIFIED) ──────────────────────────────────────────────────────
  'function pause()',
  'function unpause()',
  'function transferOwnership(address newOwner)',
  'function renounceOwnership()',
]

// ERC20 ABI para el token SUSHI
export const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

export const BNB_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export const BNB_TOKENS = [
  {
    symbol: 'BNB',
    name: 'BNB',
    address: BNB_NATIVE,
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    color: '#f0b90b',
  },
  {
    symbol: 'SUSHI',
    name: 'SushiSwap',
    address: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/12271/small/sushi.png',
    color: '#e84142',
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
    color: '#26a17b',
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
    color: '#2775ca',
  },
  {
    symbol: 'BUSD',
    name: 'Binance USD',
    address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    decimals: 18,
    logoUrl: 'https://assets.coingecko.com/coins/images/9576/small/BUSD.png',
    color: '#f0b90b',
  },
]
