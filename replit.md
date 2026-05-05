# ACUA MINIEXCHANGE — World Chain DeFi Mini App

## Overview
ACUA MINIEXCHANGE is a full exchange-style DeFi mini app for the World Chain ecosystem, running inside World App. It leverages MiniKit and Permit2 for gasless transactions. The platform offers staking (H2O, multi-token, V2, V3), mining (UTH2→H2O, WLD→7tokens, TIME→WLD), swap, bridge, BNB Chain staking, a floating AI assistant, and a multi-language interface.

## User Preferences
- Iterative development.
- Ask before making major changes.
- Do not modify `components/stake-panel.tsx`.

## System Architecture

### Frontend Stack
- **Framework**: Next.js 16 (App Router) with TypeScript
- **Styling**: Tailwind CSS v4 + Radix UI (Shadcn UI components)
- **Blockchain**: ethers.js v6 (reads), @worldcoin/minikit-js (auth + txs), Permit2
- **Internationalization**: 16 languages via `lib/i18n.ts` + `context/lang-context.tsx` (LangProvider)
- **Theme**: Binance-style dark theme, electric blue (oklch(0.65 0.22 255))

### Key Components
- `AcuaApp` — Main shell with nav drawer, header (language switcher + network switcher), floating fan menu (10-item double-arc, smaller/more opaque), BNB panels, and AI agent
- `LanguageSwitcher` — Top-right flag dropdown, 16 languages, persisted in localStorage
- `WalletManager` — Import (seed phrase / private key) and export wallet, security warnings, blur toggle
- `NetworkSwitcher` — Network dropdown (WLD/BNB/Polygon) + wallet import/export built-in; notifies parent of BNB address
- `AiAgent` — Floating draggable chatbot "Agente H2O", local KB (no external API), 16-language, quick questions
- `BNBSushiPanel` — Full SUSHI staking on BNB: deposit/withdraw/harvest/cook, membership tiers, referrals
- `BNBWalletPanel` — BNB Chain token balances (BNB, SUSHI, USDT, USDC, BUSD) via ethers
- `BNBBridgePanel` — SUSHI WLD↔BNB bridge UI: request/track/admin-process, localStorage requests, owner admin tab
- `FloatingFab` — Tighter double-arc fan (inner R=68, outer R=128), 10 shortcuts, solid backgrounds, no blur

### BNB Chain Integration
- **Network**: BNB Chain (Chain ID 56), RPC `https://bsc-dataseed1.binance.org`
- **SUSHI contract**: `0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08`
- **SUSHI token (both chains)**: `0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38`
- **ABI**: `lib/sushibnb-abi.ts` — full ABI, ERC20_ABI, BNB_TOKENS, MEMBERSHIP_TIERS
- **BNB nav**: 3-tab sub-nav (Stake / Wallet / Bridge) shown when BNB network is active
- **Wallet**: imported via WalletManager (seed or private key), stored in parent state, passed to BNB panels

### Bridge Contracts (written, not yet deployed)
- `contracts-hh/contracts/AcuaBridgeWLD.sol` — World Chain side: deposit via Permit2, fulfill/cancel/release by owner
- `contracts-hh/contracts/AcuaBridgeBNB.sol` — BNB Chain side: deposit via transferFrom, fulfill/cancel/release by owner
- Bridge is currently manual: owner reads events, sends on the other chain, marks fulfilled
- Bridge requests tracked in localStorage, visible in requests tab and owner admin tab

### H2OFeeCollector
- **Contract**: `0xB58B80EF6db1B508A0241ac4565fe7c29F299d60` on World Chain
- **Fee**: 0.001 H2O (set via `setFee` with PRIVATE_KEY, TX: `0x33e9373cdeec650dec3c4532531d091b61c22f4bf11902a3d90cce122afb1691`)

### Blockchain
- **World Chain**: Chain ID 480, Alchemy RPC
- **BNB Chain**: Chain ID 56, `https://bsc-dataseed1.binance.org`
- **Transaction Pattern**: Write ops use MiniKit `sendTransaction` + Permit2 (World Chain), or ethers signer from imported wallet (BNB Chain)

### Navigation
- **Side Drawer**: Staking (H2O, H2O 2.0, H2O v3, StakeV2, Stake+, SUSHI 2.0) / Mining (UTH2, WLD, TIME) / Market (Swap, Tokens) / Info (Monitor, Info/Guía) / Admin (owner only)
- **Fan Menu**: 10-item floating double-arc shortcut to all WLD tabs (only shown on WLD network)
- **BNB Sub-Nav**: 3 tabs (SUSHI Stake / Wallet BNB / Bridge WLD↔BNB) shown when BNB network active
- **Polygon**: Coming Soon panel
- **Language Switcher**: Top-right, persisted, flags for all 16 languages
- **AI Agent**: Bottom-right floating chatbot, draggable, local DeFi knowledge base

## External Dependencies
- **World Chain** (Chain ID 480) — primary staking/mining/swap network
- **BNB Chain** (Chain ID 56) — SUSHI staking, bridge destination
- **Alchemy** — World Chain RPC
- **@worldcoin/minikit-js** — World App wallet + transactions
- **Uniswap V3/V4** — DEX on World Chain
- **Permit2** — Gasless approvals
- **ethers.js v6** — Blockchain reads + BNB wallet signing
