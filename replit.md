# ACUA MINIEXCHANGE — World Chain DeFi Mini App

## Overview
ACUA MINIEXCHANGE is a full exchange-style DeFi mini app designed for the World Chain ecosystem, operating within the World App. It leverages MiniKit and Permit2 for gasless transactions. The platform offers a comprehensive suite of DeFi functionalities including staking (H2O, multi-token, V2, V3), mining (UTH2→H2O, WLD→7tokens, TIME→WLD), an integrated swap, a platform monitor, and an enhanced H2O 2.0 system featuring referrals and donations. The project aims to provide a robust and user-friendly decentralized finance experience within the World Chain.

## User Preferences
I want iterative development.
Ask before making major changes.
Do not modify `components/stake-panel.tsx`.

## System Architecture

### Frontend Stack
- **Framework**: Next.js 16 (App Router) with TypeScript
- **Styling**: Tailwind CSS v4 + Radix UI (Shadcn UI components)
- **Blockchain Interaction**: ethers.js v6 for blockchain reads, @worldcoin/minikit-js for wallet authentication and transactions.
- **UI/UX**: Binance-style dark theme with an electric blue color scheme (oklch(0.65 0.22 255)). Features include a floating flame-logo menu button for the side NavDrawer, a scrolling stats ticker, an H2O candlestick chart header, and bottom quick-nav tabs.
- **Components**:
    - `AcuaApp`: Manages main app routing, tab navigation, and ownership detection.
    - `MiniKitProvider`: Handles MiniKit initialization with a safe Replit preview fallback.
    - `MarketTicker`: Displays `CandlestickChart` (SVG with deterministic candles by hour), `StatsTicker` (horizontal scroll), and `MarketMiniCard` (price + chart header).
    - `PlatformMonitor`: Shows live on-chain statistics including user wallet/staked/pending balances, platform totals, and an active contracts table.
    - `H2O 2.0 Donation Card`: An amber-themed donation card for H2O 2.0, including copy-to-clipboard functionality and WLD/World Chain metadata.
    - `SushiStakeV2 Panel`: A full panel with hero banner, stake/withdrawal/claim forms, owner funding panel, and two queue lists with status/countdown.
    - `H2O v3 Panel`: Features a prominent APR hero banner (color-coded), an activity feed, APR-sorted pools (highest first), an improved SVG price chart with gridlines, Y-axis labels, volume bars, and a "NOW" badge. Ensures stable pool and position displays.

### Blockchain
- **Network**: World Chain (Chain ID 480)
- **RPC**: Alchemy World Chain mainnet (`/v2/<key>`). H2O v3 panel uses a single shared `JsonRpcProvider` with `staticNetwork: true` and `batchMaxCount: 8` for efficient data fetching.
- **Transaction Pattern**: All write operations utilize MiniKit `sendTransaction` with Permit2 for gasless transactions.

### Core Features
- **Staking**:
    - **H2O Staking (Legacy)**: Standard H2O staking with a 12% APY.
    - **Multi-Token Staking**: Supports staking for 8 additional tokens (WLD, FIRE, SUSHI, USDC, wCOP, wARS, BTCH2O, AIR).
    - **Sushi V2 Staking**: Deposits SUSHI tokens, tracking virtual balances. Features a 300% fixed APR (configurable up to 5000%), with 5% fees on deposit, withdrawal, and claim. Includes 48-hour withdrawal and 24-hour claim queues with FIFO auto-payment.
- **Mining**:
    - **UTH2 Mining**: Pay UTH2 to mine H2O.
    - **WLD Mining**: Pay WLD to mine 7 different tokens.
    - **TIME Mining**.
- **Swap (Acua Swap V2)**: Integrates Uniswap V3 direct pools (World Chain factory) and includes a Uniswap V2 fallback. Supports single and multi-hop swaps. Features a 2% swap fee + 0.1% H2O buyback (configurable). Utilizes Permit2 AllowanceTransfer.
- **Volume Rewards**: `AcuaVolumeRewardsV2` tracks USDC-equivalent swap volume per user over 30-day periods. Configurable tiers offer UTH2 rewards claimable mid-month.
- **Claim Management**: `AcuaClaimManager` allows for wrapping external claim contracts (e.g., Thirdweb TokenStake) and collecting a configurable fee (default 30%) in the reward token, paid directly to the owner via Permit2.
- **H2O VIP Standalone**: A separate system for UTH2 subscriptions where the owner funds H2O rewards, and users can claim linearly over 365 days.
- **Ownership Logic**: Differentiates between `isMainOwner` (sees Admin tab) and `isAirFunder` (sees AIR tab for depositing rewards only).

### Navigation
- **Public Tabs**: H2O (Stake H2O), Stake+ (Multi-Stake), UTH₂ (Minera UTH₂), WLD (Minera WLD), TIME (Minera TIME), Tokens (Directorio), Swap (DEX Swap), Admin (Panel Admin - visible based on ownership), Info (Guía).
- **Conditional Tabs**: Admin (for `isMainOwner`), AIR (for `isAirFunder`).

## External Dependencies

- **World Chain**: The primary blockchain network (Chain ID 480).
- **Alchemy**: Provides RPC services for World Chain mainnet.
- **@worldcoin/minikit-js**: Used for wallet authentication and transaction signing within the World App.
- **Uniswap V3**: Integrated for decentralized exchange functionalities and liquidity pools on World Chain.
- **SushiSwap V2**: Integrated for additional decentralized exchange capabilities.
- **Permit2**: Utilized for gasless token approvals and transfers.
- **Thirdweb**: Referenced for external claim contracts, specifically for WDD claims.