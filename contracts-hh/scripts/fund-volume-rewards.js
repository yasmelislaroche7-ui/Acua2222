// scripts/fund-volume-rewards.js
// Deposita UTH2 al contrato AcuaVolumeRewardsV2 (fundUTH2).
// Uso: npx hardhat run scripts/fund-volume-rewards.js --network worldchain

const hre = require("hardhat");
const path = require("path");
const fs   = require("fs");

const deployedFile = path.join(__dirname, "deployed-volume-v2.json");
const deployed     = JSON.parse(fs.readFileSync(deployedFile, "utf8"));
const VOLUME_CONTRACT = deployed.acuaVolumeRewardsV2;
const UTH2_ADDRESS    = "0x9eA8653640E22A5b69887985BB75d496dc97022a";

// ── Ajusta la cantidad a depositar ─────────────────────────────────────────
const AMOUNT_STR = "90"; // UTH2
// ──────────────────────────────────────────────────────────────────────────

const VOLUME_ABI = [
  "function fundUTH2(uint256 amount) external",
  "function owner() view returns (address)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  const [signer]  = await hre.ethers.getSigners();
  const provider  = hre.ethers.provider;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fund AcuaVolumeRewardsV2 con UTH2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet   :", signer.address);
  console.log("  Contrato :", VOLUME_CONTRACT);

  const uth2   = new hre.ethers.Contract(UTH2_ADDRESS, ERC20_ABI, signer);
  const volume = new hre.ethers.Contract(VOLUME_CONTRACT, VOLUME_ABI, signer);

  const decimals = await uth2.decimals();
  const symbol   = await uth2.symbol();
  const balance  = await uth2.balanceOf(signer.address);
  const AMOUNT   = hre.ethers.utils.parseUnits(AMOUNT_STR, decimals);

  console.log(`\n  ${symbol} en tu wallet  : ${hre.ethers.utils.formatUnits(balance, decimals)}`);
  console.log(`  A depositar        : ${AMOUNT_STR} ${symbol}`);

  if (balance.lt(AMOUNT)) {
    console.error(`\n  ❌ Balance insuficiente.`);
    process.exitCode = 1;
    return;
  }

  // Aprobar si hace falta
  const allowance = await uth2.allowance(signer.address, VOLUME_CONTRACT);
  if (allowance.lt(AMOUNT)) {
    console.log(`\n  Aprobando ${AMOUNT_STR} ${symbol}...`);
    const approveTx = await uth2.approve(VOLUME_CONTRACT, AMOUNT);
    console.log("  Approve TX :", approveTx.hash);
    await approveTx.wait();
    console.log("  ✓ Aprobado");
  } else {
    console.log("\n  ✓ Allowance ya suficiente");
  }

  // Fondear
  console.log(`\n  Depositando ${AMOUNT_STR} ${symbol} a volume rewards...`);
  const tx = await volume.fundUTH2(AMOUNT);
  console.log("  Fund TX    :", tx.hash);
  await tx.wait();

  const newBal = await uth2.balanceOf(VOLUME_CONTRACT);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ✅ Depósito exitoso`);
  console.log(`  ${symbol} en contrato  : ${hre.ethers.utils.formatUnits(newBal, decimals)}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(err => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
