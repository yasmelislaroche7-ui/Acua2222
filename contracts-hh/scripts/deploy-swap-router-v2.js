const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const FEE_OWNER_1 = "0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4";
const FEE_OWNER_2 = "0x0000000000000000000000000000000000000000";
const FEE_OWNER_3 = "0x0000000000000000000000000000000000000000";

// AcuaVolumeRewards to link after deploy (optional)
const VOLUME_REWARDS = "0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer :", deployer.address);
  console.log("Balance  :", ethers.utils.formatEther(await deployer.getBalance()), "ETH\n");

  const Factory = await ethers.getContractFactory("AcuaSwapRouterV2");
  console.log("Deploying AcuaSwapRouterV2 (SignatureTransfer)...");
  const contract = await Factory.deploy([FEE_OWNER_1, FEE_OWNER_2, FEE_OWNER_3]);
  await contract.deployed();

  console.log("\n✓ AcuaSwapRouterV2 deployed at:", contract.address);
  console.log("  swapFeeBps :", (await contract.swapFeeBps()).toString());
  console.log("  h2oFeeBps  :", (await contract.h2oFeeBps()).toString());

  // Link VolumeRewards
  if (VOLUME_REWARDS !== "0x0000000000000000000000000000000000000000") {
    console.log("\nLinking VolumeRewards...");
    const tx = await contract.setVolumeRewards(VOLUME_REWARDS);
    await tx.wait();
    console.log("✓ VolumeRewards linked:", VOLUME_REWARDS);
  }

  // Save to file
  const outPath = path.join(__dirname, "deployed-swap-v2.json");
  fs.writeFileSync(outPath, JSON.stringify({ acuaSwapRouterV2: contract.address }, null, 2));
  console.log("\n✓ Address saved to scripts/deployed-swap-v2.json");
  console.log("\n=== UPDATE THIS IN swap-panel.tsx ===");
  console.log("const ACUA_SWAP_ROUTER = '" + contract.address + "'");
}

main().catch(e => { console.error(e); process.exit(1) });
