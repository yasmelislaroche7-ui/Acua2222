const { ethers } = require("hardhat");

// ─── Set this AFTER running deploy-swap-router.js ────────────────────────────
const SWAP_ROUTER_ADDRESS = "0x0000000000000000000000000000000000000000"; // <-- fill after swap router deploy

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer :", deployer.address);
  console.log("Balance  :", ethers.utils.formatEther(await deployer.getBalance()), "ETH\n");

  if (SWAP_ROUTER_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.warn("⚠️  SWAP_ROUTER_ADDRESS not set — deploy AcuaSwapRouter first!");
    console.warn("    Deploying with address(0) as router — update after deploy with setSwapRouter()");
  }

  const Factory = await ethers.getContractFactory("AcuaVolumeRewards");
  console.log("Deploying AcuaVolumeRewards…");
  const contract = await Factory.deploy(SWAP_ROUTER_ADDRESS);
  await contract.deployed();

  console.log("\n✓ AcuaVolumeRewards deployed at:", contract.address);
  console.log("  swapRouter :", await contract.swapRouter());
  console.log("  UTH2       :", await contract.UTH2());
  console.log("  PERIOD     : 30 days");
  console.log("\nTier thresholds (USDC) → UTH2 reward:");
  console.log("  1 USDC    → 0.0001 UTH2");
  console.log("  10 USDC   → 0.001  UTH2");
  console.log("  100 USDC  → 0.01   UTH2");
  console.log("  1000 USDC → 0.1    UTH2");
  console.log("\nNext steps:");
  console.log("  1. Run: npm run fund:volume -- --amount <UTH2_AMOUNT>");
  console.log("  2. Update ACUA_VOLUME_REWARDS in swap-panel.tsx with:", contract.address);
  console.log("  3. Call setVolumeRewards(" + contract.address + ") on AcuaSwapRouter");
}

main().catch(e => { console.error(e); process.exit(1) });
