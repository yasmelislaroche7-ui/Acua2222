/**
 * deploy-h2o-stake-v4.js
 * Deploy H2OStakeV4 — H2O ACUA Company staking (retiros/claims instantáneos)
 *
 * Uso:
 *   cd contracts-hh
 *   npx hardhat run scripts/deploy-h2o-stake-v4.js --network worldchain
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER2       = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";
const ACUA_TOKEN   = "0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd";
const OUT_FILE     = path.join(__dirname, "..", "deployed-h2o-stake-v4.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await deployer.getBalance();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy H2OStakeV4 — H2O ACUA Company Staking");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);
  console.log("  Owner2   :", OWNER2);
  console.log("  Token    :", ACUA_TOKEN);
  console.log("  Balance  :", ethers.utils.formatEther(bal), "WLD");

  console.log("\n  Compilando...");
  const Factory = await ethers.getContractFactory("H2OStakeV4");

  console.log("  Deploying H2OStakeV4...");
  const contract = await Factory.deploy(OWNER2);
  await contract.deployed();
  console.log("  ✓ H2OStakeV4:", contract.address);

  const apr = await contract.aprBps();
  console.log("  APR default:", apr.toString(), "bps =", (apr / 100).toFixed(2) + "%");

  const output = {
    deployedAt:  new Date().toISOString(),
    network:     "worldchain",
    chainId:     480,
    deployer:    deployer.address,
    owner2:      OWNER2,
    contract:    contract.address,
    token:       ACUA_TOKEN,
    aprBps:      apr.toNumber(),
    features:    "instant-withdraw, instant-claim, per-second-rewards, referrals, Permit2",
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("  ✓ Guardado en deployed-h2o-stake-v4.json");

  console.log("\n━━ SIGUIENTE PASO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fondear el contrato con tokens ACUA antes de abrir stake.");
  console.log("  Contrato:", contract.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
