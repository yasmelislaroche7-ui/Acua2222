/**
 * test-swap.js
 * Tests 3 swaps via AcuaSwapRouter:
 *   1. 0.1 WLD  -> USDC
 *   2. 0.1 WLD  -> H2O
 *   3. 0.001 USDC -> H2O
 *
 * Usage: node scripts/test-swap.js
 * Env:   PRIVATE_KEY must be set
 */
require("dotenv").config();
const { ethers } = require("ethers");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL     = "https://worldchain-mainnet.g.alchemy.com/v2/bVo646pb8L7_W_nahCoqW";

// ─── Addresses ────────────────────────────────────────────────────────────────
const WLD    = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003";
const USDC   = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
const H2O    = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const MAX_UINT160 = ethers.BigNumber.from("1461501637330902918203684832716283019655932542975");
const MAX_UINT256 = ethers.constants.MaxUint256;
const SLIPPAGE_BPS = 150; // 1.5% auto-slippage

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
];
const PERMIT2_ABI = [
  "function approve(address token, address spender, uint160 amount, uint48 expiration) nonpayable",
  "function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)",
];
const ROUTER_ABI = [
  "function swapV3Single(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMin, uint256 usdcEquivalent) returns (uint256)",
  "function swapV3Multi(address tokenIn, address hopToken, address tokenOut, uint24 fee1, uint24 fee2, uint256 amountIn, uint256 amountOutMin, uint256 usdcEquivalent) returns (uint256)",
  "function quoteSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) view returns (uint256 amountOut, address poolAddr)",
  "function getPoolAddress(address tokenA, address tokenB, uint24 fee) pure returns (address)",
];

// Load deployed addresses
let ACUA_SWAP_ROUTER;
try {
  const deployed = require("./deployed-addresses.json");
  ACUA_SWAP_ROUTER = deployed.ACUA_SWAP_ROUTER;
  console.log("Router:", ACUA_SWAP_ROUTER);
} catch {
  console.error("ERROR: Run deploy-all.js first");
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function ensureApprovals(signer, tokenAddress, amount) {
  const token   = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const permit2 = new ethers.Contract(PERMIT2, PERMIT2_ABI, signer);
  const sym = await token.symbol();

  const erc20Allow = await token.allowance(signer.address, PERMIT2);
  if (erc20Allow.lt(amount)) {
    console.log(`  [${sym}] ERC20 -> Permit2 max approve...`);
    const tx = await token.approve(PERMIT2, MAX_UINT256, { gasLimit: 100000 });
    await tx.wait();
    console.log(`  [${sym}] approved. tx: ${tx.hash}`);
  } else {
    console.log(`  [${sym}] ERC20->Permit2 already approved`);
  }

  const [p2Amt] = await permit2.allowance(signer.address, tokenAddress, ACUA_SWAP_ROUTER);
  if (p2Amt.lt(amount)) {
    const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
    console.log(`  [${sym}] Permit2 -> router approve...`);
    const tx = await permit2.approve(tokenAddress, ACUA_SWAP_ROUTER, MAX_UINT160, exp, { gasLimit: 80000 });
    await tx.wait();
    console.log(`  [${sym}] approved. tx: ${tx.hash}`);
  } else {
    console.log(`  [${sym}] Permit2->router already approved`);
  }
}

const ACUA_FEE_BPS = 210; // swapFeeBps(200) + h2oFeeBps(10)

/**
 * getBestRoute: quotes using callStatic.swapV3Single/Multi with amountOutMin=0.
 * This gives accurate quotes (after Acua fees + pool fees).
 * Falls back to spot-price discount if no approvals are set.
 */
async function getBestRoute(router, tokenIn, tokenOut, amountIn, signer) {
  const FEE_TIERS = [500, 3000, 10000];
  let best = null;
  let bestOut = ethers.BigNumber.from(0);

  // Use callStatic for accurate quotes (these simulate the real swap)
  // Single-hop
  for (const fee of FEE_TIERS) {
    try {
      const out = await router.callStatic.swapV3Single(
        tokenIn, tokenOut, fee, amountIn, 0, 0, { from: signer.address }
      );
      if (out.gt(bestOut)) {
        bestOut = out;
        best = { type: "single", fee, amountOut: out, label: `V3 direct fee=${fee}` };
      }
    } catch {}
  }

  // Multi-hop via WLD
  if (tokenIn.toLowerCase() !== WLD.toLowerCase() && tokenOut.toLowerCase() !== WLD.toLowerCase()) {
    for (const [f1, f2] of [[500, 3000], [3000, 3000], [10000, 3000]]) {
      try {
        const out = await router.callStatic.swapV3Multi(
          tokenIn, WLD, tokenOut, f1, f2, amountIn, 0, 0, { from: signer.address }
        );
        if (out.gt(bestOut)) {
          bestOut = out;
          best = { type: "multi", hopToken: WLD, fee1: f1, fee2: f2, amountOut: out, label: `V3 via WLD f1=${f1} f2=${f2}` };
        }
      } catch {}
    }
  }

  return best;
}

async function doSwap(signer, router, label, tokenIn, tokenOut, decimalsIn, decimalsOut, humanAmt) {
  console.log(`\n─── Swap: ${label} ───`);
  const amountIn = ethers.utils.parseUnits(humanAmt, decimalsIn);

  // USDC-equiv for volume (approx)
  let usdcEquiv = ethers.BigNumber.from(0);
  try {
    if (tokenIn.toLowerCase() === USDC.toLowerCase()) {
      usdcEquiv = amountIn;
    } else {
      const [usdcOut] = await router.callStatic.quoteSingle(tokenIn, USDC, 10000, amountIn);
      usdcEquiv = usdcOut;
    }
  } catch {}

  // Approve first (needed for accurate callStatic quotes and real tx)
  await ensureApprovals(signer, tokenIn, amountIn);

  const best = await getBestRoute(router, tokenIn, tokenOut, amountIn, signer);
  if (!best) {
    console.log("  No route found. Skipping.");
    return;
  }
  console.log(`  Route:    ${best.label}`);
  const outHuman = ethers.utils.formatUnits(best.amountOut, decimalsOut);
  console.log(`  Quoted:   ${outHuman}`);

  const minOut = best.amountOut.mul(10000 - SLIPPAGE_BPS).div(10000);

  const outToken = new ethers.Contract(tokenOut, ERC20_ABI, signer.provider);
  const balBefore = await outToken.balanceOf(signer.address);

  let tx;
  if (best.type === "single") {
    tx = await router.swapV3Single(
      tokenIn, tokenOut, best.fee, amountIn, minOut, usdcEquiv,
      { gasLimit: 280000 }
    );
  } else {
    tx = await router.swapV3Multi(
      tokenIn, best.hopToken, tokenOut,
      best.fee1, best.fee2,
      amountIn, minOut, usdcEquiv,
      { gasLimit: 400000 }
    );
  }

  console.log(`  Sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Block: ${receipt.blockNumber}  gas: ${receipt.gasUsed}`);

  const balAfter = await outToken.balanceOf(signer.address);
  const received = balAfter.sub(balBefore);
  console.log(`  Received: ${ethers.utils.formatUnits(received, decimalsOut)}`);
  console.log(`  Status: ${receipt.status === 1 ? "SUCCESS ✓" : "FAILED ✗"}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!PRIVATE_KEY) { console.error("PRIVATE_KEY not set"); process.exit(1); }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer   = new ethers.Wallet(PRIVATE_KEY, provider);
  const router   = new ethers.Contract(ACUA_SWAP_ROUTER, ROUTER_ABI, signer);

  console.log("=========================================");
  console.log("  Acua Swap — Test Swaps (World Chain)");
  console.log("=========================================");
  console.log("Wallet:", signer.address);
  console.log("ETH:   ", ethers.utils.formatEther(await provider.getBalance(signer.address)));

  const [wldBal, usdcBal, h2oBal] = await Promise.all([
    new ethers.Contract(WLD,  ERC20_ABI, provider).balanceOf(signer.address),
    new ethers.Contract(USDC, ERC20_ABI, provider).balanceOf(signer.address),
    new ethers.Contract(H2O,  ERC20_ABI, provider).balanceOf(signer.address),
  ]);
  console.log("WLD: ", ethers.utils.formatEther(wldBal));
  console.log("USDC:", ethers.utils.formatUnits(usdcBal, 6));
  console.log("H2O: ", ethers.utils.formatEther(h2oBal));

  // Test routing first
  console.log("\n─── Routing check ───");
  for (const [label, tIn, tOut, dec, fee] of [
    ["WLD->USDC fee=10000", WLD, USDC, 6, 10000],
    ["WLD->USDC fee=3000",  WLD, USDC, 6, 3000],
    ["H2O->WLD  fee=3000",  H2O, WLD,  18, 3000],
    ["WLD->H2O  fee=3000",  WLD, H2O,  18, 3000],
  ]) {
    try {
      const amtIn = tIn === USDC ? ethers.utils.parseUnits("1", 6) : ethers.utils.parseEther("1");
      const [out] = await router.callStatic.quoteSingle(tIn, tOut, fee, amtIn);
      console.log(`  ${label}: 1 -> ${ethers.utils.formatUnits(out, dec)}`);
    } catch (e) {
      console.log(`  ${label}: ERROR -`, e.message.slice(0, 60));
    }
  }

  // Execute swaps
  await doSwap(signer, router, "0.1 WLD -> USDC",   WLD,  USDC, 18, 6,  "0.1");
  await doSwap(signer, router, "0.1 WLD -> H2O",    WLD,  H2O,  18, 18, "0.1");
  await doSwap(signer, router, "0.001 USDC -> H2O", USDC, H2O,   6, 18, "0.001");

  console.log("\n=========================================");
  console.log("  Final balances");
  console.log("=========================================");
  const [wB, uB, hB] = await Promise.all([
    new ethers.Contract(WLD,  ERC20_ABI, provider).balanceOf(signer.address),
    new ethers.Contract(USDC, ERC20_ABI, provider).balanceOf(signer.address),
    new ethers.Contract(H2O,  ERC20_ABI, provider).balanceOf(signer.address),
  ]);
  console.log("WLD: ", ethers.utils.formatEther(wB));
  console.log("USDC:", ethers.utils.formatUnits(uB, 6));
  console.log("H2O: ", ethers.utils.formatEther(hB));
  console.log("ETH: ", ethers.utils.formatEther(await provider.getBalance(signer.address)));
}

main().catch(e => { console.error(e); process.exit(1) });
