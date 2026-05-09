// scripts/withdraw-volume-rewards.js
// Retira el UTH2 acumulado en el contrato AcuaVolumeRewardsV2 al wallet del owner.
//
// Uso:
//   cd contracts-hh
//   npx hardhat run scripts/withdraw-volume-rewards.js --network worldchain
//
// Requiere:
//   PRIVATE_KEY en .env (wallet que sea owner del contrato)

const hre = require("hardhat");
const path = require("path");
const fs   = require("fs");

// ── Dirección del contrato de volume rewards V2 ──────────────────────────────
const deployedFile = path.join(__dirname, "deployed-volume-v2.json");
const deployed     = JSON.parse(fs.readFileSync(deployedFile, "utf8"));
const VOLUME_CONTRACT = deployed.acuaVolumeRewardsV2;
const UTH2_ADDRESS    = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
// ─────────────────────────────────────────────────────────────────────────────

const VOLUME_ABI = [
  "function emergencyWithdraw(uint256 amount) external",
  "function owner() view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  const [signer]  = await hre.ethers.getSigners();
  const provider  = hre.ethers.provider;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Retiro UTH2 — AcuaVolumeRewardsV2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet        :", signer.address);
  console.log("  Contrato      :", VOLUME_CONTRACT);

  const volume = new hre.ethers.Contract(VOLUME_CONTRACT, VOLUME_ABI, signer);

  // Verificar ownership
  const ownerAddr = await volume.owner();
  if (ownerAddr.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("\n  ❌ No eres el owner del contrato.");
    console.error("     Owner   :", ownerAddr);
    console.error("     Tu wallet:", signer.address);
    process.exitCode = 1;
    return;
  }

  // Balance UTH2 en el contrato
  const uth2     = new hre.ethers.Contract(UTH2_ADDRESS, ERC20_ABI, provider);
  const decimals = await uth2.decimals();
  const symbol   = await uth2.symbol();
  const balance  = await uth2.balanceOf(VOLUME_CONTRACT);

  console.log(`\n  ${symbol} en contrato  : ${hre.ethers.utils.formatUnits(balance, decimals)}`);

  if (balance.isZero()) {
    console.log("  ✅ No hay UTH2 acumulado para retirar.");
    return;
  }

  // Balance del wallet antes
  const walletBefore = await uth2.balanceOf(signer.address);
  console.log(`  ${symbol} en tu wallet : ${hre.ethers.utils.formatUnits(walletBefore, decimals)}`);

  console.log(`\n  Retirando ${hre.ethers.utils.formatUnits(balance, decimals)} ${symbol} vía emergencyWithdraw...`);

  let tx;
  try {
    tx = await volume.emergencyWithdraw(balance);
  } catch (err) {
    const msg = (err.reason || err.message || String(err)).toLowerCase();
    if (msg.includes("revert") || msg.includes("require") || msg.includes("zero")) {
      console.log("\n  ⚠️  La transacción fue rechazada por el contrato:", err.reason || err.message);
      return;
    }
    throw err;
  }

  console.log("  TX enviada :", tx.hash);
  await tx.wait();

  const walletAfter = await uth2.balanceOf(signer.address);
  const received    = walletAfter.sub(walletBefore);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ Retiro exitoso");
  console.log(`  ${symbol} recibido     : ${hre.ethers.utils.formatUnits(received, decimals)}`);
  console.log(`  ${symbol} en wallet    : ${hre.ethers.utils.formatUnits(walletAfter, decimals)}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
