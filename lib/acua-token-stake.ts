/**
 * lib/acua-token-stake.ts
 * AcuaTokenStake — staking para token 0xeC83... (H2O Acua Company)
 * Clon funcional de H2OStake2: 48h withdraw queue + referrals + Permit2
 */
import { ethers } from 'ethers'
import deployedInfo from '@/contracts-hh/deployed-acua-token-stake.json'

// ─── Addresses ───────────────────────────────────────────────────────────────
export const ACUA_TOKEN_STAKE_ADDRESS = deployedInfo.contract
export const ACUA_STAKE_TOKEN         = deployedInfo.token   // 0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd
export const PERMIT2_ADDR             = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const WORLD_CHAIN_RPC          = 'https://worldchain-mainnet.g.alchemy.com/public'

// ─── MiniKit ABI fragments ────────────────────────────────────────────────────

const PERMIT_TUPLE_INPUT = {
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
    PERMIT_TUPLE_INPUT,
    { name: 'sig',         type: 'bytes',   internalType: 'bytes' },
    { name: 'grossAmount', type: 'uint256', internalType: 'uint256' },
    { name: 'referrer',    type: 'address', internalType: 'address' },
  ],
  outputs: [],
}] as const

// requestWithdrawal(amount)
export const WITHDRAW_ABI_FRAG = [{
  name: 'requestWithdrawal', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// triggerQueue()
export const TRIGGER_QUEUE_ABI_FRAG = [{
  name: 'triggerQueue', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// claimRewards()
export const CLAIM_ABI_FRAG = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// register(referrer)
export const REGISTER_ABI_FRAG = [{
  name: 'register', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'referrer', type: 'address', internalType: 'address' }],
  outputs: [],
}] as const

// ─── Read ABI (string format for ethers.js) ───────────────────────────────────
const READ_ABI = [
  'function totalStaked() view returns (uint256)',
  'function aprBps() view returns (uint256)',
  'function fundPool() view returns (uint256)',
  'function stakerCount() view returns (uint256)',
  'function paused() view returns (bool)',
  'function totalFunded() view returns (uint256)',
  'function totalClaimed() view returns (uint256)',
  'function totalDeposited() view returns (uint256)',
  'function totalWithdrawn() view returns (uint256)',
  'function totalReferralsPaid() view returns (uint256)',
  'function pendingRewards(address user) view returns (uint256)',
  'function getUserInfo(address user) view returns (uint256 staked, uint256 depositedAt, uint256 lastClaim, address referredBy, bool registered)',
  'function getWithdrawReq(address user) view returns (uint256 id, uint256 amount, uint256 unlockAt, bool processed)',
  'function referredBy(address) view returns (address)',
  'function referralCount(address) view returns (uint256)',
  'function referralEarnings(address) view returns (uint256)',
]

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)']

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AcuaStakeInfo {
  staked:            bigint
  depositedAt:       bigint
  lastClaim:         bigint
  referredBy:        string
  registered:        boolean
  pendingRewards:    bigint
  withdrawId:        bigint
  withdrawAmount:    bigint
  withdrawUnlockAt:  bigint
  withdrawProcessed: boolean
  totalStaked:       bigint
  aprBps:            bigint
  fundPool:          bigint
  stakerCount:       bigint
  paused:            boolean
  tokenBalance:      bigint
  refCount:          bigint
  refEarnings:       bigint
}

// ─── Provider singleton ───────────────────────────────────────────────────────
let _provider: ethers.JsonRpcProvider | null = null
export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(WORLD_CHAIN_RPC, 480, {
      staticNetwork: ethers.Network.from(480), batchMaxCount: 10,
    })
  }
  return _provider
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────
export async function fetchAcuaStakeInfo(userAddress: string): Promise<AcuaStakeInfo> {
  const provider  = getProvider()
  const contract  = new ethers.Contract(ACUA_TOKEN_STAKE_ADDRESS, READ_ABI, provider)
  const token     = new ethers.Contract(ACUA_STAKE_TOKEN, ERC20_ABI, provider)

  const [globalResults, userResults, tokenBal] = await Promise.all([
    Promise.allSettled([
      contract.totalStaked(),
      contract.aprBps(),
      contract.fundPool(),
      contract.stakerCount(),
      contract.paused(),
    ]),
    Promise.allSettled([
      contract.pendingRewards(userAddress),
      contract.getUserInfo(userAddress),
      contract.getWithdrawReq(userAddress),
      contract.referralCount(userAddress),
      contract.referralEarnings(userAddress),
    ]),
    token.balanceOf(userAddress).catch(() => 0n),
  ])

  const g = (i: number, def = 0n) => globalResults[i].status === 'fulfilled' ? BigInt(globalResults[i].value) : def
  const u = (i: number, def: any = null) => userResults[i].status === 'fulfilled' ? userResults[i].value : def

  const userInfo    = u(1) || [0n, 0n, 0n, ethers.ZeroAddress, false]
  const withdrawReq = u(2) || [0n, 0n, 0n, true]

  return {
    staked:            BigInt(userInfo[0]),
    depositedAt:       BigInt(userInfo[1]),
    lastClaim:         BigInt(userInfo[2]),
    referredBy:        String(userInfo[3] ?? ethers.ZeroAddress),
    registered:        Boolean(userInfo[4]),
    pendingRewards:    BigInt(u(0) ?? 0n),
    withdrawId:        BigInt(withdrawReq[0]),
    withdrawAmount:    BigInt(withdrawReq[1]),
    withdrawUnlockAt:  BigInt(withdrawReq[2]),
    withdrawProcessed: Boolean(withdrawReq[3]),
    totalStaked:       g(0),
    aprBps:            g(1, 1200n),
    fundPool:          g(2),
    stakerCount:       g(3),
    paused:            Boolean(globalResults[4].status === 'fulfilled' ? globalResults[4].value : false),
    tokenBalance:      BigInt(tokenBal),
    refCount:          BigInt(u(3) ?? 0n),
    refEarnings:       BigInt(u(4) ?? 0n),
  }
}
