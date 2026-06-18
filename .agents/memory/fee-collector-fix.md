---
name: FeeCollector Permit2 fix
description: The H2OFeeCollector.payFee() always validates Permit2 signature — passing '0x' always reverts even for fee=0
---

## Rule
In `lib/feeCollector.ts`, `buildFeePayment()` must always use `PERMIT2_SIGNATURE_PLACEHOLDER_0` as the signature — NEVER `'0x'`.

## Why
`H2OFeeCollector.payFee(permit, sig)` calls `Permit2.permitTransferFrom(...)` unconditionally.
Permit2 validates the EIP-712 signature regardless of amount. Passing `'0x'` (empty bytes) fails
Permit2 signature validation and always reverts — even when fee = 0.

## How to apply
Any time `buildFeePayment` is modified, ensure it returns `PERMIT2_SIGNATURE_PLACEHOLDER_0` (not `'0x'`) as sig.
The placeholder is a valid-format zero-bytes Permit2 signature that World App replaces with the real sig during transaction signing.
