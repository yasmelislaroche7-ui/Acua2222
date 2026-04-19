// scripts/withdraw-uth2-vip.js
// Retira UTH2 acumulado de las suscripciones VIP del contrato H2OVIPStandalone.
//
// Uso:
//   cd contracts-hh
//   npx hardhat run scripts/withdraw-uth2-vip.js --network worldchain
//
// Requiere:
//   PRIVATE_KEY en .env (wallet que sea owner del contrato VIP)

const hre = require("hardhat");

// ── Configuración ──────────────────────────────────────────────────────────
const VIP_CONTRACT       = "0x4cA4073b15177A5c84635158Bc9D8B9698115184";
const UTH2_ADDRESS       = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
// Cantidad a retirar en UTH2 (ej: "50"). Dejar en 0 para retirar TODO.
const AMOUNT_TO_WITHDRAW = 0;
// ──────────────────────────────────────────────────────────────────────────

const VIP_ABI = [
  "function withdrawUTH2(uint256 amount) external",
  "function owner() view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  if (VIP_CONTRACT === "REEMPLAZA_CON_NUEVA_DIRECCION_VIP") {
    console.error("❌ Actualiza VIP_CONTRACT con la dirección del nuevo contrato VIP desplegado.");
    process.exitCode = 1;
    return;
  }

  const [signer] = await hre.ethers.getSigners();
  const provider  = hre.ethers.provider;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Retiro UTH2 de H2OVIPStandalone");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet      :", signer.address);
  console.log("  Contrato VIP:", VIP_CONTRACT);

  // Verificar ownership
  const vip = new hre.ethers.Contract(VIP_CONTRACT, VIP_ABI, signer);
  const ownerAddr = await vip.owner();
  if (ownerAddr.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("\n  ❌ No eres el owner del contrato VIP.");
    console.error("     Owner:", ownerAddr);
    console.error("     Tu wallet:", signer.address);
    process.exitCode = 1;
    return;
  }

  const uth2     = new hre.ethers.Contract(UTH2_ADDRESS, ERC20_ABI, provider);
  const decimals = await uth2.decimals();
  const symbol   = await uth2.symbol();
  const balance  = await uth2.balanceOf(VIP_CONTRACT);

  console.log(`\n  ${symbol} en contrato VIP: ${hre.ethers.utils.formatUnits(balance, decimals)}`);

  if (balance.isZero()) {
    console.log("  ✅ No hay UTH2 acumulado en el contrato VIP.");
    return;
  }

  const amount = AMOUNT_TO_WITHDRAW > 0
    ? hre.ethers.utils.parseUnits(AMOUNT_TO_WITHDRAW.toString(), decimals)
    : hre.ethers.BigNumber.from(0); // 0 → withdrawUTH2 retira todo

  if (amount.gt(0) && amount.gt(balance)) {
    console.error(`\n  ❌ Monto solicitado (${hre.ethers.utils.formatUnits(amount, decimals)}) mayor al balance (${hre.ethers.utils.formatUnits(balance, decimals)})`);
    process.exitCode = 1;
    return;
  }

  const displayAmt = amount.isZero()
    ? hre.ethers.utils.formatUnits(balance, decimals) + " (todo)"
    : hre.ethers.utils.formatUnits(amount, decimals);
  console.log(`\n  Retirando ${displayAmt} ${symbol}...`);

  const tx = await vip.withdrawUTH2(amount);
  console.log("  TX enviada:", tx.hash);
  await tx.wait();

  const newBalance = await uth2.balanceOf(VIP_CONTRACT);
  const walletBal  = await uth2.balanceOf(signer.address);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ Retiro UTH2 exitoso");
  console.log(`  ${symbol} restante en contrato : ${hre.ethers.utils.formatUnits(newBalance, decimals)}`);
  console.log(`  ${symbol} en tu wallet          : ${hre.ethers.utils.formatUnits(walletBal, decimals)}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
