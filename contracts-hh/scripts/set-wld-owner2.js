// scripts/set-wld-owner2.js
// Cambia el owner2 del contrato WLDStakeV2 ya desplegado en World Chain.
// Uso: npx hardhat run scripts/set-wld-owner2.js --network worldchain
//
// Requiere PRIVATE_KEY = clave del owner (deployer) del contrato.

const hre  = require("hardhat");
const path = require("path");
const fs   = require("fs");

const NEW_OWNER2 = "0x5474c309e985c6b4fc623acf01ade604da781e52";

const SET_OWNER2_ABI = [
  "function owner() view returns (address)",
  "function owner2() view returns (address)",
  "function setOwner2(address _owner2) external",
];

async function main() {
  const deployed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-wld-v2.json"), "utf8")
  );
  const contractAddr = deployed.contract;

  const [signer] = await hre.ethers.getSigners();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  setOwner2 → WLDStakeV2  (World Chain)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Firmante  :", signer.address);
  console.log("  Contrato  :", contractAddr);
  console.log("  Nuevo owner2:", NEW_OWNER2);

  const contract = new hre.ethers.Contract(contractAddr, SET_OWNER2_ABI, signer);

  const currentOwner  = await contract.owner();
  const currentOwner2 = await contract.owner2();
  console.log("\n  owner actual :", currentOwner);
  console.log("  owner2 actual:", currentOwner2);

  if (signer.address.toLowerCase() !== currentOwner.toLowerCase()) {
    throw new Error(`El firmante (${signer.address}) no es el owner (${currentOwner}). Solo el owner puede cambiar owner2.`);
  }

  if (currentOwner2.toLowerCase() === NEW_OWNER2.toLowerCase()) {
    console.log("\n  ✅ owner2 ya es la dirección correcta. Nada que hacer.");
    return;
  }

  console.log("\n  Enviando setOwner2...");
  const tx = await contract.setOwner2(NEW_OWNER2);
  console.log("  TX hash:", tx.hash);
  await tx.wait();
  console.log("  ✅ Confirmado en World Chain");

  // Verificar
  const newOwner2 = await contract.owner2();
  console.log("  owner2 nuevo:", newOwner2);

  // Actualizar deployed-wld-v2.json con el nuevo owner2
  deployed.owner2 = NEW_OWNER2;
  deployed.owner2UpdatedAt = new Date().toISOString();
  const json = JSON.stringify(deployed, null, 2);
  const rootOut    = path.join(__dirname, "..", "deployed-wld-v2.json");
  const scriptsOut = path.join(__dirname, "deployed-wld-v2.json");
  fs.writeFileSync(rootOut,    json);
  fs.writeFileSync(scriptsOut, json);
  console.log("\n  Guardado en deployed-wld-v2.json");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(err => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
