---
name: H2OStake2 deployment & patterns
description: H2O 2.0 staking contract on World Chain — addresses, fee mechanics, and MiniKit Permit2 patterns used in new-h2o-panel.tsx
---

## Contract
- **Address**: `0x7f78b1B2c881E90D49C780461a88cb6CAC875afc` (World Chain, chainId 480)
- **Token (H2O 2.0)**: `0x08131A6f780AEF79E86518c4A10c06387Ec74636`
- **Deployed by**: `0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4`
- **Owner2**: `0xc2ef127734f296952de75c1b58a6cec605cc2e59`
- **Deploy script**: `contracts-hh/scripts/deploy-h2o-stake2.js`
- **Deploy output**: `contracts-hh/deployed-h2o-stake2.json`

## Mechanics
- APR-based (not Synthetix pool) — default 1200 bps (12%), configurable up to 100000 bps
- Token 1:1 — 0% deposit fee, 0% withdrawal fee
- 48h withdraw queue (FIFO, auto-processed)
- Claim fee when user has referrer: 15% total
  - 5% to referrer (inviter)
  - 5% returned to user as bonus (user nets 90% of gross)
  - 5% to owner2
- No claim fee if user has no referrer (100% to user)
- Anyone can fund via `fundDirect(amount)` (ERC20 approve) or `fund(permit, sig, amount)` (Permit2, owner only)

## Frontend: new-h2o-panel.tsx
- 3 tabs: Stake (deposit/withdraw/claim), Referidos, Stats
- URL param `?ref=0x...` auto-fills referrer on first stake
- Manual referrer registration via `register(address)` tx
- Props: `{ userAddress, walletMode, importedSigner }`

## MiniKit Permit2 pattern for stake(permit, sig, amount, referrer)
```ts
const nonce = randomNonce()  // from lib/new-contracts.ts
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
await MiniKit.commandsAsync.sendTransaction({
  transaction: [{
    address: CONTRACT,
    abi: STAKE_ABI,
    functionName: 'stake',
    args: [
      { permitted: { token: TOKEN, amount: gross.toString() }, nonce: nonce.toString(), deadline: deadline.toString() },
      'PERMIT2_SIGNATURE_PLACEHOLDER_0',
      gross.toString(),
      referrerAddress,
    ],
  }],
  permit2: [{
    permitted: { token: TOKEN, amount: gross.toString() },
    spender: CONTRACT,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  }],
})
```

**Why:** The permit struct and 'PERMIT2_SIGNATURE_PLACEHOLDER_0' must be explicit in args[] at the same positions as the Solidity function signature. MiniKit replaces the placeholder with the real signature before sending.
