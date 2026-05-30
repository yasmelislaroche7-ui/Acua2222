/**
 * deploy-h2o-stake3.js
 * Deploy H2OStake3 — H2O 2.0 Staking v3
 * APR de mercado (Synthetix), sin cola, comisiones configurables, referidos integrados.
 *
 * cd contracts-hh
 * npx hardhat run scripts/deploy-h2o-stake3.js --network worldchain
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER2   = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";
const OUT_FILE = path.join(__dirname, "..", "deployed-h2o-stake3.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await deployer.getBalance();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy H2OStake3 — H2O 2.0 Staking v3");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);
  console.log("  Owner2   :", OWNER2);
  console.log("  Balance  :", ethers.utils.formatEther(bal), "ETH");

  if (fs.existsSync(OUT_FILE)) {
    const existing = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
    if (existing.contract) {
      console.log("\n  ⚠  Ya existe deploy en:", existing.contract);
      console.log("  Elimina deployed-h2o-stake3.json para redesplegar.");
      return;
    }
  }

  const Factory = await ethers.getContractFactory("H2OStake3");
  console.log("\n  Deploying H2OStake3…");
  const contract = await Factory.deploy(OWNER2);
  await contract.deployed();
  console.log("  ✓ H2OStake3:", contract.address);

  const output = {
    deployedAt: new Date().toISOString(),
    network:    "worldchain",
    chainId:    480,
    deployer:   deployer.address,
    owner2:     OWNER2,
    contract:   contract.address,
    token:      "0x08131A6f780AEF79E86518c4A10c06387Ec74636",
    model:      "Synthetix — APR de mercado",
    fees:       "0/0/0% (configurables por owner, cap 20%)",
    referral:   "15% en claims con referido: 5% referrer + 5% bonus usuario + 5% owner2",
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("  ✓ Guardado en deployed-h2o-stake3.json");
  console.log("\n  Fondear el pool antes de abrir:", contract.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
