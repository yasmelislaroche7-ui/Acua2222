/**
 * deploy-h2o-stake2.js
 * Deploy H2OStake2 — H2O 2.0 staking con referidos integrados
 *
 * Uso:
 *   cd contracts-hh
 *   npx hardhat run scripts/deploy-h2o-stake2.js --network worldchain
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER2   = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";
const H2O2_TOKEN = "0x08131A6f780AEF79E86518c4A10c06387Ec74636";
const OUT_FILE = path.join(__dirname, "..", "deployed-h2o-stake2.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await deployer.getBalance();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy H2OStake2 — H2O 2.0 Staking");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer  :", deployer.address);
  console.log("  Owner2    :", OWNER2);
  console.log("  H2O token :", H2O2_TOKEN);
  console.log("  Balance   :", ethers.utils.formatEther(bal), "ETH");

  if (fs.existsSync(OUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    if (existing.contract) {
      console.log("\n  ⚠  Ya existe un deploy en:", existing.contract);
      console.log("  Para redesplegar, elimina deployed-h2o-stake2.json primero.");
      return;
    }
  }

  console.log("\n  Compilando...");
  const Factory = await ethers.getContractFactory("H2OStake2");

  console.log("  Deploying H2OStake2...");
  const contract = await Factory.deploy(OWNER2);
  await contract.deployed();
  console.log("  ✓ H2OStake2:", contract.address);

  // Verify APR default
  const apr = await contract.aprBps();
  console.log("  APR default:", apr.toString(), "bps =", (apr / 100).toFixed(2) + "%");

  // Save
  const output = {
    deployedAt: new Date().toISOString(),
    network:    "worldchain",
    chainId:    480,
    deployer:   deployer.address,
    owner2:     OWNER2,
    contract:   contract.address,
    token:      H2O2_TOKEN,
    aprBps:     apr.toNumber(),
    claimFee:   "15% (5% referrer + 5% referee bonus + 5% owner2)",
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("  ✓ Guardado en deployed-h2o-stake2.json");

  console.log("\n━━ SIGUIENTE PASO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fondear el contrato con H2O 2.0 antes de abrir stake.");
  console.log("  Contrato:", contract.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
