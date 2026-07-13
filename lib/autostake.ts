// lib/autostake.ts
// ABI, dirección y helpers para AcuaAutoStake.
// NOTA: contrato AÚN NO DESPLEGADO — placeholder address.

import { ethers } from 'ethers'
import { getProvider } from '@/lib/new-contracts'

// ─── Dirección del contrato ───────────────────────────────────────────────────
// TODO: reemplazar con la dirección real después del deploy.
export const ACUA_AUTOSTAKE_ADDRESS = '0x0000000000000000000000000000000000000001'
export const DEPLOYED = false

// H2O token en World Chain
export const H2O_TOKEN = '0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd'
export const PERMIT2   = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

// ─── ABIs ────────────────────────────────────────────────────────────────────

const PERMIT_TUPLE = {
  name: 'permit', type: 'tuple', internalType: 'struct IPermit2.PermitTransferFrom',
  components: [
    {
      name: 'permitted', type: 'tuple', internalType: 'struct IPermit2.TokenPermissions',
      components: [
        { name: 'token',  type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce',    type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

export const STAKE_ABI = [{
  name: 'stakeWithPermit2', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',  type: 'address', internalType: 'address' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE,
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

export const UNSTAKE_ABI = [{
  name: 'unstake', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',  type: 'address', internalType: 'address' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

export const CLAIM_FOR_ABI = [{
  name: 'claimFor', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token', type: 'address', internalType: 'address' },
    { name: 'user',  type: 'address', internalType: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
}] as const

export const CLAIM_BATCH_ABI = [{
  name: 'claimForBatch', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token', type: 'address', internalType: 'address' },
    { name: 'users', type: 'address[]', internalType: 'address[]' },
  ],
  outputs: [],
}] as const

export const FUND_PERMIT2_ABI = [{
  name: 'fundRewardsPermit2', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',  type: 'address', internalType: 'address' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE,
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

export const ADD_TOKEN_ABI = [{
  name: 'addToken', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',  type: 'address', internalType: 'address' },
    { name: 'aprBps', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

export const SET_APR_ABI = [{
  name: 'setApr', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',  type: 'address', internalType: 'address' },
    { name: 'aprBps', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

export const SET_FEES_ABI = [{
  name: 'setFees', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: '_stake',   type: 'uint256', internalType: 'uint256' },
    { name: '_unstake', type: 'uint256', internalType: 'uint256' },
    { name: '_claim',   type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

export const ADD_OWNER_ABI = [{
  name: 'addOwner', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'addr', type: 'address', internalType: 'address' }],
  outputs: [],
}] as const

export const SET_OWNER2_ABI = [{
  name: 'setOwner2', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'addr', type: 'address', internalType: 'address' }],
  outputs: [],
}] as const

// Read-only ABI (ethers.js)
export const READ_ABI = [
  'function stakeFeeBps() view returns (uint256)',
  'function unstakeFeeBps() view returns (uint256)',
  'function claimFeeBps() view returns (uint256)',
  'function owner2() view returns (address)',
  'function getOwners() view returns (address[])',
  'function getTokenList() view returns (address[])',
  'function tokens(address) view returns (bool allowed, uint256 aprBps, uint256 rewardFund)',
  'function positions(address,address) view returns (uint256 amount, uint256 lastClaimed)',
  'function pendingReward(address,address) view returns (uint256)',
  'function stakersCount(address) view returns (uint256)',
  'function getClaimablePositions(address,uint256,uint256) view returns (address[],uint256[],uint256[],uint256[])',
  'function getAllPositions(address,uint256,uint256) view returns (address[],uint256[],uint256[],uint256[])',
  'function isOwner(address) view returns (bool)',
  'function CLAIM_COOLDOWN() view returns (uint256)',
]

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
]

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenInfo {
  address: string
  symbol: string
  name: string
  aprBps: bigint
  aprPct: number
  rewardFund: bigint
  stakersCount: bigint
}

export interface UserPosition {
  token: string
  symbol: string
  amount: bigint
  pendingReward: bigint
  lastClaimed: bigint
  cooldownRemaining: number // seconds
}

export interface ClaimablePosition {
  user: string
  token: string
  symbol: string
  stake: bigint
  reward: bigint
  elapsed: number // seconds
  processorEarns: bigint // 1% of reward
}

export interface ContractStats {
  stakeFeePct: number
  unstakeFeePct: number
  claimFeePct: number
  owner2: string
  owners: string[]
  tokens: TokenInfo[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function randomNonce(): bigint {
  if (typeof window !== 'undefined' && window.crypto) {
    const a = new Uint32Array(2)
    window.crypto.getRandomValues(a)
    return BigInt(a[0]) * 0x100000000n + BigInt(a[1])
  }
  return BigInt(Math.floor(Math.random() * 2 ** 48))
}

export async function fetchContractStats(): Promise<ContractStats> {
  const p = getProvider()
  const c = new ethers.Contract(ACUA_AUTOSTAKE_ADDRESS, READ_ABI, p)
  const [stakeFeeBps, unstakeFeeBps, claimFeeBps, owner2addr, owners, tokenAddrs] = await Promise.all([
    c.stakeFeeBps(),
    c.unstakeFeeBps(),
    c.claimFeeBps(),
    c.owner2(),
    c.getOwners(),
    c.getTokenList(),
  ])

  const tokenInfos: TokenInfo[] = await Promise.all(
    (tokenAddrs as string[]).map(async (addr) => {
      const cfg = await c.tokens(addr)
      const erc20 = new ethers.Contract(addr, ERC20_ABI, p)
      const [symbol, name, sc] = await Promise.all([
        erc20.symbol().catch(() => 'TKN'),
        erc20.name().catch(() => addr),
        c.stakersCount(addr),
      ])
      return {
        address: addr,
        symbol,
        name,
        aprBps: cfg.aprBps as bigint,
        aprPct: Number(cfg.aprBps) / 100,
        rewardFund: cfg.rewardFund as bigint,
        stakersCount: sc as bigint,
      }
    })
  )

  return {
    stakeFeePct: Number(stakeFeeBps) / 100,
    unstakeFeePct: Number(unstakeFeeBps) / 100,
    claimFeePct: Number(claimFeeBps) / 100,
    owner2: owner2addr as string,
    owners: owners as string[],
    tokens: tokenInfos,
  }
}

export async function fetchUserPositions(userAddress: string): Promise<UserPosition[]> {
  const p = getProvider()
  const c = new ethers.Contract(ACUA_AUTOSTAKE_ADDRESS, READ_ABI, p)
  const tokenAddrs: string[] = await c.getTokenList()
  const now = Math.floor(Date.now() / 1000)

  const results = await Promise.all(
    tokenAddrs.map(async (addr) => {
      const erc20 = new ethers.Contract(addr, ERC20_ABI, p)
      const [pos, pending, symbol] = await Promise.all([
        c.positions(addr, userAddress),
        c.pendingReward(addr, userAddress),
        erc20.symbol().catch(() => 'TKN'),
      ])
      const lastClaimed = Number(pos.lastClaimed)
      const cooldown = Math.max(0, lastClaimed + 600 - now)
      return {
        token: addr,
        symbol,
        amount: pos.amount as bigint,
        pendingReward: pending as bigint,
        lastClaimed: pos.lastClaimed as bigint,
        cooldownRemaining: cooldown,
      } satisfies UserPosition
    })
  )

  return results.filter(r => r.amount > 0n || r.pendingReward > 0n)
}

export async function fetchClaimablePositions(
  tokenAddress: string,
  tokenSymbol: string,
  limit = 50
): Promise<ClaimablePosition[]> {
  const p = getProvider()
  const c = new ethers.Contract(ACUA_AUTOSTAKE_ADDRESS, READ_ABI, p)
  const [users, stakes, rewards, elapsed] = await c.getClaimablePositions(tokenAddress, 0, limit)

  return (users as string[]).map((user, i) => ({
    user,
    token: tokenAddress,
    symbol: tokenSymbol,
    stake: stakes[i] as bigint,
    reward: rewards[i] as bigint,
    elapsed: Number(elapsed[i]),
    processorEarns: (rewards[i] as bigint) / 100n,
  }))
}

export function formatApr(aprBps: bigint): string {
  return `${(Number(aprBps) / 100).toFixed(1)}%`
}

export function fmtToken(val: bigint, decimals = 18, dp = 4): string {
  return parseFloat(ethers.formatUnits(val, decimals)).toFixed(dp)
}
