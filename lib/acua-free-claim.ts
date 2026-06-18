/**
 * lib/acua-free-claim.ts
 * AcuaFreeClaim — multi-token free claim contract
 * Admin crea pools de tokens, usuarios reclaman una vez por cooldown
 */
import { ethers } from 'ethers'
import deployedInfo from '@/contracts-hh/deployed-acua-free-claim.json'

// ─── Addresses ───────────────────────────────────────────────────────────────
export const ACUA_FREE_CLAIM_ADDRESS = deployedInfo.contract
export const WORLD_CHAIN_RPC         = 'https://worldchain-mainnet.g.alchemy.com/public'

// ─── MiniKit ABI fragments ────────────────────────────────────────────────────

// claim(id)
export const CLAIM_ABI_FRAG = [{
  name: 'claim', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// addPool(token, amountPerClaim, cooldown, tokenName, tokenSymbol)
export const ADD_POOL_ABI_FRAG = [{
  name: 'addPool', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',          type: 'address', internalType: 'address' },
    { name: 'amountPerClaim', type: 'uint256', internalType: 'uint256' },
    { name: 'cooldown',       type: 'uint256', internalType: 'uint256' },
    { name: 'tokenName',      type: 'string',  internalType: 'string' },
    { name: 'tokenSymbol',    type: 'string',  internalType: 'string' },
  ],
  outputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
}] as const

// setPoolInfo(id, amountPerClaim, cooldown, active, tokenName, tokenSymbol)
export const SET_POOL_ABI_FRAG = [{
  name: 'setPoolInfo', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'id',             type: 'uint256', internalType: 'uint256' },
    { name: 'amountPerClaim', type: 'uint256', internalType: 'uint256' },
    { name: 'cooldown',       type: 'uint256', internalType: 'uint256' },
    { name: 'active',         type: 'bool',    internalType: 'bool' },
    { name: 'tokenName',      type: 'string',  internalType: 'string' },
    { name: 'tokenSymbol',    type: 'string',  internalType: 'string' },
  ],
  outputs: [],
}] as const

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

// fund(id, permit, sig)
export const FUND_ABI_FRAG = [{
  name: 'fund', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'id', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE_INPUT,
    { name: 'sig', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

// withdrawAll(id)
export const WITHDRAW_ALL_ABI_FRAG = [{
  name: 'withdrawAll', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// ─── Read ABI ─────────────────────────────────────────────────────────────────
const READ_ABI = [
  'function poolCount() view returns (uint256)',
  `function getAllPools() view returns (tuple(address token,uint256 balance,uint256 amountPerClaim,uint256 cooldown,uint256 totalClaimed,uint256 claimCount,bool active,string name,string symbol)[] pools)`,
  `function getAllPoolsWithCooldown(address user) view returns (tuple(address token,uint256 balance,uint256 amountPerClaim,uint256 cooldown,uint256 totalClaimed,uint256 claimCount,bool active,string name,string symbol)[] pools, uint256[] remainings)`,
  `function getUserClaimInfo(uint256 id, address user) view returns (tuple(uint256 lastClaim,uint256 totalClaimed,uint256 claimCount))`,
  'function cooldownRemaining(uint256 id, address user) view returns (uint256)',
  'function owner() view returns (address)',
  'function owner2() view returns (address)',
]

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ClaimPool {
  token:          string
  balance:        bigint
  amountPerClaim: bigint
  cooldown:       bigint
  totalClaimed:   bigint
  claimCount:     bigint
  active:         boolean
  name:           string
  symbol:         string
  cooldownRemaining: bigint  // injected client-side
  index:          number
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
export async function fetchClaimPools(userAddress: string): Promise<ClaimPool[]> {
  const provider = getProvider()
  const contract = new ethers.Contract(ACUA_FREE_CLAIM_ADDRESS, READ_ABI, provider)

  try {
    const [pools, remainings]: [any[], bigint[]] = await contract.getAllPoolsWithCooldown(userAddress)
    return pools.map((p: any, i: number) => ({
      token:             String(p.token),
      balance:           BigInt(p.balance),
      amountPerClaim:    BigInt(p.amountPerClaim),
      cooldown:          BigInt(p.cooldown),
      totalClaimed:      BigInt(p.totalClaimed),
      claimCount:        BigInt(p.claimCount),
      active:            Boolean(p.active),
      name:              String(p.name),
      symbol:            String(p.symbol),
      cooldownRemaining: BigInt(remainings[i] ?? 0n),
      index:             i,
    }))
  } catch {
    return []
  }
}
