---
name: AcuaAutoStake v2 deployment
description: Deployed contract address, ethers v5 quirks, and architecture decisions for AcuaAutoStake v2.
---

## Address
`0x9a3B08D4debB17e494023A23ec21cB53Ab233062` on World Chain (chainId 480).

## Key decisions
- minStake per token stored on-chain, adjustable by any owner via `setMinStake(address,uint256)`.
- H2O initial minStake: 1000 H2O (1000e18 wei).
- Claim fee 10%: 1% → rewardFund, 1% → caller (mining incentive), 8% → owner2.
- Stake/unstake fee 5%: 4% → owner2, 1% → rewardFund.
- Auto-compound: `claimFor(token, user)` re-adds 90% of reward to position.amount.
- Public scoreboard: `getClaimablePositions()` and `getAllPositions()` are view, no auth.

## Ethers v5 deploy quirks (hardhat-ethers uses v5)
- `ethers.utils.parseUnits(...)` not `ethers.parseUnits(...)`
- `ethers.utils.formatEther(...)` not `ethers.formatEther(...)`
- `await contract.deployed()` not `await contract.waitForDeployment()`
- `contract.address` not `await contract.getAddress()`

**Why:** hardhat@nomiclabs packages bundle ethers v5 even if workspace uses v6.

## Deploy script
`contracts-hh/scripts/deploy-autostake.js` — deploys + calls addToken(H2O, 5000, 1000e18).
Run: `echo y | HARDHAT_DISABLE_TELEMETRY_PROMPT=true npx hardhat run scripts/deploy-autostake.js --network worldchain`
