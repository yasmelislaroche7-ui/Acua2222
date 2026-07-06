/**
 * lib/stake-v5.ts
 * H2OStakeV5 — H2O ACUA Company staking con comisión de 5% en depósito y retiro
 * Retiros y claims instantáneos (24/7), recompensas por segundo, referidos, Permit2
 */
import { ethers } from 'ethers'

// ─── Address (se actualiza después del deploy) ────────────────────────────────
let _deployedInfo: { contract: string } | null = null
try {
  _deployedInfo = require('@/contracts-hh/deployed-h2o-stake-v5.json')
} catch {
  _deployedInfo = null
}

export const STAKE_V5_ADDRESS: string = _deployedInfo?.contract ?? ''
export const ACUA_TOKEN_ADDRESS = '0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd'
export const WORLD_CHAIN_RPC_V5 = 'https://worldchain-mainnet.g.alchemy.com/public'

// ─── MiniKit ABI fragments ────────────────────────────────────────────────────

const PERMIT_TUPLE = {
  name: 'permit', type: 'tuple', internalType: 'struct IPermit2.PermitTransferFrom',
  components: [
    { name: 'permitted', type: 'tuple', internalType: 'struct IPermit2.TokenPermissions',
      components: [
        { name: 'token',  type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce',    type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

// stake(permit, sig, grossAmount, referrer)
export const STAKE_ABI_FRAG = [{
  name: 'stake', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    PERMIT_TUPLE,
    { name: 'sig',         type: 'bytes',    internalType: 'bytes' },
    { name: 'grossAmount', type: 'uint256',  internalType: 'uint256' },
    { name: 'referrer',    type: 'address',  internalType: 'address' },
  ],
  outputs: [],
}] as const

// stakeNormal(grossAmount, referrer)
export const STAKE_NORMAL_ABI_FRAG = [{
  name: 'stakeNormal', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'grossAmount', type: 'uint256', internalType: 'uint256' },
    { name: 'referrer',    type: 'address', internalType: 'address' },
  ],
  outputs: [],
}] as const

// withdraw(amount)
export const WITHDRAW_ABI_FRAG = [{
  name: 'withdraw', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// claimRewards()
export const CLAIM_ABI_FRAG = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [],
  outputs: [],
}] as const

// register(referrer)
export const REGISTER_ABI_FRAG = [{
  name: 'register', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'referrer', type: 'address', internalType: 'address' }],
  outputs: [],
}] as const

// fund(permit, sig, amount) — onlyOwner
export const FUND_ABI_FRAG = [{
  name: 'fund', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    PERMIT_TUPLE,
    { name: 'sig',    type: 'bytes',   internalType: 'bytes' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

// fundDirect(amount)
export const FUND_DIRECT_ABI_FRAG = [{
  name: 'fundDirect', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// setApr(newAprBps)
export const SET_APR_ABI_FRAG = [{
  name: 'setApr', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'newAprBps', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// setDepositFee(newFeeBps)
export const SET_DEPOSIT_FEE_ABI_FRAG = [{
  name: 'setDepositFee', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'newFeeBps', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// setWithdrawFee(newFeeBps)
export const SET_WITHDRAW_FEE_ABI_FRAG = [{
  name: 'setWithdrawFee', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'newFeeBps', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// setPaused(val)
export const SET_PAUSED_ABI_FRAG = [{
  name: 'setPaused', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'val', type: 'bool', internalType: 'bool' }],
  outputs: [],
}] as const

// ─── Read ABI ─────────────────────────────────────────────────────────────────
const READ_ABI = [
  'function pendingRewards(address user) view returns (uint256)',
  `function getUserInfo(address user) view returns (
    uint256 staked,
    uint256 rewards,
    address referrer,
    uint256 refEarnings,
    uint256 refCount,
    uint256 totalDep,
    uint256 totalWith,
    uint256 totalClaim
  )`,
  `function getGlobalStats() view returns (
    uint256 totalStaked,
    uint256 fundPool,
    uint256 totalDeposited,
    uint256 totalWithdrawn,
    uint256 totalClaimed,
    uint256 totalFeesPaid,
    uint256 totalReferralsPaid,
    uint256 totalFunded,
    uint256 totalUsers,
    uint256 totalReferralLinks,
    uint256 aprBps,
    uint256 depositFeeBps,
    uint256 withdrawFeeBps,
    bool paused
  )`,
  'function aprBps() view returns (uint256)',
  'function depositFeeBps() view returns (uint256)',
  'function withdrawFeeBps() view returns (uint256)',
  'function paused() view returns (bool)',
  'function owner() view returns (address)',
  'function owner2() view returns (address)',
  'function referredBy(address) view returns (address)',
  'function referralCount(address) view returns (uint256)',
  'function referralEarnings(address) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function fundPool() view returns (uint256)',
] as const

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const

// ─── Types ────────────────────────────────────────────────────────────────────
export interface StakeV5UserInfo {
  staked:       bigint
  rewards:      bigint
  referrer:     string
  refEarnings:  bigint
  refCount:     bigint
  totalDep:     bigint
  totalWith:    bigint
  totalClaim:   bigint
  tokenBalance: bigint
}

export interface StakeV5GlobalStats {
  totalStaked:        bigint
  fundPool:           bigint
  totalDeposited:     bigint
  totalWithdrawn:     bigint
  totalClaimed:       bigint
  totalFeesPaid:      bigint
  totalReferralsPaid: bigint
  totalFunded:        bigint
  totalUsers:         bigint
  totalReferralLinks: bigint
  aprBps:             bigint
  depositFeeBps:      bigint
  withdrawFeeBps:     bigint
  paused:             boolean
  owner:              string
  owner2:             string
}

// ─── Provider singleton ───────────────────────────────────────────────────────
let _provider: ethers.JsonRpcProvider | null = null
export function getStakeV5Provider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(WORLD_CHAIN_RPC_V5, 480, {
      staticNetwork: ethers.Network.from(480),
      batchMaxCount: 10,
    })
  }
  return _provider
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────
export async function fetchStakeV5UserInfo(userAddress: string): Promise<StakeV5UserInfo> {
  if (!STAKE_V5_ADDRESS) throw new Error('H2OStakeV5 not deployed yet')
  const provider = getStakeV5Provider()
  const contract = new ethers.Contract(STAKE_V5_ADDRESS, READ_ABI, provider)
  const token    = new ethers.Contract(ACUA_TOKEN_ADDRESS, ERC20_ABI, provider)

  const [info, tokenBal] = await Promise.all([
    contract.getUserInfo(userAddress),
    token.balanceOf(userAddress),
  ])

  return {
    staked:       BigInt(info[0]),
    rewards:      BigInt(info[1]),
    referrer:     String(info[2]),
    refEarnings:  BigInt(info[3]),
    refCount:     BigInt(info[4]),
    totalDep:     BigInt(info[5]),
    totalWith:    BigInt(info[6]),
    totalClaim:   BigInt(info[7]),
    tokenBalance: BigInt(tokenBal),
  }
}

export async function fetchStakeV5GlobalStats(): Promise<StakeV5GlobalStats> {
  if (!STAKE_V5_ADDRESS) throw new Error('H2OStakeV5 not deployed yet')
  const provider = getStakeV5Provider()
  const contract = new ethers.Contract(STAKE_V5_ADDRESS, READ_ABI, provider)

  const [stats, owner, owner2] = await Promise.all([
    contract.getGlobalStats(),
    contract.owner(),
    contract.owner2(),
  ])

  return {
    totalStaked:        BigInt(stats[0]),
    fundPool:           BigInt(stats[1]),
    totalDeposited:     BigInt(stats[2]),
    totalWithdrawn:     BigInt(stats[3]),
    totalClaimed:       BigInt(stats[4]),
    totalFeesPaid:      BigInt(stats[5]),
    totalReferralsPaid: BigInt(stats[6]),
    totalFunded:        BigInt(stats[7]),
    totalUsers:         BigInt(stats[8]),
    totalReferralLinks: BigInt(stats[9]),
    aprBps:             BigInt(stats[10]),
    depositFeeBps:      BigInt(stats[11]),
    withdrawFeeBps:     BigInt(stats[12]),
    paused:             Boolean(stats[13]),
    owner:              String(owner),
    owner2:             String(owner2),
  }
}

export async function fetchPendingRewards(userAddress: string): Promise<bigint> {
  if (!STAKE_V5_ADDRESS) return 0n
  const provider = getStakeV5Provider()
  const contract = new ethers.Contract(STAKE_V5_ADDRESS, READ_ABI, provider)
  return BigInt(await contract.pendingRewards(userAddress))
}

// ─── Format helpers ───────────────────────────────────────────────────────────
export function formatToken(amount: bigint, decimals = 18, precision = 4): string {
  const formatted = ethers.formatUnits(amount, decimals)
  const num = parseFloat(formatted)
  if (num === 0) return '0'
  if (num < 0.0001) return '< 0.0001'
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: precision })
}

export function formatAPR(bps: bigint): string {
  const pct = Number(bps) / 100
  if (pct === 0) return '—'
  return pct.toFixed(1) + '%'
}

export function formatFee(bps: bigint): string {
  const pct = Number(bps) / 100
  return pct.toFixed(1) + '%'
}

export function randomNonce(): bigint {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}
