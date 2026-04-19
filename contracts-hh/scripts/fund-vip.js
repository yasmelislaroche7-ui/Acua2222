// scripts/fund-vip.js
// Fondea el contrato H2OVIPStandalone con H2O para pagar rewards a los VIPs.
// Los H2O se distribuyen linealmente en 365 días (rewards/segundo).
//
// Uso:
//   cd contracts-hh
//   npx hardhat run scripts/fund-vip.js --network worldchain
//
// Requiere:
//   PRIVATE_KEY en .env (wallet que sea owner del contrato VIP)

const { ethers } = require("hardhat");

// ── Configuración ──────────────────────────────────────────────────────────
const VIP_CONTRACT = "0x4cA4073b15177A5c84635158Bc9D8B9698115184";
const H2O_TOKEN    = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";
const FUND_AMOUNT  = "1000"; // H2O a depositar como rewards (ajusta según necesites)
// ──────────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const VIP_ABI = [
  "function depositRewards(uint256 amount)",
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function totalHolderShares() view returns (uint256)",
  "function vipPrice() view returns (uint256)",
  "function owner() view returns (address)",
];

async function main() {
  if (VIP_CONTRACT === "REEMPLAZA_CON_NUEVA_DIRECCION_VIP") {
    console.error("❌ Actualiza VIP_CONTRACT con la dirección del nuevo contrato VIP desplegado.");
    process.exitCode = 1;
    return;
  }

  const [signer] = await ethers.getSigners();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fondeo H2OVIPStandalone con H2O rewards");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet      :", signer.address);
  console.log("  Contrato VIP:", VIP_CONTRACT);
  console.log("  Monto       :", FUND_AMOUNT, "H2O");

  const h2o = new ethers.Contract(H2O_TOKEN, ERC20_ABI, signer);
  const vip = new ethers.Contract(VIP_CONTRACT, VIP_ABI, signer);

  // Verificar ownership
  const ownerAddr = await vip.owner();
  if (ownerAddr.toLowerCase() !== signer.address.toLowerCase()) {
    console.error("\n  ❌ No eres el owner del contrato VIP.");
    console.error("     Owner:", ownerAddr);
    console.error("     Tu wallet:", signer.address);
    process.exitCode = 1;
    return;
  }

  const decimals = await h2o.decimals();
  const amount   = ethers.utils.parseUnits(FUND_AMOUNT, decimals);
  const balance  = await h2o.balanceOf(signer.address);

  console.log("\n  Balance H2O wallet :", ethers.utils.formatUnits(balance, decimals));

  if (balance.lt(amount)) {
    console.error("\n  ❌ Balance insuficiente de H2O");
    console.error("     Tienes    :", ethers.utils.formatUnits(balance, decimals), "H2O");
    console.error("     Necesitas :", FUND_AMOUNT, "H2O");
    process.exitCode = 1;
    return;
  }

  // Estado actual del contrato VIP
  try {
    const rate    = await vip.rewardRate();
    const finish  = await vip.periodFinish();
    const holders = await vip.totalHolderShares();
    const price   = await vip.vipPrice();
    const now     = Math.floor(Date.now() / 1000);
    const active  = finish.gt(now);

    console.log("\n  Estado actual del contrato VIP:");
    console.log("  Reward rate    :", ethers.utils.formatEther(rate), "H2O/seg");
    if (!finish.isZero()) {
      console.log("  Period finish  :", new Date(finish.toNumber() * 1000).toLocaleDateString(), active ? "(ACTIVO)" : "(EXPIRADO)");
    } else {
      console.log("  Period finish  : no fondeado aún");
    }
    console.log("  VIP holders    :", holders.toString());
    console.log("  VIP price      :", ethers.utils.formatEther(price), "UTH2/mes");
  } catch {
    console.log("  (No se pudo leer estado anterior)");
  }

  // Paso 1: Aprobar H2O al contrato VIP
  console.log("\n  Paso 1/2 → Approve H2O...");
  const allowance = await h2o.allowance(signer.address, VIP_CONTRACT);
  if (allowance.lt(amount)) {
    const approveTx = await h2o.approve(VIP_CONTRACT, amount);
    console.log("  TX approve:", approveTx.hash);
    await approveTx.wait();
    console.log("  ✅ Approve confirmado");
  } else {
    console.log("  ✅ Allowance suficiente, skip approve");
  }

  // Paso 2: Depositar rewards
  console.log("\n  Paso 2/2 → depositRewards(" + FUND_AMOUNT + " H2O)...");
  const fundTx = await vip.depositRewards(amount);
  console.log("  TX depositRewards:", fundTx.hash);
  await fundTx.wait();
  console.log("  ✅ Rewards depositados");

  // Estado post-fondeo
  const newRate   = await vip.rewardRate();
  const newFinish = await vip.periodFinish();
  const SECONDS_PER_YEAR = 365 * 24 * 3600;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ FONDEO VIP COMPLETADO");
  console.log("  Nuevo reward rate :", ethers.utils.formatEther(newRate), "H2O/seg");
  console.log("  Period finish     :", new Date(newFinish.toNumber() * 1000).toLocaleDateString());

  const annualRewards = newRate.mul(SECONDS_PER_YEAR);
  console.log("  Rewards anuales   :", ethers.utils.formatEther(annualRewards), "H2O");

  const holders = await vip.totalHolderShares();
  if (holders.gt(0)) {
    const perHolderYear = annualRewards.div(holders);
    console.log("  Por holder/año    :", ethers.utils.formatEther(perHolderYear), "H2O");
  } else {
    console.log("  Holders actuales  : 0 (rewards se acumulan cuando entren compradores)");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
