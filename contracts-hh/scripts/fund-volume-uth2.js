const { ethers } = require("hardhat");

// ─── CONFIG ──────────────────────────────────────
const VOLUME_REWARDS_ADDRESS = "0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48";
const UTH2_ADDRESS           = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
const FUND_AMOUNT            = "9"; // cantidad a enviar

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
];

const VOLUME_ABI = [
  "function fundUTH2(uint256 amount) external",
  "function UTH2() external view returns (address)",
  "function totalDistributed() external view returns (uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  // ─── Instancias de contratos ───────────────────
  const uth2 = new ethers.Contract(UTH2_ADDRESS, ERC20_ABI, signer);
  const rewards = new ethers.Contract(VOLUME_REWARDS_ADDRESS, VOLUME_ABI, signer);

  const amount = ethers.utils.parseEther(FUND_AMOUNT);

  // ─── Validar balance ───────────────────────────
  const bal = await uth2.balanceOf(signer.address);
  console.log("UTH2 balance:", ethers.utils.formatEther(bal));
  console.log("Funding:", FUND_AMOUNT, "UTH2");

  if (bal.lt(amount)) {
    throw new Error("No tienes suficiente UTH2 para fondear");
  }

  // ─── Approve ───────────────────────────────────
  console.log("Aprobando gasto de UTH2...");
  const approveTx = await uth2.approve(VOLUME_REWARDS_ADDRESS, amount);
  await approveTx.wait();
  console.log("✔ Approve confirmado");

  // ─── Fondear contrato ──────────────────────────
  console.log("Enviando UTH2 al contrato de rewards...");
  const fundTx = await rewards.fundUTH2(amount);
  await fundTx.wait();
  console.log("✔ Fondeado correctamente");

  // ─── Verificación final ────────────────────────
  const contractBal = await uth2.balanceOf(VOLUME_REWARDS_ADDRESS);
  console.log("Balance contrato:", ethers.utils.formatEther(contractBal), "UTH2");

  const distributed = await rewards.totalDistributed();
  console.log("Total distribuido:", ethers.utils.formatEther(distributed), "UTH2");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});