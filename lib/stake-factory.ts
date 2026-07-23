/**
 * lib/stake-factory.ts
 * AcuaStakeFactory — cualquier usuario crea su propio pool de staking para
 * cualquier token ERC20 (cualquier decimales) en World Chain.
 * Cuota de creación: 2 USDC. Comisión 5% en depósito/retiro/reclamo,
 * repartida 4% owners del pool (parejo) + 1% dueño de ACUA.
 */
import { ethers } from 'ethers'

// ─── Address (se actualiza después del deploy) ────────────────────────────────
let _deployedInfo: { contract: string; creationFeeToken?: string; creationFeeAmount?: string } | null = null
try {
  _deployedInfo = require('@/contracts-hh/deployed-stake-factory.json')
} catch {
  _deployedInfo = null
}

export const STAKE_FACTORY_ADDRESS: string = _deployedInfo?.contract ?? ''
export const ACUA_OWNER_ADDRESS = '0xC2Ef127734F296952DE75c1B58A6Cec605Cc2E59'
export const USDC_ADDRESS = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'
export const WORLD_CHAIN_RPC_FACTORY = 'https://worldchain-mainnet.g.alchemy.com/public'

// ─── Tokens ocultos en la UI (pools con estos tokens no se muestran) ──────────
const BLACKLISTED_TOKENS = new Set([
  '0xD404c180dD30d14EcE09c6Fb501bFd33156FDd91'.toLowerCase(), // KING of Acua
  '0x9a5F38a31d539a6020e3CF275230BCD2689161f5'.toLowerCase(), // BTC Bitcoin Acua
])

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

// createPool(token, name, symbol, logoUrl, initialAprBps, feePermit, feeSig)
export const CREATE_POOL_ABI_FRAG = [{
  name: 'createPool', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',         type: 'address', internalType: 'address' },
    { name: 'name_',         type: 'string',  internalType: 'string' },
    { name: 'symbol_',       type: 'string',  internalType: 'string' },
    { name: 'logoUrl',       type: 'string',  internalType: 'string' },
    { name: 'initialAprBps', type: 'uint256', internalType: 'uint256' },
    { ...PERMIT_TUPLE, name: 'feePermit' },
    { name: 'feeSig', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [{ name: 'poolId', type: 'uint256' }],
}] as const

// createPoolNormal(token, name, symbol, logoUrl, initialAprBps)
export const CREATE_POOL_NORMAL_ABI_FRAG = [{
  name: 'createPoolNormal', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'token',         type: 'address', internalType: 'address' },
    { name: 'name_',         type: 'string',  internalType: 'string' },
    { name: 'symbol_',       type: 'string',  internalType: 'string' },
    { name: 'logoUrl',       type: 'string',  internalType: 'string' },
    { name: 'initialAprBps', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [{ name: 'poolId', type: 'uint256' }],
}] as const

// deposit(poolId, permit, sig, grossAmount)
export const DEPOSIT_ABI_FRAG = [{
  name: 'deposit', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE,
    { name: 'sig',         type: 'bytes',   internalType: 'bytes' },
    { name: 'grossAmount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

// depositNormal(poolId, grossAmount)
export const DEPOSIT_NORMAL_ABI_FRAG = [{
  name: 'depositNormal', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId',      type: 'uint256', internalType: 'uint256' },
    { name: 'grossAmount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

// withdraw(poolId, amount)
export const WITHDRAW_ABI_FRAG = [{
  name: 'withdraw', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId', type: 'uint256', internalType: 'uint256' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

// claimRewards(poolId)
export const CLAIM_ABI_FRAG = [{
  name: 'claimRewards', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'poolId', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// fund(poolId, permit, sig, amount)
export const FUND_ABI_FRAG = [{
  name: 'fund', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE,
    { name: 'sig',    type: 'bytes',   internalType: 'bytes' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

// fundDirect(poolId, amount)
export const FUND_DIRECT_ABI_FRAG = [{
  name: 'fundDirect', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId', type: 'uint256', internalType: 'uint256' },
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

// addOwner(poolId, newOwner)
export const ADD_OWNER_ABI_FRAG = [{
  name: 'addOwner', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId',   type: 'uint256', internalType: 'uint256' },
    { name: 'newOwner', type: 'address', internalType: 'address' },
  ],
  outputs: [],
}] as const

// removeOwner(poolId, ownerToRemove)
export const REMOVE_OWNER_ABI_FRAG = [{
  name: 'removeOwner', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId',        type: 'uint256', internalType: 'uint256' },
    { name: 'ownerToRemove', type: 'address', internalType: 'address' },
  ],
  outputs: [],
}] as const

// setApr(poolId, newAprBps)
export const SET_APR_ABI_FRAG = [{
  name: 'setApr', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId',    type: 'uint256', internalType: 'uint256' },
    { name: 'newAprBps', type: 'uint256', internalType: 'uint256' },
  ],
  outputs: [],
}] as const

// setPaused(poolId, val)
export const SET_PAUSED_ABI_FRAG = [{
  name: 'setPaused', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'poolId', type: 'uint256', internalType: 'uint256' },
    { name: 'val',    type: 'bool',    internalType: 'bool' },
  ],
  outputs: [],
}] as const

// ─── Read ABI ─────────────────────────────────────────────────────────────────
const READ_ABI = [
  'function poolCount() view returns (uint256)',
  'function factoryOwner() view returns (address)',
  'function creationFeeToken() view returns (address)',
  'function creationFeeAmount() view returns (uint256)',
  'function isPoolOwner(uint256, address) view returns (bool)',
  `function getPoolInfo(uint256 poolId) view returns (
    address token,
    uint8 tokenDecimals,
    string name_,
    string symbol_,
    string logoUrl,
    address creator,
    uint256 aprBps,
    uint256 totalStaked,
    uint256 fundPool,
    uint256 totalDeposited,
    uint256 totalWithdrawn,
    uint256 totalClaimed,
    uint256 totalFeesPaid,
    uint256 totalUsers,
    bool paused,
    uint256 createdAt
  )`,
  `function getUserStakeInfo(uint256 poolId, address user) view returns (
    uint256 staked,
    uint256 rewards,
    uint256 totalDep,
    uint256 totalWith,
    uint256 totalClaim
  )`,
  'function pendingRewards(uint256 poolId, address user) view returns (uint256)',
  'function getAllPoolIds() view returns (uint256[])',
  'function getPoolOwners(uint256 poolId) view returns (address[])',
  'function getStakers(uint256 poolId) view returns (address[])',
] as const

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const

// ─── Types ────────────────────────────────────────────────────────────────────
export interface StakeFactoryPoolInfo {
  poolId:          number
  token:           string
  tokenDecimals:   number
  name:            string
  symbol:          string
  logoUrl:         string
  creator:         string
  aprBps:          bigint
  totalStaked:     bigint
  fundPool:        bigint
  totalDeposited:  bigint
  totalWithdrawn:  bigint
  totalClaimed:    bigint
  totalFeesPaid:   bigint
  totalUsers:      bigint
  paused:          boolean
  createdAt:       bigint
}

export interface StakeFactoryUserInfo {
  staked:     bigint
  rewards:    bigint
  totalDep:   bigint
  totalWith:  bigint
  totalClaim: bigint
}

export interface StakeFactoryConfig {
  poolCount:         bigint
  factoryOwner:      string
  creationFeeToken:  string
  creationFeeAmount: bigint
}

// ─── Provider singleton ───────────────────────────────────────────────────────
let _provider: ethers.JsonRpcProvider | null = null
export function getStakeFactoryProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(WORLD_CHAIN_RPC_FACTORY, 480, {
      staticNetwork: ethers.Network.from(480),
      batchMaxCount: 10,
    })
  }
  return _provider
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────
export async function fetchStakeFactoryConfig(): Promise<StakeFactoryConfig> {
  if (!STAKE_FACTORY_ADDRESS) throw new Error('AcuaStakeFactory not deployed yet')
  const provider = getStakeFactoryProvider()
  const contract = new ethers.Contract(STAKE_FACTORY_ADDRESS, READ_ABI, provider)
  const [poolCount, factoryOwner, creationFeeToken, creationFeeAmount] = await Promise.all([
    contract.poolCount(),
    contract.factoryOwner(),
    contract.creationFeeToken(),
    contract.creationFeeAmount(),
  ])
  return {
    poolCount:         BigInt(poolCount),
    factoryOwner:      String(factoryOwner),
    creationFeeToken:  String(creationFeeToken),
    creationFeeAmount: BigInt(creationFeeAmount),
  }
}

export async function fetchAllPools(): Promise<StakeFactoryPoolInfo[]> {
  if (!STAKE_FACTORY_ADDRESS) return []
  const provider = getStakeFactoryProvider()
  const contract = new ethers.Contract(STAKE_FACTORY_ADDRESS, READ_ABI, provider)
  const ids: bigint[] = await contract.getAllPoolIds()
  const infos = await Promise.all(ids.map((id) => contract.getPoolInfo(id)))
  return infos
    .map((p: any, i: number) => ({
      poolId:         Number(ids[i]),
      token:          String(p[0]),
      tokenDecimals:  Number(p[1]),
      name:           String(p[2]),
      symbol:         String(p[3]),
      logoUrl:        String(p[4]),
      creator:        String(p[5]),
      aprBps:         BigInt(p[6]),
      totalStaked:    BigInt(p[7]),
      fundPool:       BigInt(p[8]),
      totalDeposited: BigInt(p[9]),
      totalWithdrawn: BigInt(p[10]),
      totalClaimed:   BigInt(p[11]),
      totalFeesPaid:  BigInt(p[12]),
      totalUsers:     BigInt(p[13]),
      paused:         Boolean(p[14]),
      createdAt:      BigInt(p[15]),
    }))
    .filter(pool => !BLACKLISTED_TOKENS.has(pool.token.toLowerCase()))
}

export async function fetchPoolInfo(poolId: number): Promise<StakeFactoryPoolInfo> {
  if (!STAKE_FACTORY_ADDRESS) throw new Error('AcuaStakeFactory not deployed yet')
  const provider = getStakeFactoryProvider()
  const contract = new ethers.Contract(STAKE_FACTORY_ADDRESS, READ_ABI, provider)
  const p = await contract.getPoolInfo(poolId)
  return {
    poolId,
    token:          String(p[0]),
    tokenDecimals:  Number(p[1]),
    name:           String(p[2]),
    symbol:         String(p[3]),
    logoUrl:        String(p[4]),
    creator:        String(p[5]),
    aprBps:         BigInt(p[6]),
    totalStaked:    BigInt(p[7]),
    fundPool:       BigInt(p[8]),
    totalDeposited: BigInt(p[9]),
    totalWithdrawn: BigInt(p[10]),
    totalClaimed:   BigInt(p[11]),
    totalFeesPaid:  BigInt(p[12]),
    totalUsers:     BigInt(p[13]),
    paused:         Boolean(p[14]),
    createdAt:      BigInt(p[15]),
  }
}

export async function fetchUserStakeInfo(poolId: number, userAddress: string): Promise<StakeFactoryUserInfo> {
  if (!STAKE_FACTORY_ADDRESS) throw new Error('AcuaStakeFactory not deployed yet')
  const provider = getStakeFactoryProvider()
  const contract = new ethers.Contract(STAKE_FACTORY_ADDRESS, READ_ABI, provider)
  const info = await contract.getUserStakeInfo(poolId, userAddress)
  return {
    staked:     BigInt(info[0]),
    rewards:    BigInt(info[1]),
    totalDep:   BigInt(info[2]),
    totalWith:  BigInt(info[3]),
    totalClaim: BigInt(info[4]),
  }
}

export async function fetchPoolOwners(poolId: number): Promise<string[]> {
  if (!STAKE_FACTORY_ADDRESS) return []
  const provider = getStakeFactoryProvider()
  const contract = new ethers.Contract(STAKE_FACTORY_ADDRESS, READ_ABI, provider)
  return (await contract.getPoolOwners(poolId)).map((a: string) => String(a))
}

export async function fetchIsPoolOwner(poolId: number, addr: string): Promise<boolean> {
  if (!STAKE_FACTORY_ADDRESS || !addr) return false
  const provider = getStakeFactoryProvider()
  const contract = new ethers.Contract(STAKE_FACTORY_ADDRESS, READ_ABI, provider)
  return Boolean(await contract.isPoolOwner(poolId, addr))
}

export async function fetchErc20Meta(tokenAddress: string): Promise<{ decimals: number; symbol: string; name: string }> {
  const provider = getStakeFactoryProvider()
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  const [decimals, symbol, name] = await Promise.all([
    token.decimals().catch(() => 18),
    token.symbol().catch(() => '???'),
    token.name().catch(() => 'Token'),
  ])
  return { decimals: Number(decimals), symbol: String(symbol), name: String(name) }
}

export async function fetchErc20Balance(tokenAddress: string, userAddress: string): Promise<bigint> {
  if (!tokenAddress || !userAddress) return 0n
  const provider = getStakeFactoryProvider()
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  return BigInt(await token.balanceOf(userAddress))
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

export function formatFee(bps: bigint | number): string {
  const pct = Number(bps) / 100
  return pct.toFixed(1) + '%'
}

export function randomNonce(): bigint {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}

export const MAX_APR_BPS = 100_000
export const DEPOSIT_FEE_BPS = 500
export const WITHDRAW_FEE_BPS = 500
export const CLAIM_FEE_BPS = 500
export const CREATOR_SHARE_BPS = 400
export const ACUA_SHARE_BPS = 100
