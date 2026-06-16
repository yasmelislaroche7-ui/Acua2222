---
name: MiniKit v2 migration
description: Breaking changes in MiniKit v2 (May 2026) and the compatibility shim we installed to handle them.
---

## The Breaking Change

MiniKit v2.0.x (published May 2026, last known stable: 2.0.3) made two hard breaking changes:

1. **`MiniKit.commandsAsync.*` removed** — use `await MiniKit.<cmd>()` directly instead.
2. **`permit2: [{nonce, deadline, ...}]` SignatureTransfer array removed** — must use AllowanceTransfer.

We are on **minikit-js v1.11.0** (last v1 stable). World App client updated to v2 protocol, so users with updated World App get errors even though our SDK is v1.

## The Compatibility Shim

`installMiniKitCompat()` in `components/acua-app.tsx` (replaces old `patchMiniKitLogger`):
- Creates `MiniKit.commandsAsync.sendTransaction` if missing (v2 env) by wrapping `MiniKit.sendTransaction`
- Normalizes response format: v2 returns payload directly; shim wraps in `{ finalPayload: ... }`
- Called in `useEffect` on mount — runs before any user tx

**Why:** All ~30 components use `MiniKit.commandsAsync.sendTransaction(...)`. Patching the prototype once in the main shell fixes everything without touching each component.

## What the Shim Fixes vs. What Still Needs Contracts

### Fixed by shim (no Permit2 needed):
- `claim(poolId)` — H2O v3 pool claim
- `withdraw(poolId, liq, 0, 0)` — H2O v3 withdraw
- `claimRewards()` / `unstake()` — old H2O v1 stake
- Mining panel txs that don't use Permit2
- Any simple contract call

### Still broken in World App v2 (needs contract migration):
- `deposit(poolId, permit0, sig0, permit1, sig1, 0, 0)` — H2O v3 deposit (uses `permitTransferFrom`)
- `stake(PermitTransferFrom, sig)` — H2O v2 staking
- Any function that passes `permit2: [{...}]` SignatureTransfer array

**Root cause:** The contracts call `permit2.permitTransferFrom()` (SignatureTransfer). World App v2 only signs AllowanceTransfer-style Permit2. Fix requires deploying new contract versions that call `permit2.transferFrom()` (AllowanceTransfer) or standard `token.transferFrom()` after an ERC-20 approve.

## V1 Old H2O Stake Errors (Separate Issue)

`doOldUnstake()` / `doOldClaim()` in stake-panel.tsx are plain transactions with NO Permit2. If these fail:
- `disallowed_operation` → old staking contract (`H2O_STAKING_ADDRESS`) not in developer portal
- `simulation_failed` → the V1 staking contract's H2O reward pool is empty

## AllowanceTransfer Migration Pattern (for future contract update)

```solidity
// Contract side: use AllowanceTransfer transferFrom
IPermit2(PERMIT2).transferFrom(from, address(this), uint160(amount), token);
// instead of:
// permit2.permitTransferFrom(permit, details, owner, sig);
```

```typescript
// Frontend side: bundle Permit2.approve + contract call
MiniKit.sendTransaction({
  transaction: [
    { address: PERMIT2, abi: PERMIT2_APPROVE_ABI, functionName: 'approve', args: [token, spender, amount, 0] },
    { address: CONTRACT, abi: ..., functionName: 'deposit', args: [...] }
  ]
  // NO permit2 array
})
```

## TX Error Codes Added in v2

- `permitted_amount_exceeds_slippage` — Permit2 amount mismatch
- `insufficient_allowance` — AllowanceTransfer allowance too low

Both added to `TX_ERROR_MESSAGES` in `h2o-v3-panel.tsx`.
