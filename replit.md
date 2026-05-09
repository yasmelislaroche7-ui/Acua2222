# ACUA MINIEXCHANGE — World Chain DeFi Mini App

## Overview
ACUA MINIEXCHANGE is a full exchange-style DeFi mini app for the World Chain ecosystem, running inside World App. It leverages MiniKit and Permit2 for gasless transactions. The platform offers staking (H2O, multi-token, V2, V3), mining (UTH2→H2O, WLD→7tokens, TIME→WLD), swap, bridge, BNB Chain full exchange (Send/Receive/QR/Swap/History), a draggable AI assistant, and a multi-language interface.

## User Preferences
- Iterative development.
- Ask before making major changes.
- Do not modify `components/stake-panel.tsx`.

## Run & Operate
- **Dev**: `npm run dev` (port 5000)
- **Build**: `npm run build`
- **TypeScript**: `npx tsc --noEmit` (pre-existing BigInt `n` literal warnings are benign — Turbopack handles them)

## Stack
- **Framework**: Next.js 16 (App Router, Turbopack) with TypeScript
- **Styling**: Tailwind CSS v4 + Radix UI (Shadcn UI components)
- **Blockchain**: ethers.js v6 (reads + BNB signing), @worldcoin/minikit-js (auth + txs), Permit2
- **i18n**: 16 languages via `lib/i18n.ts` + `context/lang-context.tsx` (LangProvider), persisted in localStorage
- **Theme**: Binance-style dark, electric blue (oklch(0.65 0.22 255))

## Where Things Live
- `components/acua-app.tsx` — Main shell, nav, network switcher, BNB panels orchestration
- `components/bnb-wallet-panel.tsx` — Full BNB exchange: Balances/Send/Receive(QR)/History(BSCScan)/Swap(PancakeSwap V2)
- `components/bnb-sushi-panel.tsx` — SUSHI + WLD staking panel (tab switcher): SUSHI BNB cook/deposit/withdraw/claimRewards, WLD 2.0 Permit2 stake/withdraw/claim via World App
- `components/bnb-bridge-panel.tsx` — Bridge UI: 4 tabs, cancel/refund visible per request, admin config
- `components/ai-agent.tsx` — Draggable floating AI chatbot (pointer events + snap-to-corner), 24-topic KB
- `contracts-hh/contracts/AcuaBridgeBNB.sol` — BNB bridge v3 + peerContract + receiveFee()
- `contracts-hh/contracts/AcuaBridgeWLD.sol` — WLD bridge v3 + peerContract + receiveFee()
- `lib/i18n.ts` — All 16 language translations
- `lib/sushibnb-abi.ts` — BNB contract ABIs, BNB_TOKENS, MEMBERSHIP_TIERS
- `lib/new-contracts.ts` — World Chain contract addresses + providers

## Architecture Decisions
- **Non-custodial**: imported BNB wallet stored in parent state in memory only (not persisted to server)
- **Permit2**: used on World Chain for gasless ERC20 approvals; BNB uses standard `transferFrom`
- **Bridge pre-deploy**: `DEPLOYED=false` flag in bridge panel — flip to `true` + set real addresses after deploy
- **Gas floor**: BSC minimum 1 gwei (Tycho hard fork, Feb 2024) enforced via `GAS_WEI = 1_100_000_000n`
- **PancakeSwap V2 router**: `0x10ED43C718714eb63d5aA57B78B54704E256024E` on BSC for BNB wallet swap tab
- **BSCScan free API**: used for BNB wallet history tab (no API key, rate-limited but functional)
- **AI agent draggable**: pointer capture API (`setPointerCapture`) on the button, snaps to nearest screen corner on release, position persisted in localStorage `acua_agent_pos`

## Product
- **Staking**: H2O (12% APY), H2O 2.0, H2O v3, StakeV2, Stake+ (8 tokens), SUSHI 2.0 (300% APR), WLD 2.0 (100% APR)
- **Mining**: UTH2→H2O, WLD→7 tokens, TIME→WLD
- **BNB Exchange**: Send / Receive (QR) / TX History / Swap (PancakeSwap V2 w/ WBNB 3-hop) / Balances
- **Bridge**: SUSHI WLD↔BNB, cancel/refund, configurable peerContract, receiveFee() for stake routing
- **AI Agent H2O**: 24-topic local KB, 16-language, draggable button, snap-to-corner, 6 quick questions

## Key Contracts
- **H2OFeeCollector**: `0xB58B80EF6db1B508A0241ac4565fe7c29F299d60` on World Chain — fee 0.001 H2O
- **SUSHI Staking BNB**: `0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08` — withdraw() NO PARAM (withdraws all)
- **SUSHI token**: `0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38` (same address on both chains)
- **WLD token**: `0x2cFc85d8E48F8EAB294be644d9E25C3030863003` on World Chain
- **WLDStakeV2**: `0x664dc60740888A25C77141CbcE7D4eD7dF2C44f7` on World Chain — 100% APR, 5% fee, Permit2 deposits, 48h withdraw / 24h claim queue. Address saved in `contracts-hh/deployed-wld-v2.json` and read by `lib/wld-stake-v2.ts`
- **Bridge contracts**: NOT DEPLOYED — placeholder addresses, flip DEPLOYED=false→true after deploy

## User Preferences
- Iterative development.
- Ask before making major changes.
- Do not modify `components/stake-panel.tsx`.

## Gotchas
- `withdraw()` on SUSHI BNB stake contract takes NO parameter — always withdraws entire staked amount
- `claimRewards()` (not `harvest`) to claim without withdrawing
- BSC gas minimum is 1 gwei (network hard floor since Feb 2024 Tycho fork)
- Bridge contracts: `cancel(uint256 id)` already refunds 100% SUSHI to user — both contracts have it
- `receiveFee(uint256)` in both bridge contracts lets anyone route stake fees to fundPool (2% stake routing)
- BNB wallet panel requires `bnbPrivateKey` prop for signing — read-only mode shows balances only
- BNB swap: token-to-token uses 3-hop path [token→WBNB→token]; slippage uses bigint `rawOut * 98n / 100n` to avoid float precision issues
- WLDStakeV2: deploy to World Chain, then put address in `contracts-hh/deployed-wld-v2.json` as `{ "contract": "0x..." }`
