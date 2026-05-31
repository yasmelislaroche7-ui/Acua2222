---
name: H2OSwapV1 function map
description: Real on-chain function selectors for 0x3a174c852B922C4182Bb5F754E63651b7065A400 vs what the frontend was calling.
---

## Contract: 0x3a174c852B922C4182Bb5F754E63651b7065A400

### Functions that EXIST in bytecode
- `buyH2OWithPermit2(address,uint256,((address,uint256),uint256,uint256),bytes)` — 0x3da8f648
- `sellH2OWithPermit2(address,uint256,((address,uint256),uint256,uint256),bytes)` — 0x37462e8c
- `fundWithPermit2(address,uint256,((address,uint256),uint256,uint256),bytes)` — 0x5afdef8f
- `setFee(address,uint256)` — 0xe55156b5
- `setPairPaused(address,bool)` — 0x446983da
- `setGlobalPause(bool)` — 0x69a6b3db
- `addPair(address,uint256,uint256,string)` — 0xde7407e1
- `removePair(address)` — 0xaf6c9c1d
- `withdraw(address,uint256,address)` — 0x69328dec
- `globalPause()` (NOT `globalPaused()`)

### Functions that DO NOT exist
- `setPrice(address,uint256)` — ABSENT; use removePair+addPair batch to update price
- `addPair` fails with "pair already exists" if pair is already active

### Permit2 tuple format
The nested tuple `((address,uint256),uint256,uint256)` maps to PERMIT2_TUPLE with `permitted:{token,amount},nonce,deadline`. The PERMIT2_TUPLE in lib/tnt-contracts.ts was already correctly structured.

### H2O2 pair state at discovery
- price: 1 wei (needs reset), feeBps: 0, paused: true
- Fix: admin calls setPairPaused(H2O2, false) then removePair+addPair with correct price

**Why:** The deployed contract was compiled from a different version than local H2OSwapV1.sol. The function names match but some admin helpers (setPrice) were removed.
