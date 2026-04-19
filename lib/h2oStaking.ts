import { ethers } from 'ethers'

// ── Addresses ─────────────────────────────────────────────────────────────
export const H2O_STAKING_ADDRESS = '0x7730583E492D520CcBb3C06325A77EccAbAFa98e'
export const H2O_VIP_ADDRESS     = '0x4202eB735e19D7625BE498DA8f204905450c2649'
export const H2O_TOKEN  = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
export const UTH2_TOKEN = '0x9eA8653640E22A5b69887985BB75d496dc97022a'
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const WORLD_CHAIN_RPC = 'https://worldchain-mainnet.g.alchemy.com/v2/bVo646pb8L7_W_nahCoqW'

// ── Permit2 tuple for MiniKit ─────────────────────────────────────────────
// Matches: stake(IPermit2.PermitTransferFrom permit, bytes sig)
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
        { name: 'token',  type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce',    type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

// ── MiniKit ABI fragments ─────────────────────────────────────────────────

// stake(IPermit2.PermitTransferFrom permit, bytes sig)
export const STAKE_ABI_FRAG = [{
  name: 'stake', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    PERMIT_TUPLE_INPUT,
    { name: 'sig', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

// unstake(uint256 amount)
export const UNSTAKE_ABI_FRAG = [{
  name: 'unstake', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// claimRewards()
export const CLAIM_ABI_FRAG = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// claimRefRewards()
export const CLAIM_REF_ABI_FRAG = [{
  name: 'claimRefRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// registerReferrer(address ref)
export const REGISTER_REF_ABI_FRAG = [{
  name: 'registerReferrer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'ref', type: 'address', internalType: 'address' }],
  outputs: [],
}] as const

// claimOwnerVip() — claim pending UTH2 from VIP pool (for owners/creators with shares)
export const CLAIM_OWNER_VIP_ABI_FRAG = [{
  name: 'claimOwnerVip', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

// buyVIPWithPermit2(uint256 months_, PermitTransferFrom permit, bytes sig)
// New standalone VIP contract — no approve needed, World App signs Permit2
export const BUY_VIP_PERMIT2_ABI_FRAG = [{
  name: 'buyVIPWithPermit2', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'months_', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE_INPUT,
    { name: 'sig', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

// claimOwnerVip() — kept for backward compat alias
export const BUY_VIP_ABI_FRAG = BUY_VIP_PERMIT2_ABI_FRAG

// approve — kept for any legacy usage
export const APPROVE_ABI_FRAG = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address', internalType: 'address' },
    { name: 'amount',  type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
}] as const

// ── String ABI for read-only ethers.js calls (main staking contract) ──────
const READ_ABI = [
  // Staking core views
  'function totalStaked() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
  'function rewardPerToken() view returns (uint256)',
  'function earned(address acc) view returns (uint256)',
  'function users(address) view returns (uint256 balance, uint256 rewardDebt, uint256 pending)',
  // Fees
  'function depositFeeBps() view returns (uint256)',
  'function withdrawFeeBps() view returns (uint256)',
  'function claimFeeBps() view returns (uint256)',
  // Referral
  'function referrerOf(address) view returns (address)',
  'function refCount(address) view returns (uint256)',
  'function refPerShare() view returns (uint256)',
  'function refRewardDebt(address) view returns (uint256)',
]

// ── String ABI for the standalone H2OVIPSubscription contract ─────────────
const VIP_READ_ABI = [
  'function vipExpire(address) view returns (uint256)',
  'function vipPrice() view returns (uint256)',
  'function pendingReward(address) view returns (uint256)',
  'function holderShares(address) view returns (uint256)',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
]

// ── Types ─────────────────────────────────────────────────────────────────
export interface H2OStakeInfo {
  staked: bigint          // users[addr].balance
  earned: bigint          // earned(addr)
  refPending: bigint      // referral rewards pending
  refCount: bigint        // number of referrals
  referrer: string        // referrerOf[addr]
  vipExpiry: bigint       // vipExpire[addr]  — from VIP contract
  vipPrice: bigint        // vipPrice()        — from VIP contract
  ownerVipPending: bigint // pendingReward()   — from VIP contract
  totalStaked: bigint     // totalStaked()
  rewardRate: bigint      // rewardRate()
  periodFinish: bigint    // periodFinish()
  depositFeeBps: bigint
  withdrawFeeBps: bigint
  claimFeeBps: bigint
  h2oBalance: bigint
  uth2Balance: bigint
}

export function getProvider() {
  return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
}

// ── Fetcher ───────────────────────────────────────────────────────────────
export async function fetchH2OStakeInfo(userAddress: string): Promise<H2OStakeInfo> {
  const provider  = getProvider()
  const contract  = new ethers.Contract(H2O_STAKING_ADDRESS, READ_ABI, provider)
  const vipContract = new ethers.Contract(H2O_VIP_ADDRESS, VIP_READ_ABI, provider)
  const h2oToken  = new ethers.Contract(H2O_TOKEN,  ERC20_ABI, provider)
  const uth2Token = new ethers.Contract(UTH2_TOKEN, ERC20_ABI, provider)

  const [stakingResults, vipResults] = await Promise.all([
    Promise.allSettled([
      contract.totalStaked(),                  // 0
      contract.rewardRate(),                   // 1
      contract.periodFinish(),                 // 2
      contract.earned(userAddress),            // 3
      contract.users(userAddress),             // 4
      contract.depositFeeBps(),                // 5
      contract.withdrawFeeBps(),               // 6
      contract.claimFeeBps(),                  // 7
      contract.referrerOf(userAddress),        // 8
      contract.refCount(userAddress),          // 9
      contract.refPerShare(),                  // 10
      contract.refRewardDebt(userAddress),     // 11
      h2oToken.balanceOf(userAddress),         // 12
      uth2Token.balanceOf(userAddress),        // 13
    ]),
    Promise.allSettled([
      vipContract.vipExpire(userAddress),      // 0
      vipContract.vipPrice(),                  // 1
      vipContract.pendingReward(userAddress),  // 2
    ]),
  ])

  const ok = <T>(arr: PromiseSettledResult<unknown>[], i: number, fallback: T): T =>
    arr[i].status === 'fulfilled'
      ? (arr[i] as PromiseFulfilledResult<T>).value
      : fallback

  const s = (i: number, fallback: bigint) => ok<bigint>(stakingResults, i, fallback)
  const v = (i: number, fallback: bigint) => ok<bigint>(vipResults, i, fallback)

  const userData = ok<{ balance: bigint; rewardDebt: bigint; pending: bigint }>(
    stakingResults, 4, { balance: 0n, rewardDebt: 0n, pending: 0n }
  )
  const staked = (userData as any)?.balance ?? 0n

  const refCountVal  = s(9,  0n)
  const refPerShareV = s(10, 0n)
  const refDebt      = s(11, 0n)
  const refPending   = refCountVal > 0n && refPerShareV > refDebt
    ? (refCountVal * (refPerShareV - refDebt)) / (10n ** 18n)
    : 0n

  return {
    staked,
    earned:          s(3,  0n),
    refPending,
    refCount:        s(9,  0n),
    referrer:        ok<string>(stakingResults, 8, ethers.ZeroAddress),
    vipExpiry:       v(0,  0n),
    vipPrice:        v(1,  0n),
    ownerVipPending: v(2,  0n),
    totalStaked:     s(0,  0n),
    rewardRate:      s(1,  0n),
    periodFinish:    s(2,  0n),
    depositFeeBps:   s(5,  500n),
    withdrawFeeBps:  s(6,  500n),
    claimFeeBps:     s(7,  1000n),
    h2oBalance:      s(12, 0n),
    uth2Balance:     s(13, 0n),
  }
}

// ── APY calculation ───────────────────────────────────────────────────────
// APY = (rewardRate * SECONDS_PER_YEAR / totalStaked) * 100  (as %)
// rewardRate is in wei/second, totalStaked is in wei
export function calcAPY(rewardRate: bigint, totalStaked: bigint, periodFinish: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (rewardRate === 0n || periodFinish < now) return '—'
  if (totalStaked === 0n) return 'Pool activo'   // funded but no stakers yet
  const SECONDS_PER_YEAR = 365n * 24n * 3600n
  const apyBps = (rewardRate * SECONDS_PER_YEAR * 10000n) / totalStaked
  const apyFloat = Number(apyBps) / 100
  return apyFloat.toFixed(2) + '%'
}

// ── Formatters ────────────────────────────────────────────────────────────
export function formatToken(amount: bigint, decimals = 18, precision = 4): string {
  const num = parseFloat(ethers.formatUnits(amount, decimals))
  if (num === 0) return '0'
  if (num < 0.0001) return '< 0.0001'
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: precision })
}

export function shortenAddress(addr: string): string {
  if (!addr || addr === ethers.ZeroAddress) return '—'
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function randomNonce(): bigint {
  if (typeof window !== 'undefined' && window.crypto) {
    const arr = new Uint32Array(2)
    window.crypto.getRandomValues(arr)
    return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
  }
  return BigInt(Math.floor(Math.random() * 2 ** 32))
}
