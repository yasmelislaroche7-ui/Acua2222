// lib/time.ts
// TIME staking — paga rewards en WLD. Conectado con Permit2 (sin approve previo).

// ───────────────── TOKENS ─────────────────
export const TIME_TOKEN_ADDRESS = '0x212d7448720852D8Ad282a5d4A895B3461F9076E'
export const WLD_TOKEN_ADDRESS  = '0x2cFc85d8E48F8EAB294be644d9E25C3030863003'

// ───────────────── STAKING TIME → REWARDS WLD ─────────────────
export const TIME_STAKING_ADDRESS = '0x631b99CEEfF41eAc3d087B3C57d9fa080557517c'

// ── String ABI para reads vía ethers.Contract ──────────────────────────────
export const TIME_STAKING_ABI = [
  // Reads
  'function stakedBalance(address) view returns (uint256)',
  'function pendingWldReward(address) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function unallocatedWld() view returns (uint256)',
  'function accWldPerShare() view returns (uint256)',
  'function wldToken() view returns (address)',
  'function timeToken() view returns (address)',
  'function rewardRate() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
  // Writes (legacy direct stake — mantiene compat si el contrato la expone)
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
  'function claimWldReward()',
  // Permit2 entry — sin approve, MiniKit firma el permit
  'function stakeWithPermit2(uint256 amount, uint256 nonce, uint256 deadline, bytes signature)',
] as const

// ── Permit2 tuple input (para futuras variantes con tuple) ─────────────────
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

// ── ABI fragments para MiniKit (formato JSON requerido) ────────────────────

// stakeWithPermit2(amount, nonce, deadline, signature) — la variante actual
// usada por mining-time-panel.tsx; el contrato firma en World App vía Permit2.
export const STAKE_WITH_PERMIT2_ABI_FRAG = [{
  name: 'stakeWithPermit2',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256', internalType: 'uint256' },
    { name: 'nonce', type: 'uint256', internalType: 'uint256' },
    { name: 'deadline', type: 'uint256', internalType: 'uint256' },
    { name: 'signature', type: 'bytes', internalType: 'bytes' },
  ],
  outputs: [],
}] as const

export const TIME_UNSTAKE_ABI_FRAG = [{
  name: 'unstake',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
  outputs: [],
}] as const

// IMPORTANTE: el reward de TIME mining es WLD (no TIME).
export const TIME_CLAIM_WLD_ABI_FRAG = [{
  name: 'claimWldReward',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [],
  outputs: [],
}] as const
