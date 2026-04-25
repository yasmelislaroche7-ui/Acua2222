/**
 * fund-h2o-staking.js
 * Fondea el contrato H2O Staking V2 con H2O tokens via depositRewards()
 *
 * Uso:
 *   cd contracts-hh
 *   npx hardhat run scripts/fund-h2o-staking.js --network worldchain
 *
 * Requiere:
 *   PRIVATE_KEY en .env o hardhat.config.js (wallet que sea owner del contrato)
 */

const { ethers } = require("hardhat");

// ── Configuración ─────────────────────────────────────────────────────────
const H2O_STAKING = "0x7730583E492D520CcBb3C06325A77EccAbAFa98e";
const H2O_TOKEN   = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";
const FUND_AMOUNT = "4000000"; // H2O a depositar como rewards

// ── ABIs mínimos ──────────────────────────────────────────────────────────
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const STAKING_ABI = [
  "function depositRewards(uint256 amount)",
  "function rewardRate() view returns (uint256)",
  "function periodFinish() view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function owners(uint256) view returns (address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Fondeo H2O Staking V2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet      :", signer.address);
  console.log("  Contrato    :", H2O_STAKING);
  console.log("  Token H2O   :", H2O_TOKEN);
  console.log("  Monto       :", FUND_AMOUNT, "H2O");

  const h2o     = new ethers.Contract(H2O_TOKEN,   ERC20_ABI,   signer);
  const staking = new ethers.Contract(H2O_STAKING, STAKING_ABI, signer);

  // ── Verificar balance ─────────────────────────────────────────────────
  const decimals = await h2o.decimals();
  const amount   = ethers.utils.parseUnits(FUND_AMOUNT, decimals);
  const balance  = await h2o.balanceOf(signer.address);

  console.log("\n  Balance H2O wallet:", ethers.utils.formatUnits(balance, decimals));

  if (balance.lt(amount)) {
    console.error("\n  ❌ Balance insuficiente de H2O");
    console.error(`     Tienes:     ${ethers.utils.formatUnits(balance, decimals)} H2O`);
    console.error(`     Necesitas:  ${FUND_AMOUNT} H2O`);
    process.exit(1);
  }

  // ── Verificar estado actual del contrato ──────────────────────────────
  try {
    const rate    = await staking.rewardRate();
    const finish  = await staking.periodFinish();
    const staked  = await staking.totalStaked();
    const now     = Math.floor(Date.now() / 1000);
    const isActive = finish.gt(now);

    console.log("\n  Estado actual del contrato:");
    console.log("  Reward rate    :", ethers.utils.formatEther(rate), "H2O/seg");
    console.log("  Period finish  :", new Date(finish.toNumber() * 1000).toLocaleDateString(), isActive ? "(ACTIVO)" : "(EXPIRADO)");
    console.log("  Total staked   :", ethers.utils.formatEther(staked), "H2O");
    if (staked.gt(0) && rate.gt(0)) {
      const SECONDS_PER_YEAR = 365 * 24 * 3600;
      const apy = rate.mul(SECONDS_PER_YEAR).mul(10000).div(staked);
      console.log("  APY actual     :", (apy.toNumber() / 100).toFixed(2) + "%");
    }
  } catch (e) {
    console.log("  (No se pudo leer estado anterior)");
  }

  // ── Aprobar H2O al contrato ───────────────────────────────────────────
  console.log("\n  Paso 1/2 → Approve H2O...");
  const currentAllowance = await h2o.allowance(signer.address, H2O_STAKING);
  if (currentAllowance.lt(amount)) {
    const approveTx = await h2o.approve(H2O_STAKING, amount);
    console.log("  TX approve:", approveTx.hash);
    await approveTx.wait();
    console.log("  ✅ Approve confirmado");
  } else {
    console.log("  ✅ Allowance suficiente, skip approve");
  }

  // ── Depositar rewards ─────────────────────────────────────────────────
  console.log("\n  Paso 2/2 → depositRewards(" + FUND_AMOUNT + " H2O)...");
  const fundTx = await staking.depositRewards(amount);
  console.log("  TX depositRewards:", fundTx.hash);
  await fundTx.wait();
  console.log("  ✅ Rewards depositados");

  // ── Verificar nuevo estado ────────────────────────────────────────────
  const newRate   = await staking.rewardRate();
  const newFinish = await staking.periodFinish();
  const nowSecs   = Math.floor(Date.now() / 1000);
  const SECONDS_PER_YEAR = 365 * 24 * 3600;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ FONDEO COMPLETADO");
  console.log("  Nuevo reward rate :", ethers.utils.formatEther(newRate), "H2O/seg");
  console.log("  Period finish     :", new Date(newFinish.toNumber() * 1000).toLocaleDateString());

  const totalStaked = await staking.totalStaked();
  if (totalStaked.gt(0)) {
    const apyNew = newRate.mul(SECONDS_PER_YEAR).mul(10000).div(totalStaked);
    console.log("  APY calculado     :", (apyNew.toNumber() / 100).toFixed(2) + "%");
    console.log("  (APY cambia al entrar más stakers)");
  } else {
    const annualRewards = newRate.mul(SECONDS_PER_YEAR);
    console.log("  Rewards anuales   :", ethers.utils.formatEther(annualRewards), "H2O");
    console.log("  APY depende del total stakeado");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
