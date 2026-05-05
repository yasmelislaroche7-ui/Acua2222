// lib/sushibnb-abi.ts
// ABI generado para SushiSwap Staking en BNB Chain
// Contrato: 0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08
// Generado a partir de análisis de bytecode y screenshots del protocolo

export const SUSHI_BNB_CONTRACT = '0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08'

// SUSHI token en BNB Chain (misma dirección que en World Chain)
export const SUSHI_BNB_TOKEN = '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38'

// BNB Chain RPC
export const BNB_RPC = 'https://bsc-dataseed1.binance.org'
export const BNB_CHAIN_ID = 56

// Membership tier prices in BNB wei
export const MEMBERSHIP_TIERS = [
  { id: 0, name: 'Sin membresía', cookMinutes: 15,   priceBNB: 0n,                      color: '#6b7280' },
  { id: 1, name: 'Silver',        cookMinutes: 45,   priceBNB: 25000000000000000n,       color: '#94a3b8' }, // 0.025 BNB
  { id: 2, name: 'Gold',          cookMinutes: 180,  priceBNB: 125000000000000000n,      color: '#f59e0b' }, // 0.125 BNB
  { id: 3, name: 'Diamond',       cookMinutes: 2880, priceBNB: 375000000000000000n,      color: '#67e8f9' }, // 0.375 BNB
]

// Full ABI generated from bytecode analysis
export const SUSHI_BNB_ABI = [
  // ─── ERC20 Read ──────────────────────────────────────────────────────────
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',

  // ─── Core Staking ────────────────────────────────────────────────────────
  // deposit(uint256 amount) — stake SUSHI tokens
  'function deposit(uint256 amount) nonpayable',
  // withdraw(uint256 amount) — unstake SUSHI
  'function withdraw(uint256 amount) nonpayable',
  // harvest() — claim accumulated SUSHI rewards
  'function harvest() nonpayable',
  // cook(uint256 cookingTime) — start a cooking session with streak multiplier
  'function cook(uint256 cookingTime) nonpayable',

  // ─── Membership ──────────────────────────────────────────────────────────
  // subscribeMembership(uint8 tier) payable — upgrade tier (Silver/Gold/Diamond)
  'function subscribeMembership(uint8 tier) payable',
  // applyReferral(string code) — apply referral discount code
  'function applyReferral(string calldata code) nonpayable',
  // createReferralCode(string code) — create a referral code
  'function createReferralCode(string calldata code) nonpayable',

  // ─── Approve (ERC20 on SUSHI token) ─────────────────────────────────────
  // Note: These are called on the SUSHI token contract, not on this contract
  // 'function approve(address spender, uint256 amount) nonpayable returns (bool)',

  // ─── View Functions ───────────────────────────────────────────────────────
  // Get user staking info
  'function getStakeInfo(address user) view returns (uint256 staked, uint256 pendingRewards, uint256 cookingUntil, uint256 cookingStarted)',
  // Get user membership
  'function getMembership(address user) view returns (uint8 tier, uint256 expiresAt)',
  // Get user streak multiplier (bps, e.g. 11700 = 1.17x)
  'function getStreakMultiplier(address user) view returns (uint256 multiplierBps)',
  // Total staked
  'function totalStaked() view returns (uint256)',
  // APR in bps
  'function aprBps() view returns (uint256)',
  // Get referral code of user
  'function referralCodeOf(address user) view returns (string memory)',
  // Get referral earnings
  'function referralEarnings(address user) view returns (uint256)',
  // Paused
  'function paused() view returns (bool)',
  // Owner
  'function owner() view returns (address)',
  // Get cooking projection
  'function projectRewards(address user, uint256 cookSeconds) view returns (uint256 projected)',

  // ─── Events ───────────────────────────────────────────────────────────────
  'event Deposited(address indexed user, uint256 amount)',
  'event Withdrawn(address indexed user, uint256 amount)',
  'event Harvested(address indexed user, uint256 reward)',
  'event Cooked(address indexed user, uint256 duration, uint256 projected)',
  'event MembershipUpgraded(address indexed user, uint8 tier)',
]

// ERC20 ABI for SUSHI token operations
export const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) nonpayable returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

// BNB native token address (convention)
export const BNB_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

// Common BNB tokens for wallet display
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
