/**
 * deploy-acua-free-claim-v2.js
 * Redeploy AcuaFreeClaim + crear pool inicial para H2O ACUA Company token
 *
 * Uso:
 *   cd contracts-hh
 *   npx hardhat run scripts/deploy-acua-free-claim-v2.js --network worldchain
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER2      = "0xc2ef127734f296952de75c1b58a6cec605cc2e59";
const ACUA_TOKEN  = "0xeC8399bC6B301D72C632F45D97C3C73D6971B7dd";
const OUT_FILE    = path.join(__dirname, "..", "deployed-acua-free-claim-v2.json");

// Pool inicial: 10 ACUA tokens por claim, cooldown 24h
const AMOUNT_PER_CLAIM = ethers.utils.parseEther("10");
const COOLDOWN         = 24 * 60 * 60; // 86400 segundos

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await deployer.getBalance();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy AcuaFreeClaim v2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);
  console.log("  Owner2   :", OWNER2);
  console.log("  Balance  :", ethers.utils.formatEther(bal), "WLD");

  console.log("\n  Compilando...");
  const Factory = await ethers.getContractFactory("AcuaFreeClaim");

  console.log("  Deploying AcuaFreeClaim...");
  const contract = await Factory.deploy(deployer.address, OWNER2);
  await contract.deployed();
  console.log("  ✓ AcuaFreeClaim:", contract.address);

  // Crear pool inicial para H2O ACUA Company token
  console.log("\n  Creando pool inicial para ACUA token...");
  const tx = await contract.addPool(
    ACUA_TOKEN,
    AMOUNT_PER_CLAIM,
    COOLDOWN,
    "H2O ACUA Company",
    "ACUA"
  );
  await tx.wait();
  const poolCount = await contract.poolCount();
  console.log("  ✓ Pool creado. Total pools:", poolCount.toString());
  console.log("  Pool 0: ACUA | 10 tokens/claim | cooldown 24h");

  const output = {
    deployedAt:  new Date().toISOString(),
    network:     "worldchain",
    chainId:     480,
    deployer:    deployer.address,
    owner2:      OWNER2,
    contract:    contract.address,
    description: "AcuaFreeClaim v2 — multi-token free claim, Permit2 funding",
    pools: [
      {
        id:            0,
        token:         ACUA_TOKEN,
        symbol:        "ACUA",
        amountPerClaim: "10",
        cooldown:      "86400 (24h)",
      },
    ],
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log("  ✓ Guardado en deployed-acua-free-claim-v2.json");

  console.log("\n━━ SIGUIENTE PASO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fondear el pool 0 con tokens ACUA antes de abrir claims.");
  console.log("  Contrato:", contract.address);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
