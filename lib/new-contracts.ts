import { ethers } from 'ethers'

// ─── RPC / Chain ──────────────────────────────────────────────────────────────
export const WORLD_CHAIN_RPC = 'https://worldchain-mainnet.g.alchemy.com/public'
export const WORLD_CHAIN_ID = 480
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

// ─── Token Addresses ──────────────────────────────────────────────────────────
export const TOKENS = {
  wCOP:  '0x8a1d45e102e886510e891d2ec656a708991e2d76',
  WLD:   '0x2cFc85d8E48F8EAB294be644d9E25C3030863003',
  USDC:  '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
  AIR:   '0xDBA88118551d5Adf16a7AB943403Aea7ea06762b',
  wARS:  '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d',
  SUSHI: '0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38',
  BTCH2O:'0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484',
  FIRE:  '0x22c40632c13a7f3cae9c343480607d886832c686',
  UTH2:  '0x9eA8653640E22A5b69887985BB75d496dc97022a',
  H2O:   '0x17392e5483983945dEB92e0518a8F2C4eB6bA59d',
} as const

// ─── Deployed Contract Addresses ─────────────────────────────────────────────
export const STAKING_CONTRACTS = {
  WLD:    '0x224C31214989F8F22E036c4a8Ae294B9Ce339f74',
  FIRE:   '0xC799a6D13735bAc407183e0d8Acb6F07dfF072DD',
  SUSHI:  '0x31c25e2E5331F02F15fD43340079303EfE02625c',
  USDC:   '0x21075B62a6459D76534938BAD4EE7146a5AF1c1a',
  wCOP:   '0x68E3EcF55DFE392D7A9D8D8aB129A20D52A2bB70',
  wARS:   '0xf3b9162726D2034af1677bAbD1D667c2c4A0A46A',
  BTCH2O: '0x965934aE4b292816a694e7b9cDd41E873AeC32A0',
  AIR:    '0xfc548193a52cCF151cD2BE34D59a14Be119c5cE1',
} as const

export const MINING_UTH2_CONTRACT = '0xbCF03E16F9114396A849053cb1555aAE744522e6'
export const MINING_WLD_CONTRACT  = '0xD2E227D30bC94D6FfD4eCf6b56141429C801E228'

// Swap router V2 — uses Permit2 SignatureTransfer (MiniKit native, same as staking)
export const ACUA_SWAP_ROUTER_V2  = '0xA2FD6cd36a661E270FC7AdaA82D0d22f4660706d'
export const ACUA_VOLUME_REWARDS  = '0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48'

// ─── Token Metadata ───────────────────────────────────────────────────────────
export interface TokenMeta {
  symbol: string
  name: string
  address: string
  stakingContract: string
  color: string
  decimals: number
  logoUrl?: string
}

export const STAKING_TOKENS: TokenMeta[] = [
  { symbol: 'WLD',    name: 'Worldcoin',     address: TOKENS.WLD,    stakingContract: STAKING_CONTRACTS.WLD,    color: '#3b82f6', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg' },
  { symbol: 'FIRE',   name: 'Fire Token',    address: TOKENS.FIRE,   stakingContract: STAKING_CONTRACTS.FIRE,   color: '#f97316', decimals: 18, logoUrl: '/tokens/fire.jpg' },
  { symbol: 'SUSHI',  name: 'SushiSwap',     address: TOKENS.SUSHI,  stakingContract: STAKING_CONTRACTS.SUSHI,  color: '#ec4899', decimals: 18, logoUrl: 'https://assets.coingecko.com/coins/images/12271/small/sushi.png' },
  { symbol: 'USDC',   name: 'USD Coin',      address: TOKENS.USDC,   stakingContract: STAKING_CONTRACTS.USDC,   color: '#2563eb', decimals: 6,  logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
  { symbol: 'wCOP',   name: 'Wrapped COP',   address: TOKENS.wCOP,   stakingContract: STAKING_CONTRACTS.wCOP,   color: '#f59e0b', decimals: 18, logoUrl: '/tokens/wcop.jpg' },
  { symbol: 'wARS',   name: 'Wrapped ARS',   address: TOKENS.wARS,   stakingContract: STAKING_CONTRACTS.wARS,   color: '#10b981', decimals: 18, logoUrl: '/tokens/wars.jpg' },
  { symbol: 'BTCH2O', name: 'BTC H2O',       address: TOKENS.BTCH2O, stakingContract: STAKING_CONTRACTS.BTCH2O, color: '#f59e0b', decimals: 18, logoUrl: '/tokens/btch2o.jpg' },
  { symbol: 'AIR',    name: 'AIR Token',     address: TOKENS.AIR,    stakingContract: STAKING_CONTRACTS.AIR,    color: '#8b5cf6', decimals: 18, logoUrl: '/tokens/air.jpg' },
]

// ─── ABIs ─────────────────────────────────────────────────────────────────────
export const UNIVERSAL_STAKING_ABI = [
  'function getStakeInfo(address user) view returns (uint256 stakedAmount, uint256 stakedAt, uint256 lastClaimAt, uint256 pendingRewards, bool active)',
  'function apyBps() view returns (uint256)',
  'function stakeFeeBps() view returns (uint256)',
  'function unstakeFeeBps() view returns (uint256)',
  'function claimFeeBps() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function rewardRate() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
  'function paused() view returns (bool)',
  'function ownerCount() view returns (uint256)',
  'function getOwners() view returns (address[3])',
  'function TOKEN() view returns (address)',
  'function contractTokenBalance() view returns (uint256)',
  'function earned(address account) view returns (uint256)',
  // Write
  'function stake((tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)',
  'function unstake()',
  'function claimRewards()',
  'function depositRewards(uint256 amount)',
  'function setStakeFee(uint256 bps)',
  'function setUnstakeFee(uint256 bps)',
  'function setClaimFee(uint256 bps)',
  'function addOwner(address addr)',
  'function removeOwner(address addr)',
  'function pause()',
  'function unpause()',
  'function emergencyWithdraw(address token, uint256 amount, address to)',
] as const

export const MINING_UTH2_ABI = [
  'function getAllPackages() view returns (tuple(uint256 priceUTH2, uint256 dailyH2OYield, bool active)[7])',
  'function getUserPackages(address user) view returns (tuple(uint256 units, uint256 lastClaimTime, uint256 pendingRewards)[7])',
  'function pendingRewards(address user) view returns (uint256)',
  'function pendingPerPackage(address user) view returns (uint256[7])',
  'function userDailyYield(address user) view returns (uint256)',
  'function paused() view returns (bool)',
  'function owners(uint256) view returns (address)',
  'function UTH2_TOKEN() view returns (address)',
  'function H2O_TOKEN() view returns (address)',
  // Write
  'function buyPackage(uint256 packageId, uint256 units, (tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)',
  'function claimRewards()',
  'function setPackage(uint256 id, uint256 priceUTH2, uint256 dailyYield, bool active)',
  'function setOwner(uint256 index, address addr)',
  'function pause()',
  'function unpause()',
  'function emergencyWithdraw(address token, uint256 amount, address to)',
] as const

export const MINING_WLD_ABI = [
  'function getAllPackages() view returns (tuple(uint256 priceWLD, uint256 dailyRewardYield, bool active)[7])',
  'function getUserPackages(address user) view returns (tuple(uint256 units, uint256 lastClaimTime, uint256 pendingRewards)[7])',
  'function pendingPerPackage(address user) view returns (uint256[7])',
  'function userDailyYield(address user) view returns (uint256[7])',
  'function getRewardTokens() view returns (address[7])',
  'function paused() view returns (bool)',
  'function owners(uint256) view returns (address)',
  'function WLD_TOKEN() view returns (address)',
  'function rewardTokens(uint256) view returns (address)',
  // Write
  'function buyPackage(uint256 packageId, uint256 units, (tuple(address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, bytes signature)',
  'function claimPackageRewards(uint256 packageId)',
  'function claimAllRewards()',
  'function setPackage(uint256 id, uint256 priceWLD, uint256 dailyYield, bool active)',
  'function setOwner(uint256 index, address addr)',
  'function pause()',
  'function unpause()',
  'function emergencyWithdraw(address token, uint256 amount, address to)',
] as const

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const

// ─── Permit2 ABI input (for MiniKit) ─────────────────────────────────────────
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
        { name: 'token', type: 'address', internalType: 'address' },
        { name: 'amount', type: 'uint256', internalType: 'uint256' },
      ],
    },
    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
  ],
} as const

// ─── Provider ─────────────────────────────────────────────────────────────────
export function getProvider() {
  return new ethers.JsonRpcProvider(WORLD_CHAIN_RPC)
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────
export interface StakingInfo {
  stakedAmount: bigint
  stakedAt: bigint
  lastClaimAt: bigint
  pendingRewards: bigint
  active: boolean
  apyBps: bigint
  stakeFeeBps: bigint
  unstakeFeeBps: bigint
  claimFeeBps: bigint
  totalStaked: bigint
  rewardRate: bigint
  periodFinish: bigint
  paused: boolean
  owners: string[]
  contractBalance: bigint
  tokenBalance: bigint  // user's token balance
}

export async function fetchStakingInfo(contractAddr: string, userAddr: string, tokenAddr: string): Promise<StakingInfo> {
  const provider = getProvider()
  const contract = new ethers.Contract(contractAddr, UNIVERSAL_STAKING_ABI, provider)
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider)

  const [info, apy, stakeFee, unstakeFee, claimFee, total, rate, finish, paused, owners, balance, tokenBal] = await Promise.all([
    contract.getStakeInfo(userAddr),
    contract.apyBps(),
    contract.stakeFeeBps(),
    contract.unstakeFeeBps(),
    contract.claimFeeBps(),
    contract.totalStaked(),
    contract.rewardRate(),
    contract.periodFinish(),
    contract.paused(),
    contract.getOwners(),
    contract.contractTokenBalance(),
    token.balanceOf(userAddr),
  ])

  return {
    stakedAmount: info[0],
    stakedAt: info[1],
    lastClaimAt: info[2],
    pendingRewards: info[3],
    active: info[4],
    apyBps: apy,
    stakeFeeBps: stakeFee,
    unstakeFeeBps: unstakeFee,
    claimFeeBps: claimFee,
    totalStaked: total,
    rewardRate: rate,
    periodFinish: finish,
    paused,
    owners: (owners as string[]).filter(o => o !== ethers.ZeroAddress),
    contractBalance: balance,
    tokenBalance: tokenBal,
  }
}

export interface MiningPackage {
  id: number
  priceUTH2: bigint   // or priceWLD for MiningWLD
  dailyYield: bigint
  active: boolean
}

export interface UserMiningPackage {
  units: bigint
  lastClaimTime: bigint
  pendingRewards: bigint
}

export interface MiningUTH2Info {
  packages: MiningPackage[]
  userPackages: UserMiningPackage[]
  pendingPerPkg: bigint[]
  totalPending: bigint
  dailyYield: bigint
  uth2Balance: bigint
  h2oBalance: bigint
  paused: boolean
  owners: string[]
}

export async function fetchMiningUTH2Info(userAddr: string): Promise<MiningUTH2Info> {
  const provider = getProvider()
  const contract = new ethers.Contract(MINING_UTH2_CONTRACT, MINING_UTH2_ABI, provider)
  const uth2 = new ethers.Contract(TOKENS.UTH2, ERC20_ABI, provider)
  const h2o = new ethers.Contract(TOKENS.H2O, ERC20_ABI, provider)

  const [pkgs, userPkgs, pending, total, daily, uth2Bal, h2oBal, paused, owner0, owner1] = await Promise.all([
    contract.getAllPackages(),
    contract.getUserPackages(userAddr),
    contract.pendingPerPackage(userAddr),
    contract.pendingRewards(userAddr),
    contract.userDailyYield(userAddr),
    uth2.balanceOf(userAddr),
    h2o.balanceOf(userAddr),
    contract.paused(),
    contract.owners(0),
    contract.owners(1),
  ])

  return {
    packages: (pkgs as any[]).map((p, i) => ({
      id: i,
      priceUTH2: p.priceUTH2 ?? p[0],
      dailyYield: p.dailyH2OYield ?? p[1],
      active: p.active ?? p[2],
    })),
    userPackages: (userPkgs as any[]).map(p => ({
      units: p.units ?? p[0],
      lastClaimTime: p.lastClaimTime ?? p[1],
      pendingRewards: p.pendingRewards ?? p[2],
    })),
    pendingPerPkg: [...(pending as bigint[])],
    totalPending: total,
    dailyYield: daily,
    uth2Balance: uth2Bal,
    h2oBalance: h2oBal,
    paused,
    owners: [owner0, owner1].filter(o => o !== ethers.ZeroAddress),
  }
}

export const MINING_WLD_REWARD_NAMES = ['H2O', 'FIRE', 'BTCH2O', 'WLD', 'wARS', 'wCOP', 'UTH2']
export const MINING_WLD_REWARD_ADDRS = [
  TOKENS.H2O, TOKENS.FIRE, TOKENS.BTCH2O, TOKENS.WLD, TOKENS.wARS, TOKENS.wCOP, TOKENS.UTH2
]

export interface MiningWLDInfo {
  packages: { id: number; priceWLD: bigint; dailyYield: bigint; active: boolean; rewardToken: string; rewardSymbol: string }[]
  userPackages: UserMiningPackage[]
  pendingPerPkg: bigint[]
  dailyYields: bigint[]
  wldBalance: bigint
  paused: boolean
  owners: string[]
}

export async function fetchMiningWLDInfo(userAddr: string): Promise<MiningWLDInfo> {
  const provider = getProvider()
  const contract = new ethers.Contract(MINING_WLD_CONTRACT, MINING_WLD_ABI, provider)
  const wld = new ethers.Contract(TOKENS.WLD, ERC20_ABI, provider)

  const [pkgs, userPkgs, pending, daily, paused, owner0, owner1] = await Promise.all([
    contract.getAllPackages(),
    contract.getUserPackages(userAddr),
    contract.pendingPerPackage(userAddr),
    contract.userDailyYield(userAddr),
    contract.paused(),
    contract.owners(0),
    contract.owners(1),
  ])
  const wldBal = await wld.balanceOf(userAddr)

  return {
    packages: (pkgs as any[]).map((p, i) => ({
      id: i,
      priceWLD: p.priceWLD ?? p[0],
      dailyYield: p.dailyRewardYield ?? p[1],
      active: p.active ?? p[2],
      rewardToken: MINING_WLD_REWARD_ADDRS[i],
      rewardSymbol: MINING_WLD_REWARD_NAMES[i],
    })),
    userPackages: (userPkgs as any[]).map(p => ({
      units: p.units ?? p[0],
      lastClaimTime: p.lastClaimTime ?? p[1],
      pendingRewards: p.pendingRewards ?? p[2],
    })),
    pendingPerPkg: [...(pending as bigint[])],
    dailyYields: [...(daily as bigint[])],
    wldBalance: wldBal,
    paused,
    owners: [owner0, owner1].filter(o => o !== ethers.ZeroAddress),
  }
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

export function formatAPY(bps: bigint): string {
  const pct = Number(bps) / 100
  if (pct === 0) return '—'
  return pct.toFixed(1) + '%'
}

export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function randomNonce(): bigint {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}
