---
name: FAB radial menu arrays
description: Two parallel arrays in acua-app.tsx that must stay in sync when adding menu items
---

`components/acua-app.tsx` renders the floating action button radial menu by zipping two arrays by index: `FAB_ITEMS` (icon/label/tab per entry) and `FAB_POSITIONS` (dx/dy offset per entry). They are matched purely by array index, not by key/tab id.

**Why:** Adding a new tab to `FAB_ITEMS` without adding a matching entry to `FAB_POSITIONS` (or vice versa) causes `FAB_POSITIONS[i]` to be `undefined` for the new/shifted items, breaking their rendered position silently (no type error, since positions are read at runtime).

**How to apply:** Whenever adding/removing a stake/mining/swap tab that appears in the FAB, update both arrays together and re-count entries before finishing (e.g. via a quick line-count check) rather than trusting a diff review alone.
