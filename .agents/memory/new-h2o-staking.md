---
name: NewH2OStaking deployment history
description: Contract addresses, fees, and ABI notes for the H2O 2.0 staking contract
---

## Deployed contracts

| Contract | Address | Chain | Notes |
|----------|---------|-------|-------|
| NewH2OStaking (v1, broken) | `0x57A5f1557AFc8FE41203ff5cB6D6423cC607B69e` | World Chain 480 | Old version — NO setFees, fees=0%, DO NOT USE |
| NewH2OStaking (v2, current) | `0x0c9a246F94b51dAAB3D7De8Ea47cAd00963b04a0` | World Chain 480 | ✓ 5%/5%/15%, feeToPoolBps=0, all fees to owner |

## Fees (v2)
- depositFeeBps = 500 (5%)
- withdrawFeeBps = 500 (5%)
- claimFeeBps = 1500 (15%) → sin referido, va 100% al owner
- feeToPoolBps = 0 (0% al pool, 100% al owner)

## Real ABI (v2 = NewH2OStaking.sol source)
- `getStakeInfo(address)` → `(uint256 staked, uint256 pendingReward, uint256 poolBalance, uint256 currentRewardRate)`
- `stake(PermitTransferFrom permit, bytes signature)` — NO referrer param
- `stakeNormal(uint256 amount)` — NO referrer param
- `unstake(uint256 amount)`
- `claimRewards()`
- `fundRewardPool(uint256)` — direct (needs ERC20 approve)
- `fundRewardPoolPermit2(PermitTransferFrom, bytes)` — Permit2 for MiniKit
- `depositRewards(uint256)` — alternative fund
- `setFees(uint256, uint256, uint256)` — owner only
- `setFeeDistribution(uint256)` — owner only (feeToPoolBps)
- `getOwners()` → `address[]`
- `referralContract()` — external referral, currently address(0)

**Why:** Old contract (v1) had none of these functions. Frontend was calling non-existent getGlobalStats/getUserInfo/register.
