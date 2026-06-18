---
name: Deployed contracts World Chain
description: Addresses and deploy method for AcuaTokenStake and AcuaFreeClaim on World Chain mainnet (chainId 480)
---

## AcuaTokenStake
- Address: `0x9e4EF12b5a931f5E2D38bB37DD086EB1c3ce8AF6`
- Token: `0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd` (H2O Acua Company)
- owner2: `0xc2ef127734f296952de75c1b58a6cec605cc2e59`
- Deployer: `0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4`
- Deployed: 2026-06-18
- JSON: `contracts-hh/deployed-acua-token-stake.json`
- Frontend lib: `lib/acua-token-stake.ts`
- Panel: `components/acua-token-stake-panel.tsx`
- Nav tab: `acua-stake` in MENU_STAKING

## AcuaFreeClaim
- Address: `0x9630D8Da91D1b336Faa074930fAF76c81F5D48b7`
- owner2: `0xc2ef127734f296952de75c1b58a6cec605cc2e59`
- Deployer: `0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4`
- Deployed: 2026-06-18
- JSON: `contracts-hh/deployed-acua-free-claim.json`
- Frontend lib: `lib/acua-free-claim.ts`
- Panel: `components/acua-free-claim-panel.tsx`
- Nav tab: `acua-claim` in MENU_MARKET

## Deploy method
Hardhat CLI on this machine always prompts for telemetry (even with ~/.hardhat/config.json).
**Bypass**: use `contracts-hh/deploy-direct.js` — ethers.js v5 script, run via `node deploy-direct.js`.
Requires `PRIVATE_KEY` env var; uses `new ethers.providers.JsonRpcProvider({ url }, { chainId, name })`.

**Why:** `npx hardhat run` blocks on interactive TTY prompt that no env var suppresses reliably.
**How to apply:** For any new contracts, compile with `npx hardhat compile` then deploy with `node deploy-direct.js`.
