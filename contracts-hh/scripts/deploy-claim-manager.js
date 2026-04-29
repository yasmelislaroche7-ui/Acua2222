// scripts/deploy-claim-manager.js
// Despliega AcuaClaimManager y registra el primer claim (WDD).
//
// Uso:
//   cd contracts-hh
//   PRIVATE_KEY=0x... npx hardhat run scripts/deploy-claim-manager.js --network worldchain

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

const WDD_CLAIM_CONTRACT = "0x52DFEe61180A0BCEBe007E5a9Cfd466948aCCA46";
const WDD_REWARD_TOKEN   = "0xEdE54d9c024ee80C85ec0a75eD2d8774c7Fbac9B";
const FEE_BPS            = 3000; // 30%

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy AcuaClaimManager — World Chain");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer:", deployer.address);

  const balance = await deployer.getBalance();
  console.log("  Balance :", hre.ethers.utils.formatEther(balance), "ETH");

  if (balance.isZero()) {
    console.error("\n  Sin ETH para gas. Fondea la wallet del deployer.");
    process.exitCode = 1;
    return;
  }

  // 1. Deploy
  console.log("\n  Deploying AcuaClaimManager(owner=" + deployer.address + ")...");
  const Factory = await hre.ethers.getContractFactory("AcuaClaimManager");
  const manager = await Factory.deploy(deployer.address);
  await manager.deployed();
  console.log("  AcuaClaimManager:", manager.address);

  // 2. Register WDD claim
  console.log("\n  Registrando claim WDD ...");
  const tx = await manager.addClaim(WDD_CLAIM_CONTRACT, WDD_REWARD_TOKEN, FEE_BPS, "WDD");
  const r  = await tx.wait();
  console.log("  Tx:", tx.hash, "| block:", r.blockNumber);

  // 3. Save deployed address
  const out = {
    acuaClaimManager: manager.address,
    owner: deployer.address,
    deployedAt: new Date().toISOString(),
    claims: [
      { id: 0, name: "WDD", claimContract: WDD_CLAIM_CONTRACT, rewardToken: WDD_REWARD_TOKEN, feeBps: FEE_BPS },
    ],
  };
  const outPath = path.join(__dirname, "deployed-claim-manager.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("\n  → guardado en", outPath);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Listo. Usa esta dirección en lib/claim-manager.ts:");
  console.log("    " + manager.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\nError:", err.message || err);
  process.exitCode = 1;
});
