// lib/time.ts

// ───────────────── TOKEN TIME ─────────────────
export const TIME_TOKEN_ADDRESS = "0x212d7448720852D8Ad282a5d4A895B3461F9076E"; // <- tu token existente

export const TIME_TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

// ───────────────── NUEVO STAKING TIME (WLD REWARDS) ─────────────────
export const TIME_STAKING_ADDRESS = "0x631b99CEEfF41eAc3d087B3C57d9fa080557517c";

export const TIME_STAKING_ABI = [
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claimWldReward()",
  "function pendingWldReward(address) view returns(uint256)",
  "function stakedBalance(address) view returns(uint256)",
  "function totalStaked() view returns(uint256)",
  "function accWldPerShare() view returns(uint256)",
  "function wldToken() view returns(address)",
  "function timeToken() view returns(address)"
];