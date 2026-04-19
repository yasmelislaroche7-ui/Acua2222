// scripts/withdraw-uth2.js
// Retira UTH2 acumulado en el contrato H2OVIPSubscription
// Uso: npx hardhat run scripts/withdraw-uth2.js --network worldchain

const hre = require("hardhat");

// ── Configura aquí ────────────────────────────────────────────────────────
const VIP_CONTRACT  = "0x9f65F7BEb3c56204058F59a93E8963A1068997Bc";
const UTH2_ADDRESS  = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
// Dejar en null para retirar TODO el balance disponible
const AMOUNT_TO_WITHDRAW = null;
// ─────────────────────────────────────────────────────────────────────────

const VIP_ABI = [
  "function rescueToken(address token, uint256 amount) external",
  "function owner() view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const provider = hre.ethers.provider;

  console.log("Wallet:", signer.address);
  console.log("Balance ETH:", hre.ethers.utils.formatEther(await signer.getBalance()));

  // Verificar ownership
  const vip = new hre.ethers.Contract(VIP_CONTRACT, VIP_ABI, signer);
  const owner = await vip.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(`❌ No eres el owner del contrato VIP.`);
    console.error(`   Owner: ${owner}`);
    console.error(`   Tu wallet: ${signer.address}`);
    process.exitCode = 1;
    return;
  }

  // Consultar balance de UTH2 en el contrato VIP
  const uth2 = new hre.ethers.Contract(UTH2_ADDRESS, ERC20_ABI, provider);
  const decimals = await uth2.decimals();
  const symbol   = await uth2.symbol();
  const balance  = await uth2.balanceOf(VIP_CONTRACT);

  console.log(`\n${symbol} en contrato VIP: ${hre.ethers.utils.formatUnits(balance, decimals)}`);

  if (balance.isZero()) {
    console.log("✅ No hay UTH2 en el contrato VIP para retirar.");
    return;
  }

  const amount = AMOUNT_TO_WITHDRAW
    ? hre.ethers.utils.parseUnits(AMOUNT_TO_WITHDRAW.toString(), decimals)
    : balance;

  if (amount.gt(balance)) {
    console.error(`❌ Monto solicitado (${hre.ethers.utils.formatUnits(amount, decimals)}) mayor al balance (${hre.ethers.utils.formatUnits(balance, decimals)})`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nRetirando ${hre.ethers.utils.formatUnits(amount, decimals)} ${symbol}...`);

  const tx = await vip.rescueToken(UTH2_ADDRESS, amount);
  console.log("Tx enviada:", tx.hash);
  await tx.wait();

  const newBalance = await uth2.balanceOf(VIP_CONTRACT);
  console.log(`✅ Retiro exitoso!`);
  console.log(`   ${symbol} restante en contrato: ${hre.ethers.utils.formatUnits(newBalance, decimals)}`);
  console.log(`   Recibido en tu wallet: ${hre.ethers.utils.formatUnits(amount, decimals)} ${symbol}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
