import { ethers } from 'ethers'

// ─── Addresses ────────────────────────────────────────────────────────────────
export const STAKING_CONTRACT = '0xabbD2D0360bA25FBb82a6f7574a150F1AEAc2e04'
export const H2O_TOKEN = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
export const WLD_TOKEN = '0x2cFc85d8E48F8EAB294be644d9E25C3030863003'
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const WORLD_CHAIN_RPC = 'https://worldchain-mainnet.g.alchemy.com/public'
export const WORLD_CHAIN_ID = 480

// ─── ABI (matches deployed contract 0xabbD2D0360bA25FBb82a6f7574a150F1AEAc2e04) ──
export const STAKING_ABI = [
  // ── Immutable constants (uppercase)
  'function H2O() view returns (address)',
  'function WLD() view returns (address)',
  'function PERMIT2() view returns (address)',
  'function CREATOR() view returns (address)',           // era CONTRACT_CREATOR en v8
  'function CREATOR_SHARE_BPS() view returns (uint256)',
  'function MAX_BPS() view returns (uint256)',
  'function SECONDS_PER_YEAR() view returns (uint256)',
  // ── Config views (lowercase — mutable via setters)
  'function owner() view returns (address)',
  'function treasury() view returns (address)',
  'function apyBasisPoints() view returns (uint256)',
  'function stakingFeeBps() view returns (uint256)',
  'function swapFeeBps() view returns (uint256)',
  'function contractH2OBalance() view returns (uint256)',
  'function swapper() view returns (address)',
  // ── User views
  'function pendingRewards(address user) view returns (uint256)',
  'function canClaim(address user) view returns (bool)',
  'function getStakeInfo(address user) view returns (uint256 stakedAmount, uint256 stakedAt, uint256 lastClaimAt, bool active, uint256 pending)',
  'function stakes(address) view returns (uint256 amount, uint256 stakedAt, uint256 lastClaimAt, bool active)',
  // ── User write — stake/unstake/claim (no Permit2)
  'function unstake()',
  'function unstakeAndSell(uint256 amountOutMin)',        // nuevo en v9
  'function claimRewards()',
  // ── User write — Permit2 flows (stake side)
  'function stake((tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)',
  'function addStake((tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)',
  // ── User write — Permit2 flows (buy/sell side)
  'function buyAndStake((tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature, uint256 amountOutMin)',
  'function addStakeWithBuy((tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature, uint256 amountOutMin)',
  'function sellH2O((tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature, uint256 amountOutMin)',
  // ── Owner write
  'function setAPY(uint256 v)',
  'function setStakingFee(uint256 v)',
  'function setSwapFee(uint256 v)',
  'function setTreasury(address newTreasury)',
  'function setOwner(address newOwner)',                  // era transferOwnership en v8 (2-step eliminado)
  'function emergencyWithdraw(address token, uint256 amount)',
] as const

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
] as const

// ─── Typed ABI objects for MiniKit ───────────────────────────────────────────
export const PERMIT_TUPLE_INPUT = {
  name: 'permit',
  type: 'tuple',
  internalType: 'struct ISignatureTransfer.PermitTransferFrom',
  components: [
    {
      name: 'permitted',
      type: 'tuple',
      internalType: 'struct ISignatureTransfer.TokenPermissions',
      components: [
        { name: 'token', type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

export const SELL_H2O_ABI = [
  {
    name: 'sellH2O',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      PERMIT_TUPLE_INPUT,
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
      { name: 'amountOutMin', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [],
  },
] as const

// ─── Read helpers ─────────────────────────────────────────────────────────────
function getProvider() {
  return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
}

function getContract() {
  return new ethers.Contract(STAKING_CONTRACT, STAKING_ABI, getProvider())
}

function getERC20(address: string) {
  return new ethers.Contract(address, ERC20_ABI, getProvider())
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface StakeInfo {
  stakedAmount: bigint
  stakedAt: bigint
  lastClaimAt: bigint
  active: boolean
  pending: bigint
}

export interface ContractConfig {
  owner: string
  treasury: string
  creator: string              // era contractCreator
  creatorShareBps: bigint
  apyBps: bigint
  stakingFeeBps: bigint
  swapFeeBps: bigint
  contractBalance: bigint
  swapper: string
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────
export async function fetchStakeInfo(user: string): Promise<StakeInfo> {
  const c = getContract()
  const res = await c.getStakeInfo(user)
  return {
    stakedAmount: res[0],
    stakedAt: res[1],
    lastClaimAt: res[2],
    active: res[3],
    pending: res[4],
  }
}

export async function fetchContractConfig(): Promise<ContractConfig> {
  const c = getContract()
  const [owner, treasury, creator, creatorShareBps, apyBps, stakingFee, swapFee, balance, swapper] =
    await Promise.all([
      c.owner(),
      c.treasury(),
      c.CREATOR(),             // era c.CONTRACT_CREATOR()
      c.CREATOR_SHARE_BPS(),
      c.apyBasisPoints(),
      c.stakingFeeBps(),
      c.swapFeeBps(),
      c.contractH2OBalance(),
      c.swapper(),
    ])
  return {
    owner: owner as string,
    treasury: treasury as string,
    creator: creator as string,
    creatorShareBps: creatorShareBps as bigint,
    apyBps: apyBps as bigint,
    stakingFeeBps: stakingFee as bigint,
    swapFeeBps: swapFee as bigint,
    contractBalance: balance as bigint,
    swapper: swapper as string,
  }
}

export async function fetchH2OBalance(user: string): Promise<bigint> {
  return getERC20(H2O_TOKEN).balanceOf(user) as Promise<bigint>
}

export async function fetchWLDBalance(user: string): Promise<bigint> {
  return getERC20(WLD_TOKEN).balanceOf(user) as Promise<bigint>
}

// ─── Format helpers ───────────────────────────────────────────────────────────
export function formatToken(amount: bigint, decimals = 18, precision = 4): string {
  const formatted = ethers.formatUnits(amount, decimals)
  const num = parseFloat(formatted)
  if (num === 0) return '0'
  if (num < 0.0001) return '< 0.0001'
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: precision })
}

export function bpsToPercent(bps: bigint): string {
  return (Number(bps) / 100).toFixed(2) + '%'
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatTimestamp(ts: bigint): string {
  if (ts === 0n) return '—'
  return new Date(Number(ts) * 1000).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}