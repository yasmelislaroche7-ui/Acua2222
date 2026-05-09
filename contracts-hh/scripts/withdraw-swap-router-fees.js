// scripts/withdraw-swap-router-fees.js
// Retira las comisiones acumuladas en AcuaSwapRouterV2.
// Uso: npx hardhat run scripts/withdraw-swap-router-fees.js --network worldchain

const hre = require("hardhat");

// Router del que se retiran fees
const ROUTER = "0xA2FD6cd36a661E270FC7AdaA82D0d22f4660706d";

const TOKENS = {
  WLD:    "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
  USDC:   "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  SUSHI:  "0xab09A728E53d3d6BC438BE95eeD46Da0Bbe7FB38",
  BTCH2O: "0xEcC4dAe4DC3D359a93046bd944e9ee3421A6A484",
  WETH:   "0x4200000000000000000000000000000000000006",
  WBTC:   "0x03C7054BCB39f7b2e5B2c7AcB37583e32D70Cfa3",
  H2O:    "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d",
  UTH2:   "0x9eA8653640E22A5b69887985BB75d496dc97022a",
  AIR:    "0xDBA88118551d5Adf16a7AB943403Aea7ea06762b",
  wARS:   "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d",
};

const ROUTER_ABI = [
  "function ownerFees(address user, address token) view returns (uint256)",
  "function claimFees(address token) external",
  "function claimFeesBatch(address[] calldata tokens) external",
  "function owner() view returns (address)",
  "function feeOwners(uint256) view returns (address)",
];
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const [signer]  = await hre.ethers.getSigners();
  const provider  = hre.ethers.provider;

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Retiro comisiones AcuaSwapRouterV2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Wallet :", signer.address);
  console.log("  Router :", ROUTER);

  const router = new hre.ethers.Contract(ROUTER, ROUTER_ABI, signer);

  // Mostrar feeOwners del contrato
  console.log("\n  FeeOwners del contrato:");
  for (let i = 0; i < 3; i++) {
    try {
      const fo = await router.feeOwners(i);
      if (fo !== hre.ethers.constants.AddressZero)
        console.log(`    [${i}] ${fo}${fo.toLowerCase() === signer.address.toLowerCase() ? " ← tu wallet" : ""}`);
    } catch { break; }
  }

  const tokenAddrs = Object.values(TOKENS);
  const tokenSyms  = Object.keys(TOKENS);
  const tokensWithFees = [];

  console.log("\n  Revisando comisiones acumuladas...");

  for (let i = 0; i < tokenAddrs.length; i++) {
    const addr = tokenAddrs[i];
    const sym  = tokenSyms[i];
    try {
      const fee = await router.ownerFees(signer.address, addr);
      const t   = new hre.ethers.Contract(addr, ERC20_ABI, provider);
      let dec = 18, label = sym;
      try { dec   = await t.decimals(); } catch {}
      try { label = await t.symbol();   } catch {}

      if (!fee.isZero()) {
        console.log(`  ✓ ${sym.padEnd(7)} : ${hre.ethers.utils.formatUnits(fee, dec)} ${label}`);
        tokensWithFees.push(addr);
      } else {
        console.log(`  · ${sym.padEnd(7)} : 0`);
      }
    } catch (e) {
      console.log(`  ✖ ${sym.padEnd(7)} : error — ${e.message?.slice(0, 60)}`);
    }
  }

  if (tokensWithFees.length === 0) {
    console.log("\n  ℹ️  No hay comisiones acumuladas para este wallet en ese router.");
    console.log("     Las fees se acumulan en ownerFees[walletAddress][token].");
    return;
  }

  console.log(`\n  Reclamando comisiones de ${tokensWithFees.length} token(s)...`);
  const tx = await router.claimFeesBatch(tokensWithFees);
  console.log("  TX enviada :", tx.hash);
  await tx.wait();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅ Comisiones reclamadas");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(err => {
  console.error("\n❌ Error:", err.message || err);
  process.exitCode = 1;
});
