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
- `BNBSushiPanel` — Full SUSHI staking on BNB: deposit/withdraw(no-param!)/claimRewards/cook, membership tiers, referrals. ABI 100% verified on-chain via bytecode selector matching.
- `BNBWalletPanel` — BNB Chain token balances (BNB, SUSHI, USDT, USDC, BUSD) via ethers
- `BNBBridgePanel` — SUSHI WLD↔BNB bridge UI: request/track/admin-process, localStorage requests, owner admin tab
- `FloatingFab` — Tighter double-arc fan (inner R=68, outer R=128), 10 shortcuts, solid backgrounds, no blur

### BNB Chain Integration
- **Network**: BNB Chain (Chain ID 56), RPC `https://bsc-dataseed1.binance.org`
- **SUSHI contract**: `0x945B4b199Baf8F41E11E79df32D9919bd1fd1c08`
- **SUSHI token (both chains)**: `0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38`
- **ABI**: `lib/sushibnb-abi.ts` — verified ABI, ERC20_ABI, BNB_TOKENS, MEMBERSHIP_TIERS
- **Verified selectors**: `deposit(uint256)`=0xb6b55f25, `withdraw()`=0x3ccfd60b (NO param — withdraws ALL), `claimRewards()`=0x372500ab (NOT harvest), `getUserInfo(address)`=0x6386c1c7 returns (staked,pendingRewards,cookingRewards,lastActionTs), `totalStaked()`=0x817b1cd2
- **getUserInfo fields**: [0]=staked(wei), [1]=pendingRewards(wei), [2]=cookingRewards acum(wei), [3]=lastActionTs(unix seconds)
- **TX flow**: 2-step confirm dialog (summary + gas cost BNB) → step-by-step progress bar → TX hash link to BNBScan → done/error state
- **BNB nav**: 3-tab sub-nav (Stake / Wallet / Bridge) shown when BNB network is active
- **Wallet**: imported via WalletManager (seed or private key), stored in parent state, passed to BNB panels

### Bridge Contracts v2 (written, not yet deployed)
- `contracts-hh/contracts/AcuaBridgeWLD.sol` — World Chain side (Permit2 gasless). Flat fee 1000 SUSHI, min 10k, auto-split >100k into 10k chunks. Pools: fundPool / userPool / feePool. P2P offset via releaseFromUsers(). 10% of fees → owner2 (configurable).
- `contracts-hh/contracts/AcuaBridgeBNB.sol` — BNB side (transferFrom). Same logic, no Permit2. fund(amount) with prior approve.
- Deploy scripts: `contracts-hh/scripts/deploy-bridge-wld.js` and `deploy-bridge-bnb.js`
- BNB deploy cost estimate: ~0.006-0.010 BNB at 3-5 gwei. Recommended wallet balance: 0.05 BNB (~$30)
- Bridge UI (`components/bnb-bridge-panel.tsx`): 4 tabs (Bridge / WLD list / BNB list / Admin owner). Total bridged counter public. Contract balance owner-only. Process from fund + P2P buttons. Full config panel.
- DEPLOYED=false flag in panel — switch to true + update addresses after deploy

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
