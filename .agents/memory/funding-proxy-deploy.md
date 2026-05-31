---
name: H2OFundingProxy deploy history
description: History of proxy deployments and the root cause of simulation failures.
---

## Final deployed proxy
**Address:** `0xD8B7CDa2c666C967A74cE00ff37Fa15cDa81a214`
- owner2: `0xC2Ef127734F296952DE75c1B58A6Cec605Cc2E59`
- stakeContract: `0x357EE95386a7a07418731F8688BAF62582E4cf51` (H2OStake3)
- token: `0x08131A6f780AEF79E86518c4A10c06387Ec74636` (H2O 2.0)

## Root cause of all "simulation failed" errors
1. **Wrong Permit2 placeholder**: used `'0x'` instead of `'PERMIT2_SIGNATURE_PLACEHOLDER_0'`
2. **fundRewardPoolDirect doesn't exist on-chain**: the deployed H2OStake3 has `fundRewardPool(uint256)` NOT `fundRewardPoolDirect(uint256)`. Calling a non-existent function with no fallback → EVM reverts with empty data (0x), appearing as "simulation failed" with no message.

## How to apply
- When deploying a new proxy, verify the stake contract's actual function name via bytecode scan before hardcoding the interface.
- Any 0x empty revert in a simulation = suspect missing function selector (not access control or state).
