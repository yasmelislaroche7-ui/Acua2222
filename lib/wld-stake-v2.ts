// lib/wld-stake-v2.ts — WLD 2.0 Staking on World Chain
import { ethers } from 'ethers'
import { getProvider } from '@/lib/new-contracts'

// ─── Contract addresses ─────────────────────────────────────────────────────

export const WLD_TOKEN  = '0x2cFc85d8E48F8EAB294be644d9E25C3030863003'
export const WLD_OWNER2 = '0x5474c309e985c6b4fc623acf01ade604da781e52'

let _wldContract = '' as string
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const deployed = require('../contracts-hh/deployed-wld-v2.json')
  if (deployed?.contract) _wldContract = deployed.contract
} catch { /* not deployed yet */ }
export const WLD_CONTRACT = _wldContract

// ─── ABI fragments (same structure as SushiStakeV2) ─────────────────────────

const PERMIT_TUPLE = {
  name: 'permit',
  type: 'tuple',
  internalType: 'struct IPermit2.PermitTransferFrom',
  components: [
    {
      name: 'permitted',
      type: 'tuple',
      internalType: 'struct IPermit2.TokenPermissions',
      components: [
        { name: 'token',  type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce',    type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

export const WLD_STAKE_ABI = [{
  name: 'stake',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [PERMIT_TUPLE, { name: 'signature', type: 'bytes' }, { name: 'grossAmount', type: 'uint256' }],
  outputs: [],
}] as const

export const WLD_WITHDRAW_ABI = [{
  name: 'requestWithdrawal',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'grossAmount', type: 'uint256' }],
  outputs: [],
}] as const

export const WLD_CLAIM_ABI = [{
  name: 'requestClaim',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [],
  outputs: [],
}] as const

export const WLD_FUND_ABI = [{
  name: 'fund',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [PERMIT_TUPLE, { name: 'signature', type: 'bytes' }, { name: 'amount', type: 'uint256' }],
  outputs: [],
}] as const

export const WLD_TRIGGER_ABI = [{
  name: 'triggerQueue',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [],
  outputs: [],
}] as const

export const WLD_SET_APR_ABI = [{
  name: 'setApr',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'newAprBps', type: 'uint256' }],
  outputs: [],
}] as const

export const WLD_SET_FEE_ABI = [{
  name: 'setFee',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'newFeeBps', type: 'uint256' }],
  outputs: [],
}] as const

// ─── View ABI ──────────────────────────────────────────────────────────────

const VIEW_ABI = [
  'function pendingRewards(address user) view returns (uint256)',
  'function getUserInfo(address user) view returns (uint256 staked, uint256 rewards, bool hasWithdraw, bool hasClaim, uint256 withdrawPos, uint256 claimPos)',
  'function getUserWithdrawReq(address user) view returns (tuple(address user, uint256 gross, uint256 fee, uint256 netAmount, uint256 requestedAt, uint256 readyAt, uint256 paidAt, bool paid))',
  'function getUserClaimReq(address user) view returns (tuple(address user, uint256 gross, uint256 fee, uint256 netAmount, uint256 requestedAt, uint256 readyAt, uint256 paidAt, bool paid))',
  'function getWithdrawQueuePage(uint256 offset, uint256 limit) view returns (tuple(address user, uint256 gross, uint256 fee, uint256 netAmount, uint256 requestedAt, uint256 readyAt, uint256 paidAt, bool paid)[])',
  'function getClaimQueuePage(uint256 offset, uint256 limit) view returns (tuple(address user, uint256 gross, uint256 fee, uint256 netAmount, uint256 requestedAt, uint256 readyAt, uint256 paidAt, bool paid)[])',
  'function getGlobalStats() view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
  'function lastWithdrawDay(address) view returns (uint256)',
  'function lastClaimDay(address) view returns (uint256)',
  'function userWithdrawId(address) view returns (uint256)',
  'function userClaimId(address) view returns (uint256)',
]

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WldQueueEntry {
  user:        string
  gross:       bigint
  fee:         bigint
  netAmount:   bigint
  requestedAt: number
  readyAt:     number
  paidAt:      number
  paid:        boolean
}

export interface UserWldInfo {
  staked:      bigint
  rewards:     bigint
  hasWithdraw: boolean
  hasClaim:    boolean
  withdrawPos: number
  claimPos:    number
  wldBal:      bigint
  withdrawReq: WldQueueEntry | null
  claimReq:    WldQueueEntry | null
  lastWithdrawDay: number
  lastClaimDay:    number
}

export interface GlobalWldStats {
  totalStaked:             bigint
  fundPool:                bigint
  totalPendingWithdrawals: bigint
  totalPendingClaims:      bigint
  withdrawQueueLen:        number
  claimQueueLen:           number
  nextWithdrawIdx:         number
  nextClaimIdx:            number
  stakerCount:             number
  totalFeeCollected:       bigint
  totalFunded:             bigint
  aprBps:                  number
  feeBps:                  number
}

// ─── Fetch functions ────────────────────────────────────────────────────────

export async function fetchUserWldInfo(userAddress: string): Promise<UserWldInfo> {
  if (!WLD_CONTRACT) return emptyWldUserInfo()
  const p = getProvider()
  const c = new ethers.Contract(WLD_CONTRACT, VIEW_ABI, p)
  const t = new ethers.Contract(WLD_TOKEN, ERC20_ABI, p)

  const [info, wldBal, lastWD, lastCD, wId, cId] = await Promise.all([
    c.getUserInfo(userAddress).catch(() => [0n, 0n, false, false, 0n, 0n]),
    t.balanceOf(userAddress).catch(() => 0n),
    c.lastWithdrawDay(userAddress).catch(() => 0n),
    c.lastClaimDay(userAddress).catch(() => 0n),
    c.userWithdrawId(userAddress).catch(() => 0n),
    c.userClaimId(userAddress).catch(() => 0n),
  ])

  const [staked, rewards, hasWithdraw, hasClaim, withdrawPos, claimPos] = info

  let withdrawReq: WldQueueEntry | null = null
  let claimReq: WldQueueEntry | null = null

  if (hasWithdraw && Number(wId) > 0) {
    try {
      const r = await c.getUserWithdrawReq(userAddress)
      withdrawReq = parseWldEntry(r)
    } catch { /* none */ }
  }
  if (hasClaim && Number(cId) > 0) {
    try {
      const r = await c.getUserClaimReq(userAddress)
      claimReq = parseWldEntry(r)
    } catch { /* none */ }
  }

  return {
    staked:          BigInt(staked),
    rewards:         BigInt(rewards),
    hasWithdraw:     Boolean(hasWithdraw),
    hasClaim:        Boolean(hasClaim),
    withdrawPos:     Number(withdrawPos),
    claimPos:        Number(claimPos),
    wldBal:          BigInt(wldBal),
    withdrawReq,
    claimReq,
    lastWithdrawDay: Number(lastWD),
    lastClaimDay:    Number(lastCD),
  }
}

export async function fetchGlobalWldStats(): Promise<GlobalWldStats> {
  if (!WLD_CONTRACT) return emptyWldStats()
  const p = getProvider()
  const c = new ethers.Contract(WLD_CONTRACT, VIEW_ABI, p)
  try {
    const r = await c.getGlobalStats()
    return {
      totalStaked:             BigInt(r[0]),
      fundPool:                BigInt(r[1]),
      totalPendingWithdrawals: BigInt(r[2]),
      totalPendingClaims:      BigInt(r[3]),
      withdrawQueueLen:        Number(r[4]),
      claimQueueLen:           Number(r[5]),
      nextWithdrawIdx:         Number(r[6]),
      nextClaimIdx:            Number(r[7]),
      stakerCount:             Number(r[8]),
      totalFeeCollected:       BigInt(r[9]),
      totalFunded:             BigInt(r[10]),
      aprBps:                  Number(r[11]),
      feeBps:                  Number(r[12]),
    }
  } catch { return emptyWldStats() }
}

export async function fetchWldWithdrawQueue(offset = 0, limit = 20): Promise<WldQueueEntry[]> {
  if (!WLD_CONTRACT) return []
  try {
    const p = getProvider()
    const c = new ethers.Contract(WLD_CONTRACT, VIEW_ABI, p)
    const rows = await c.getWithdrawQueuePage(offset, limit)
    return rows.map(parseWldEntry)
  } catch { return [] }
}

export async function fetchWldClaimQueue(offset = 0, limit = 20): Promise<WldQueueEntry[]> {
  if (!WLD_CONTRACT) return []
  try {
    const p = getProvider()
    const c = new ethers.Contract(WLD_CONTRACT, VIEW_ABI, p)
    const rows = await c.getClaimQueuePage(offset, limit)
    return rows.map(parseWldEntry)
  } catch { return [] }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseWldEntry(r: any): WldQueueEntry {
  return {
    user:        String(r.user ?? r[0] ?? ''),
    gross:       BigInt(r.gross ?? r[1] ?? 0n),
    fee:         BigInt(r.fee   ?? r[2] ?? 0n),
    netAmount:   BigInt(r.netAmount ?? r[3] ?? 0n),
    requestedAt: Number(r.requestedAt ?? r[4] ?? 0),
    readyAt:     Number(r.readyAt     ?? r[5] ?? 0),
    paidAt:      Number(r.paidAt      ?? r[6] ?? 0),
    paid:        Boolean(r.paid       ?? r[7] ?? false),
  }
}

function emptyWldUserInfo(): UserWldInfo {
  return {
    staked: 0n, rewards: 0n, hasWithdraw: false, hasClaim: false,
    withdrawPos: 0, claimPos: 0, wldBal: 0n,
    withdrawReq: null, claimReq: null,
    lastWithdrawDay: 0, lastClaimDay: 0,
  }
}

function emptyWldStats(): GlobalWldStats {
  return {
    totalStaked: 0n, fundPool: 0n, totalPendingWithdrawals: 0n, totalPendingClaims: 0n,
    withdrawQueueLen: 0, claimQueueLen: 0, nextWithdrawIdx: 0, nextClaimIdx: 0,
    stakerCount: 0, totalFeeCollected: 0n, totalFunded: 0n, aprBps: 10000, feeBps: 500,
  }
}

export function fmtWld(wei: bigint, decimals = 4): string {
  return parseFloat(ethers.formatUnits(wei, 18)).toFixed(decimals)
}

export function fmtWldShort(wei: bigint): string {
  const n = parseFloat(ethers.formatUnits(wei, 18))
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(2) + 'K'
  return n.toFixed(4)
}
