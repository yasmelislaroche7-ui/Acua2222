import { ethers } from 'ethers'

export const H2O_STAKING_ADDRESS = '0x7730583E492D520CcBb3C06325A77EccAbAFa98e'
export const H2O_TOKEN  = '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d'
export const UTH2_TOKEN = '0x9eA8653640E22A5b69887985BB75d496dc97022a'
export const WORLD_CHAIN_RPC = 'https://worldchain-mainnet.g.alchemy.com/public'

// ── Minimal ABI fragments for MiniKit sendTransaction ──────────────────────
export const STAKE_ABI_FRAG = [{
  name: 'stake', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

export const UNSTAKE_ABI_FRAG = [{
  name: 'unstake', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

export const CLAIM_ABI_FRAG = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

export const CLAIM_REF_ABI_FRAG = [{
  name: 'claimRefRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [], outputs: [],
}] as const

export const REGISTER_REF_ABI_FRAG = [{
  name: 'registerReferrer', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'ref', type: 'address', internalType: 'address' }],
  outputs: [],
}] as const

export const BUY_VIP_ABI_FRAG = [{
  name: 'buyVIP', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'months_', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

export const APPROVE_ABI_FRAG = [{
  name: 'approve', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address', internalType: 'address' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
}] as const

// ── String ABI for read-only ethers calls ───────────────────────────────────
const READ_ABI = [
  'function earned(address acc) view returns (uint256)',
  'function vipPrice() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function apyBps() view returns (uint256)',
  'function rewardFee() view returns (uint256)',
  'function stakers(address) view returns (uint256 amount, uint256 startTime)',
  'function referrers(address) view returns (address)',
  'function refRewards(address) view returns (uint256)',
  'function vipExpiry(address) view returns (uint256)',
]

const ERC20_READ = ['function balanceOf(address) view returns (uint256)']

// ── Types ──────────────────────────────────────────────────────────────────
export interface H2OStakeInfo {
  staked: bigint
  earned: bigint
  refRewards: bigint
  referrer: string
  vipExpiry: bigint
  vipPrice: bigint
  totalStaked: bigint
  apyBps: bigint
  rewardFee: bigint
  h2oBalance: bigint
  uth2Balance: bigint
}

export function getProvider() {
  return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
}

// ── Fetcher ────────────────────────────────────────────────────────────────
export async function fetchH2OStakeInfo(userAddress: string): Promise<H2OStakeInfo> {
  const provider = getProvider()
  const contract = new ethers.Contract(H2O_STAKING_ADDRESS, READ_ABI, provider)
  const h2oToken  = new ethers.Contract(H2O_TOKEN,  ERC20_READ, provider)
  const uth2Token = new ethers.Contract(UTH2_TOKEN, ERC20_READ, provider)

  const results = await Promise.allSettled([
    contract.earned(userAddress),      // 0
    contract.vipPrice(),               // 1
    contract.totalStaked(),            // 2
    contract.apyBps(),                 // 3
    contract.rewardFee(),              // 4
    contract.stakers(userAddress),     // 5
    contract.referrers(userAddress),   // 6
    contract.refRewards(userAddress),  // 7
    contract.vipExpiry(userAddress),   // 8
    h2oToken.balanceOf(userAddress),   // 9
    uth2Token.balanceOf(userAddress),  // 10
  ])

  const ok = <T>(i: number, fallback: T): T =>
    results[i].status === 'fulfilled' ? (results[i] as PromiseFulfilledResult<T>).value : fallback

  const stakerData = ok<{ amount: bigint; startTime: bigint } | bigint[]>(5, [0n, 0n])
  const staked = Array.isArray(stakerData)
    ? (stakerData[0] as bigint)
    : ((stakerData as any).amount as bigint) ?? 0n

  return {
    earned:     ok<bigint>(0, 0n),
    vipPrice:   ok<bigint>(1, 0n),
    totalStaked:ok<bigint>(2, 0n),
    apyBps:     ok<bigint>(3, 1200n),
    rewardFee:  ok<bigint>(4, 500n),
    staked,
    referrer:   ok<string>(6, ethers.ZeroAddress),
    refRewards: ok<bigint>(7, 0n),
    vipExpiry:  ok<bigint>(8, 0n),
    h2oBalance: ok<bigint>(9, 0n),
    uth2Balance:ok<bigint>(10, 0n),
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────
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
