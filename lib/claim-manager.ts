// lib/claim-manager.ts
// Helper para el AcuaClaimManager: registro extensible de claims externos.
// Cobra una comisión por claim (default 30%) en el reward token vía Permit2,
// pagada DIRECTO al owner. El contrato no guarda fondos.
//
// Flujo MiniKit (una sola firma del usuario):
//   transaction[0] = claimContract.claimRewards()        -> usuario recibe rewards
//   transaction[1] = manager.collectFee(id, permit, sig) -> manager hala fee→owner
//   permit2[0]     = permit del reward token con manager como spender

import { ethers } from 'ethers'
import { getProvider } from '@/lib/new-contracts'

// ─── Direcciones (World Chain mainnet) ──────────────────────────────────────
export const ACUA_CLAIM_MANAGER = '0x3BbA82736226104B53A58C02C759A9438ab8A42C'

// ─── IDs registrados ────────────────────────────────────────────────────────
export const CLAIM_ID_WDD = 0

// Contrato externo Thirdweb TokenStake (WDD)
export const WDD_CLAIM_CONTRACT = '0x52DFEe61180A0BCEBe007E5a9Cfd466948aCCA46'
export const WDD_REWARD_TOKEN   = '0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B'

// ─── ABIs lectura ───────────────────────────────────────────────────────────
const MANAGER_READ_ABI = [
  'function owner() view returns (address)',
  'function claimCount() view returns (uint256)',
  'function claims(uint256) view returns (address claimContract, address rewardToken, uint16 feeBps, bool active, string name)',
  'function previewFee(uint256 claimId, address user) view returns (uint256 fee, uint256 pending)',
]

// Thirdweb TokenStake (subset)
const STAKE_READ_ABI = [
  'function getStakeInfo(address) view returns (uint256 staked, uint256 rewards)',
  'function getRewardRatio() view returns (uint256 num, uint256 den)',
  'function getTimeUnit() view returns (uint256)',
  'function stakers(address) view returns (uint128 timeOfLastUpdate, uint64 conditionIdOflastUpdate, uint256 amountStaked, uint256 unclaimedRewards)',
]

// ─── ABIs MiniKit (sendTransaction) ─────────────────────────────────────────
// claimRewards() del Thirdweb TokenStake — sin args, no payable.
export const CLAIM_REWARDS_ABI_FRAG = [{
  name: 'claimRewards',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [],
  outputs: [],
}] as const

// collectFee(uint256, PermitTransferFrom, bytes) del manager
const PERMIT_TUPLE_INPUT = {
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

export const COLLECT_FEE_ABI_FRAG = [{
  name: 'collectFee',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'claimId', type: 'uint256', internalType: 'uint256' },
    PERMIT_TUPLE_INPUT,
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

// ─── Tipos ──────────────────────────────────────────────────────────────────
export interface ClaimInfo {
  staked: bigint
  pending: bigint        // rewards on-chain (puede estar desactualizado)
  unclaimed: bigint      // unclaimedRewards (parte fija ya redondeada)
  amountStaked: bigint   // amount that accrues per second
  timeOfLastUpdate: bigint
  rewardNum: bigint
  rewardDen: bigint
  timeUnit: bigint       // segundos
  feeBps: number
  active: boolean
}

// ─── Lectura on-chain ───────────────────────────────────────────────────────
export async function fetchWDDClaimInfo(userAddress: string): Promise<ClaimInfo> {
  const p = getProvider()
  const stake   = new ethers.Contract(WDD_CLAIM_CONTRACT, STAKE_READ_ABI, p)
  const manager = new ethers.Contract(ACUA_CLAIM_MANAGER,  MANAGER_READ_ABI, p)

  const [si, ratio, tu, st, claimCfg] = await Promise.all([
    stake.getStakeInfo(userAddress).catch(() => [0n, 0n] as any),
    stake.getRewardRatio().catch(() => [19n, 34_560_000n] as any),
    stake.getTimeUnit().catch(() => 1n),
    stake.stakers(userAddress).catch(() => null),
    manager.claims(CLAIM_ID_WDD).catch(() => null),
  ])

  const staked = BigInt(si[0].toString())
  const pending = BigInt(si[1].toString())
  const unclaimed = st ? BigInt(st.unclaimedRewards.toString()) : pending
  const amountStaked = st ? BigInt(st.amountStaked.toString()) : staked
  const timeOfLastUpdate = st ? BigInt(st.timeOfLastUpdate.toString()) : BigInt(Math.floor(Date.now()/1000))

  return {
    staked,
    pending,
    unclaimed,
    amountStaked,
    timeOfLastUpdate,
    rewardNum: BigInt(ratio[0].toString()),
    rewardDen: BigInt(ratio[1].toString()),
    timeUnit:  BigInt(tu.toString()),
    feeBps: claimCfg ? Number(claimCfg.feeBps) : 3000,
    active: claimCfg ? Boolean(claimCfg.active) : true,
  }
}

/**
 * Estima los rewards pendientes en el momento `nowSec`, replicando la fórmula
 * Thirdweb on-chain: unclaimed + amountStaked * (now - lastUpdate) * num / (den * timeUnit)
 * Permite mostrar el contador acumulando por segundo sin hacer RPC en cada tick.
 */
export function projectedRewards(info: ClaimInfo, nowSec: bigint): bigint {
  if (info.amountStaked === 0n || info.rewardDen === 0n) return info.unclaimed
  let elapsed = nowSec > info.timeOfLastUpdate ? nowSec - info.timeOfLastUpdate : 0n
  const tu = info.timeUnit > 0n ? info.timeUnit : 1n
  // accruedSeconds = elapsed (porque timeUnit en este contrato es 1s; si fuese mayor se redondea por floor)
  // formula matching Thirdweb StakingBase: amountStaked * elapsed * num / (den * timeUnit)
  const accrued = (info.amountStaked * elapsed * info.rewardNum) / (info.rewardDen * tu)
  return info.unclaimed + accrued
}

// ─── Helpers para el batch del frontend ─────────────────────────────────────
export function nonceRandom(): bigint {
  if (typeof window !== 'undefined' && window.crypto) {
    const a = new Uint32Array(2); window.crypto.getRandomValues(a)
    return BigInt(a[0]) * 65536n + BigInt(a[1] & 0xffff)
  }
  return BigInt(Math.floor(Math.random() * 2 ** 32))
}

/**
 * Construye el batch (transaction + permit2) para reclamar WDD cobrando 30% al owner.
 * @param feeAmount  monto en wei del reward token a transferir al owner.
 * @returns          objeto listo para pasar a MiniKit.commandsAsync.sendTransaction.
 */
export function buildWDDClaimBatch(feeAmount: bigint, deadline?: bigint) {
  const nonce = nonceRandom()
  const dl = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600)

  const permitArg = {
    permitted: { token: WDD_REWARD_TOKEN, amount: feeAmount.toString() },
    nonce: nonce.toString(),
    deadline: dl.toString(),
  }

  const tx0 = {
    address: WDD_CLAIM_CONTRACT,
    abi: CLAIM_REWARDS_ABI_FRAG,
    functionName: 'claimRewards' as const,
    args: [],
  }
  const tx1 = {
    address: ACUA_CLAIM_MANAGER,
    abi: COLLECT_FEE_ABI_FRAG,
    functionName: 'collectFee' as const,
    args: [
      CLAIM_ID_WDD.toString(),
      permitArg,
      'PERMIT2_SIGNATURE_PLACEHOLDER_0',
    ],
  }
  const permit2Entry = {
    permitted: { token: WDD_REWARD_TOKEN, amount: feeAmount.toString() },
    spender:   ACUA_CLAIM_MANAGER,
    nonce:     nonce.toString(),
    deadline:  dl.toString(),
  }

  return { transaction: [tx0, tx1], permit2: [permit2Entry] }
}

// ─── Formato compacto WDD (pocos ceros) ─────────────────────────────────────
export function fmtWDD(amount: bigint): string {
  if (amount === 0n) return '0.00000'
  const n = parseFloat(ethers.formatEther(amount))
  if (!isFinite(n) || isNaN(n)) return '0.00000'
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1)    return n.toFixed(4)
  if (n >= 0.01) return n.toFixed(5)
  if (n >= 0.0001) return n.toFixed(6)
  if (n >= 0.0000001) return n.toFixed(8)
  return '<0.00000001'
}
