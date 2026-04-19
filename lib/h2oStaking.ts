import { ethers } from 'ethers'

// ── Addresses ─────────────────────────────────────────────────────────────
export const H2O_STAKING_ADDRESS = '0x7730583E492D520CcBb3C06325A77EccAbAFa98e'
export const H2O_TOKEN  = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
export const UTH2_TOKEN = '0x9eA8653640E22A5b69887985BB75d496dc97022a'
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const WORLD_CHAIN_RPC = 'https://worldchain-mainnet.g.alchemy.com/public'

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

// buyVIP(uint256 months_) — needs UTH2 approve first (ERC20 transferFrom)
export const BUY_VIP_ABI_FRAG = [{
  name: 'buyVIP', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'months_', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// approve(address spender, uint256 amount) — used for UTH2 → buyVIP
export const APPROVE_ABI_FRAG = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address', internalType: 'address' },
    { name: 'amount',  type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
}] as const

// ── String ABI for read-only ethers.js calls ──────────────────────────────
// Matches the actual H2OUniversalStakingFinal contract
const READ_ABI = [
  // Staking core views
  'function totalStaked() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
  'function rewardPerToken() view returns (uint256)',
  'function earned(address acc) view returns (uint256)',
  // User struct: (uint256 balance, uint256 rewardDebt, uint256 pending)
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
  // VIP
  'function vipExpire(address) view returns (uint256)',
  'function vipPrice() view returns (uint256)',
  // Owner VIP pool
  'function ownerVipPool() view returns (uint256)',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
]

// ── Types ─────────────────────────────────────────────────────────────────
export interface H2OStakeInfo {
  staked: bigint          // users[addr].balance
  earned: bigint          // earned(addr)  — real-time
  refPending: bigint      // refCount * (refPerShare - refRewardDebt) / 1e18
  refCount: bigint        // refCount[addr] — number of people who registered you as referrer
  referrer: string        // referrerOf[addr]
  vipExpiry: bigint       // vipExpire[addr]
  vipPrice: bigint        // vipPrice()
  totalStaked: bigint     // totalStaked()
  rewardRate: bigint      // rewardRate() — H2O wei per second across all stakers
  periodFinish: bigint    // periodFinish()
  depositFeeBps: bigint   // depositFeeBps()
  withdrawFeeBps: bigint  // withdrawFeeBps()
  claimFeeBps: bigint     // claimFeeBps()
  h2oBalance: bigint      // ERC20 balanceOf(addr)
  uth2Balance: bigint     // UTH2 balanceOf(addr)
}

export function getProvider() {
  return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
}

// ── Fetcher ───────────────────────────────────────────────────────────────
export async function fetchH2OStakeInfo(userAddress: string): Promise<H2OStakeInfo> {
  const provider  = getProvider()
  const contract  = new ethers.Contract(H2O_STAKING_ADDRESS, READ_ABI, provider)
  const h2oToken  = new ethers.Contract(H2O_TOKEN,  ERC20_ABI, provider)
  const uth2Token = new ethers.Contract(UTH2_TOKEN, ERC20_ABI, provider)

  const results = await Promise.allSettled([
    contract.totalStaked(),                  // 0
    contract.rewardRate(),                   // 1
    contract.periodFinish(),                 // 2
    contract.earned(userAddress),            // 3
    contract.users(userAddress),             // 4  → { balance, rewardDebt, pending }
    contract.depositFeeBps(),                // 5
    contract.withdrawFeeBps(),               // 6
    contract.claimFeeBps(),                  // 7
    contract.referrerOf(userAddress),        // 8
    contract.refCount(userAddress),          // 9
    contract.refPerShare(),                  // 10
    contract.refRewardDebt(userAddress),     // 11
    contract.vipExpire(userAddress),         // 12
    contract.vipPrice(),                     // 13
    h2oToken.balanceOf(userAddress),         // 14
    uth2Token.balanceOf(userAddress),        // 15
  ])

  const ok = <T>(i: number, fallback: T): T =>
    results[i].status === 'fulfilled'
      ? (results[i] as PromiseFulfilledResult<T>).value
      : fallback

  const userData = ok<{ balance: bigint; rewardDebt: bigint; pending: bigint }>(4, { balance: 0n, rewardDebt: 0n, pending: 0n })
  const staked   = (userData as any)?.balance ?? 0n

  // Calculate pending referral rewards: refCount * (refPerShare - refRewardDebt) / 1e18
  const refCountVal  = ok<bigint>(9,  0n)
  const refPerShareV = ok<bigint>(10, 0n)
  const refDebt      = ok<bigint>(11, 0n)
  const refPending   = refCountVal > 0n && refPerShareV > refDebt
    ? (refCountVal * (refPerShareV - refDebt)) / (10n ** 18n)
    : 0n

  return {
    staked,
    earned:        ok<bigint>(3,  0n),
    refPending,
    refCount:      ok<bigint>(9,  0n),
    referrer:      ok<string>(8,  ethers.ZeroAddress),
    vipExpiry:     ok<bigint>(12, 0n),
    vipPrice:      ok<bigint>(13, 0n),
    totalStaked:   ok<bigint>(0,  0n),
    rewardRate:    ok<bigint>(1,  0n),
    periodFinish:  ok<bigint>(2,  0n),
    depositFeeBps: ok<bigint>(5,  500n),
    withdrawFeeBps:ok<bigint>(6,  500n),
    claimFeeBps:   ok<bigint>(7,  1000n),
    h2oBalance:    ok<bigint>(14, 0n),
    uth2Balance:   ok<bigint>(15, 0n),
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
