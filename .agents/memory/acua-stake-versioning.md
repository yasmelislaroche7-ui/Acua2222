---
name: Stake contract versioning pattern
description: How ACUA MINIEXCHANGE runs multiple stake contract versions side by side with different fee/lock rules
---

When a live stake contract needs new economics that can't be changed in place (e.g. adding deposit/withdraw fees), the project deploys a new versioned contract rather than upgrading the old one, and keeps both connected in the UI:

- New version gets its own Solidity file, its own `lib/stake-vN.ts` (ABI fragments + fetchers/types), its own `components/stake-vN-panel.tsx`, and its own deployed-address JSON in `contracts-hh/`.
- The legacy version is restricted to withdraw+claim only (deposit UI removed, replaced with a migration notice pointing users to the new version) rather than deleted, so existing stakers can exit. This mirrors the pattern already used for SUSHI's withdraw-only migration mode.
- Both panels are wired into `components/acua-app.tsx` as separate tabs (Tab type, MENU array, TAB_LABELS, FAB_ITEMS/FAB_POSITIONS, and a render line gated on `activeTab === 'stake-vN'`).
- Old contract's locked reward fund is checked for an `emergencyWithdraw`/owner-pull escape hatch before assuming an "owner-only stake" fallback is needed — check this before adding extra restrictions.

**Why:** Preserves non-custodial guarantees (no forced migration of user funds) and avoids risky proxy-upgrade patterns on already-deployed, unaudited contracts holding real funds.

**How to apply:** Whenever asked to change fee/APR/lock economics of a deployed ACUA stake contract, prefer deploying vNext + restricting vCurrent to exit-only, over mutating vCurrent's live logic.
