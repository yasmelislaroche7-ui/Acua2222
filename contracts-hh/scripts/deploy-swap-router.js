const { ethers } = require("hardhat");

// ─── Fee owners (up to 3 — set address(0) for unused slots) ─────────────────
const FEE_OWNER_1 = "0x54F0D557E8042eC70974d2e85331BE5D66fFe5F4";
const FEE_OWNER_2 = "0x0000000000000000000000000000000000000000"; // unused
const FEE_OWNER_3 = "0x0000000000000000000000000000000000000000"; // unused

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer :", deployer.address);
  console.log("Balance  :", ethers.utils.formatEther(await deployer.getBalance()), "ETH\n");

  const Factory = await ethers.getContractFactory("AcuaSwapRouter");
  console.log("Deploying AcuaSwapRouter…");
  const contract = await Factory.deploy([FEE_OWNER_1, FEE_OWNER_2, FEE_OWNER_3]);
  await contract.deployed();

  console.log("\n✓ AcuaSwapRouter deployed at:", contract.address);
  console.log("  swapFeeBps :", (await contract.swapFeeBps()).toString(), "(2%)");
  console.log("  h2oFeeBps  :", (await contract.h2oFeeBps()).toString(),  "(0.1%)");
  console.log("  feeOwners  :", await contract.feeOwners(0), await contract.feeOwners(1), await contract.feeOwners(2));
  console.log("\nUpdate ACUA_SWAP_ROUTER in swap-panel.tsx and h2oStaking.ts with:", contract.address);
}

main().catch(e => { console.error(e); process.exit(1) });
