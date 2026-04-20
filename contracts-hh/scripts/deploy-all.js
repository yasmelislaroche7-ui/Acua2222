/**
 * deploy-all.js
 * Deploys AcuaSwapRouter + AcuaVolumeRewards, links them, and prints addresses.
 *
 * Usage: npx hardhat run scripts/deploy-all.js --network worldchain
 * Env:   PRIVATE_KEY must be set (already in process.env via hardhat.config.js)
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── Fee owner (deployer wallet = owner, adjust if needed) ────────────────────
// FEE_OWNER_2 and FEE_OWNER_3 can be set to additional addresses or left as zero
const FEE_OWNER_2 = "0x0000000000000000000000000000000000000000";
const FEE_OWNER_3 = "0x0000000000000000000000000000000000000000";

async function main() {
  const [deployer] = await ethers.getSigners();
  const FEE_OWNER_1 = deployer.address;

  console.log("==========================================");
  console.log("  Acua Swap — Full Deploy");
  console.log("==========================================");
  console.log("Deployer :", deployer.address);
  console.log("Balance  :", ethers.utils.formatEther(await deployer.getBalance()), "ETH\n");

  // ── 1. AcuaSwapRouter ───────────────────────────────────────────────────────
  console.log("1/3  Deploying AcuaSwapRouter…");
  const RouterFactory = await ethers.getContractFactory("AcuaSwapRouter");
  const router = await RouterFactory.deploy([FEE_OWNER_1, FEE_OWNER_2, FEE_OWNER_3]);
  await router.deployed();
  console.log("     AcuaSwapRouter    :", router.address);

  // ── 2. AcuaVolumeRewards ────────────────────────────────────────────────────
  console.log("2/3  Deploying AcuaVolumeRewards…");
  const VolumeFactory = await ethers.getContractFactory("AcuaVolumeRewards");
  const volumeRewards = await VolumeFactory.deploy(router.address);
  await volumeRewards.deployed();
  console.log("     AcuaVolumeRewards :", volumeRewards.address);

  // ── 3. Link: setVolumeRewards on router ─────────────────────────────────────
  console.log("3/3  Linking volumeRewards in router…");
  const tx = await router.setVolumeRewards(volumeRewards.address);
  await tx.wait();
  console.log("     Linked.\n");

  // ── Summary ─────────────────────────────────────────────────────────────────
  const swapFeeBps   = await router.swapFeeBps();
  const h2oFeeBps    = await router.h2oFeeBps();
  const numTiers     = await volumeRewards.numTiers();
  const linkedRouter = await volumeRewards.swapRouter();

  console.log("==========================================");
  console.log("  Deployment Summary");
  console.log("==========================================");
  console.log("AcuaSwapRouter    :", router.address);
  console.log("  swapFeeBps      :", swapFeeBps.toString(), "(2%)");
  console.log("  h2oFeeBps       :", h2oFeeBps.toString(),  "(0.1%)");
  console.log("  feeOwner[0]     :", FEE_OWNER_1);
  console.log("  volumeRewards   :", await router.volumeRewards());
  console.log("");
  console.log("AcuaVolumeRewards :", volumeRewards.address);
  console.log("  swapRouter      :", linkedRouter);
  console.log("  numTiers        :", numTiers.toString());
  console.log("  UTH2            :", await volumeRewards.UTH2());
  console.log("");

  for (let i = 0; i < numTiers.toNumber(); i++) {
    const th = await volumeRewards.tierThresholds(i);
    const rw = await volumeRewards.tierRewards(i);
    console.log(`  Tier ${i}: >= ${ethers.utils.formatUnits(th, 6)} USDC -> ${ethers.utils.formatEther(rw)} UTH2`);
  }

  console.log("\n==========================================");
  console.log("  NEXT STEPS");
  console.log("==========================================");
  console.log("1. Update ACUA_SWAP_ROUTER   in components/swap-panel.tsx:");
  console.log("     const ACUA_SWAP_ROUTER   = '" + router.address + "'");
  console.log("2. Update ACUA_VOLUME_REWARDS in components/swap-panel.tsx:");
  console.log("     const ACUA_VOLUME_REWARDS= '" + volumeRewards.address + "'");
  console.log("3. Fund UTH2 rewards:  npm run fund:volume");
  console.log("4. Test swap:          node scripts/test-swap.js");

  // Write addresses to a file for easy copy-paste
  const out = {
    ACUA_SWAP_ROUTER:    router.address,
    ACUA_VOLUME_REWARDS: volumeRewards.address,
    deployer:            deployer.address,
    network:             "worldchain",
    timestamp:           new Date().toISOString(),
  };
  const outPath = path.join(__dirname, "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\nAddresses saved to:", outPath);
}

main().catch(e => { console.error(e); process.exit(1) });
