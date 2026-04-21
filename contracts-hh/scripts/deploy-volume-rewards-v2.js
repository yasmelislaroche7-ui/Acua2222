const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// New AcuaSwapRouterV2 currently used by the frontend
const NEW_SWAP_ROUTER = "0xA2FD6cd36a661E270FC7AdaA82D0d22f4660706d";
// UTH2 amount to fund the new contract from the owner wallet (18-dec)
const FUND_AMOUNT = ethers.utils.parseEther("100");

const UTH2_ADDR = "0x9eA8653640E22A5b69887985BB75d496dc97022a";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer       :", deployer.address);
  console.log("Balance        :", ethers.utils.formatEther(await deployer.getBalance()), "ETH");
  console.log("Linking router :", NEW_SWAP_ROUTER);
  console.log("Fund amount    :", ethers.utils.formatEther(FUND_AMOUNT), "UTH2\n");

  // ─── 1. Deploy AcuaVolumeRewardsV2 ────────────────────────────────────────
  const Factory  = await ethers.getContractFactory("AcuaVolumeRewardsV2");
  const contract = await Factory.deploy(NEW_SWAP_ROUTER);
  await contract.deployed();
  console.log("✓ AcuaVolumeRewardsV2 deployed at:", contract.address);

  // ─── 2. Wire the new router → new volume rewards ──────────────────────────
  console.log("\nLinking new router → new volume rewards…");
  const routerAbi = [
    "function owner() view returns (address)",
    "function setVolumeRewards(address) external",
    "function volumeRewards() view returns (address)",
  ];
  const router = new ethers.Contract(NEW_SWAP_ROUTER, routerAbi, deployer);
  const routerOwner = await router.owner();
  console.log("  Router owner       :", routerOwner);
  if (routerOwner.toLowerCase() === deployer.address.toLowerCase()) {
    const tx = await router.setVolumeRewards(contract.address);
    await tx.wait();
    console.log("✓ router.volumeRewards() now :", await router.volumeRewards());
  } else {
    console.warn("⚠ Deployer is NOT router owner — skipping setVolumeRewards. Please set manually.");
  }

  // ─── 3. Fund the new volume contract with UTH2 (optional) ─────────────────
  console.log("\nFunding new volume contract with UTH2…");
  const erc = new ethers.Contract(UTH2_ADDR, [
    "function transfer(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ], deployer);
  const ownerBal = await erc.balanceOf(deployer.address);
  if (ownerBal.gte(FUND_AMOUNT)) {
    const tx = await erc.transfer(contract.address, FUND_AMOUNT);
    await tx.wait();
    console.log("✓ Transferred", ethers.utils.formatEther(FUND_AMOUNT), "UTH2");
    console.log("  Volume contract UTH2 balance:", ethers.utils.formatEther(await erc.balanceOf(contract.address)));
  } else {
    console.warn("⚠ Owner UTH2 balance too low to fund — skipping.");
  }

  // ─── 4. Persist address ───────────────────────────────────────────────────
  const out = {
    acuaVolumeRewardsV2: contract.address,
    linkedSwapRouter:    NEW_SWAP_ROUTER,
  };
  const outPath = path.join(__dirname, "deployed-volume-v2.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\n✓ Saved to", outPath);

  console.log("\n=== UPDATE THIS IN swap-panel.tsx ===");
  console.log(`const ACUA_VOLUME_REWARDS = '${contract.address}'`);
}

main().catch(e => { console.error(e); process.exit(1); });
