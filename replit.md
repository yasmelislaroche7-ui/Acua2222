# Acua Staking — World Chain Mini App

## Overview
Acua Staking is a decentralized application (dApp) for the **World Chain** ecosystem. It runs as a Mini App inside **World App** and uses **MiniKit + Permit2** for gasless-feeling transactions. Users can stake tokens, mine tokens, and earn rewards across multiple contracts.

## Architecture

### Frontend Stack
- **Next.js 16** (App Router) with TypeScript
- **Tailwind CSS v4** + Radix UI (Shadcn UI components)
- **ethers.js v6** for blockchain reads
- **@worldcoin/minikit-js** for wallet auth + transactions

### Blockchain
- **Network**: World Chain (Chain ID 480)
- **RPC**: `https://worldchain-mainnet.g.alchemy.com/public`
- **Pattern**: All writes go through MiniKit `sendTransaction` + Permit2

---

## App Structure

### Main Navigation (all users see full public tabs)
| Tab | Label | Component |
|-----|-------|-----------|
| H2O | Stake H2O | `stake-panel.tsx` — H2O staking, swap, 12% APY |
| Stake+ | Multi-Stake | `multi-staking-panel.tsx` — 8 new tokens |
| UTH₂ | Minería UTH₂ | `mining-uth2-panel.tsx` — pay UTH2, mine H2O permanently |
| WLD | Minería WLD | `mining-wld-panel.tsx` — pay WLD, mine 7 tokens |
| TIME | Minería TIME | `mining-time-panel.tsx` |
| Tokens | Directorio | `token-directory-panel.tsx` |
| Swap | DEX Swap | `swap-panel.tsx` — Uniswap V3 + SushiSwap V2 |
| Admin | Panel Admin | Only for owners & AIR funder |
| Info | Guía | `info-panel.tsx` — token utilities + how-to |

### Conditional Tabs (owner-only)
| Tab | Condition | Component |
|-----|-----------|-----------|
| Admin | isMainOwner | `contracts-owner-panel.tsx` + `owner-panel.tsx` |
| AIR | isAirFunder | `air-funder-panel.tsx` — deposit AIR rewards only |

---

## Ownership Logic

### isMainOwner
User is an owner of ANY new staking contract (WLD, FIRE, SUSHI, USDC, wCOP, wARS, BTCH2O, AIR) OR the H2O Acua staking contract owner — **AND** is NOT the AIR secondary funder.  
→ Sees: **Admin** tab (ContractsOwnerPanel + OwnerPanel for H2O)

### isAirFunder
User is `owners[1]` (index 1, second owner) of the AIR staking contract.  
→ Sees: **AIR** tab only. Does NOT see Admin tab.  
→ Can only: view AIR contract balance + deposit rewards (approve + depositRewards in one batch)

---

## Contracts

### H2O Acua Staking (legacy)
- Address: `0xabbD2D0360bA25FBb82a6f7574a150F1AEAc2e04`
- Token: H2O `0x17392e5483983945dEB92e0518a8F2C4eB6bA59d`
- Owner: single address via `owner()`

### New Universal Staking Contracts
- WLD: `0x224C31214989F8F22E036c4a8Ae294B9Ce339f74`
- FIRE: `0xC799a6D13735bAc407183e0d8Acb6F07dfF072DD`
- SUSHI: `0x31c25e2E5331F02F15fD43340079303EfE02625c`
- USDC: `0x21075B62a6459D76534938BAD4EE7146a5AF1c1a`
- wCOP: `0x68E3EcF55DFE392D7A9D8D8aB129A20D52A2bB70`
- wARS: `0xf3b9162726D2034af1677bAbD1D667c2c4A0A46A`
- BTCH2O: `0x965934aE4b292816a694e7b9cDd41E873AeC32A0`
- AIR: `0xfc548193a52cCF151cD2BE34D59a14Be119c5cE1`
- All have: `getOwners() → address[3]`, addOwner/removeOwner, pause/unpause, depositRewards, emergencyWithdraw

### Mining Contracts
- MiningUTH2: `0xbCF03E16F9114396A849053cb1555aAE744522e6` — pay UTH2, earn H2O
- MiningWLD: `0xD2E227D30bC94D6FfD4eCf6b56141429C801E228` — pay WLD, earn 7 tokens

---

## Key Files

| File | Purpose |
|------|---------|
| `lib/contract.ts` | H2O Acua staking ABI, address, fetchers |
| `lib/new-contracts.ts` | New staking + mining ABIs, addresses, fetchers |
| `components/acua-app.tsx` | Main app: routing, tab navigation, ownership detection |
| `components/stake-panel.tsx` | H2O staking (DO NOT MODIFY) |
| `components/owner-panel.tsx` | H2O admin panel |
| `components/multi-staking-panel.tsx` | 8-token staking panel |
| `components/mining-uth2-panel.tsx` | UTH2 → H2O mining |
| `components/mining-wld-panel.tsx` | WLD → 7-token mining |
| `components/contracts-owner-panel.tsx` | Admin for all new contracts |
| `components/air-funder-panel.tsx` | AIR funder: deposit rewards only |
| `components/info-panel.tsx` | Token utilities + how-to guide |
| `hooks/use-wallet.ts` | MiniKit wallet auth, isOwner for H2O contract |

---

## MiniKit Permit2 Pattern
All token transfers use `sendTransaction` with Permit2:
```
permit2: [{ permitted: { token, amount }, spender: CONTRACT, nonce, deadline }]
transaction: [{ address: CONTRACT, abi, functionName, args: [..., 'PERMIT2_SIGNATURE_PLACEHOLDER_0'] }]
```

## Development
```bash
pnpm dev --port 5000
```
Must be opened inside World App to use MiniKit features. The app shows "Iniciando..." in browser preview (expected — no MiniKit outside World App).
