// scripts/deploy-wld-v2.js
// Despliega WLDStakeV2 en World Chain.
// Uso: npx hardhat run scripts/deploy-wld-v2.js --network worldchain

const hre = require("hardhat");
const path = require("path");
const fs   = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deploy WLDStakeV2 → World Chain");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployer :", deployer.address);

  // owner2 = deployer (para fondear desde la misma wallet)
  const owner2 = deployer.address;

  const WLDStakeV2 = await hre.ethers.getContractFactory("WLDStakeV2");
  console.log("\n  Desplegando...");
  const contract = await WLDStakeV2.deploy(owner2);
  await contract.deployed();

  console.log("  ✅ Contrato desplegado:", contract.address);
  console.log("     owner  :", deployer.address);
  console.log("     owner2 :", owner2);
  console.log("     APR    : 100% (10000 bps)");
  console.log("     fee    : 5% (500 bps)");

  // Guardar dirección — en dos rutas: scripts/ y la raíz contracts-hh/
  const payload = {
    contract:    contract.address,
    owner2:      owner2,
    deployer:    deployer.address,
    network:     "worldchain",
    chainId:     480,
    deployedAt:  new Date().toISOString(),
  };
  const json = JSON.stringify(payload, null, 2);
  const scriptsOut = path.join(__dirname, "deployed-wld-v2.json");
  const rootOut    = path.join(__dirname, "..", "deployed-wld-v2.json");
  fs.writeFileSync(scriptsOut, json);
  fs.writeFileSync(rootOut,    json);
  console.log("\n  Guardado en contracts-hh/scripts/deployed-wld-v2.json");
  console.log("  Guardado en contracts-hh/deployed-wld-v2.json");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(err => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
