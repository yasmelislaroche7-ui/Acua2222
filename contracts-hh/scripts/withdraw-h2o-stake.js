// scripts/withdraw-h2o-stake.js
// Reclama las comisiones H2O acumuladas en el contrato de stake H2O V2.
//
// Las comisiones provienen del fee de reclamo (10% de cada claimRewards):
//   - 5% → pool de referidos
//   - 5% → pool VIP del stake (ownerVipPool) ← esto es lo que reclamamos aquí
//
// Función del contrato: claimOwnerVip()
//   Requiere que tu wallet tenga ownerShares > 0 en el staking contract.
//
// Uso:
//   cd contracts-hh
//   npx hardhat run scripts/withdraw-h2o-stake.js --network worldchain
//
// Requiere:
//   PRIVATE_KEY en .env (wallet con ownerShares en el staking contract)

const hre = require("hardhat");

// ── Configuración ──────────────────────────────────────────────────────────
const H2O_STAKING = "0x7730583E492D520CcBb3C06325A77EccAbAFa98e";
const H2O_TOKEN   = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";
// ──────────────────────────────────────────────────────────────────────────

const STAKING_ABI = [
  "function claimOwnerVip() external",
  "function ownerShares(address) view returns (uint256)",
  "function ownerVipPerShare() view returns (uint256)",
  "function ownerVipDebt(address) view returns (uint256)",
  "function totalOwnerVipShares() view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const [signer] = await hre.ethers.getSigners();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Retiro comisiones H2O del Stake V2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet     :", signer.address);
  console.log("  Contrato   :", H2O_STAKING);

  const staking = new hre.ethers.Contract(H2O_STAKING, STAKING_ABI, signer);
  const h2o     = new hre.ethers.Contract(H2O_TOKEN, ERC20_ABI, hre.ethers.provider);

  const decimals = await h2o.decimals();

  // Verificar ownerShares
  const shares      = await staking.ownerShares(signer.address);
  const totalShares = await staking.totalOwnerVipShares();

  console.log("\n  ownerShares tu wallet :", shares.toString());
  console.log("  totalOwnerVipShares   :", totalShares.toString());

  if (shares.isZero()) {
    console.error("\n  ❌ Tu wallet no tiene ownerShares en el contrato de stake.");
    console.error("     Solo el owner original y wallets con shares pueden reclamar.");
    process.exitCode = 1;
    return;
  }

  // Calcular pendiente aproximado
  try {
    const perShare = await staking.ownerVipPerShare();
    const debt     = await staking.ownerVipDebt(signer.address);
    if (perShare.gt(debt)) {
      const pending = shares.mul(perShare.sub(debt)).div(hre.ethers.utils.parseEther("1"));
      console.log("  Comisiones pendientes :", hre.ethers.utils.formatUnits(pending, decimals), "H2O (aprox.)");
    } else {
      console.log("  Comisiones pendientes : 0 H2O (puede que no haya habido claims aún)");
    }
  } catch {
    console.log("  (No se pudo calcular pendiente exacto)");
  }

  // Balance H2O antes
  const balBefore = await h2o.balanceOf(signer.address);
  console.log("  Balance H2O antes     :", hre.ethers.utils.formatUnits(balBefore, decimals));

  // Reclamar comisiones
  console.log("\n  Llamando claimOwnerVip()...");
  let tx;
  try {
    tx = await staking.claimOwnerVip();
  } catch (err) {
    const msg = (err.reason || err.message || String(err)).toLowerCase();
    if (msg.includes("nothing") || msg.includes("require") || msg.includes("revert")) {
      console.log("\n  ⚠️  No hay comisiones para reclamar en este momento.");
      console.log("     Las comisiones se acumulan cuando los stakers llamen claimRewards().");
      return;
    }
    throw err;
  }

  console.log("  TX enviada:", tx.hash);
  await tx.wait();

  // Balance H2O después
  const balAfter  = await h2o.balanceOf(signer.address);
  const received  = balAfter.sub(balBefore);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ Comisiones reclamadas");
  console.log("  H2O recibido :", hre.ethers.utils.formatUnits(received, decimals));
  console.log("  Balance final:", hre.ethers.utils.formatUnits(balAfter, decimals), "H2O");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
