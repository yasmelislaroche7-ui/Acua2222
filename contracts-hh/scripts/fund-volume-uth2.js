const { ethers } = require("hardhat");

// ─── CONFIG — fill these before running ──────────────────────────────────────
const VOLUME_REWARDS_ADDRESS = "0x0000000000000000000000000000000000000000"; // <-- fill after deploy
const UTH2_ADDRESS           = "0x9eA8653640E22A5b69887985BB75d496dc97022a";
const FUND_AMOUNT            = "9"; // UTH2 to send (edit as needed)

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
  console.log("Signer  :", signer.address);

  if (VOLUME_REWARDS_ADDRESS === "0x0000000000000000000000000000000000000000") {
    throw new Error("Set VOLUME_REWARDS_ADDRESS first!");
  }

  const uth2     = new ethers.Contract(UTH2_ADDRESS, ERC20_ABI, signer);
  const rewards  = new ethers.Contract(VOLUME_REWARDS_ADDRESS, VOLUME_ABI, signer);

  const amount = ethers.utils.parseEther(FUND_AMOUNT);
  const bal    = await uth2.balanceOf(signer.address);
  console.log("UTH2 balance  :", ethers.utils.formatEther(bal));
  console.log("Funding amount:", FUND_AMOUNT, "UTH2");

  if (bal.lt(amount)) throw new Error("Insufficient UTH2 balance");

  // 1. Approve
  console.log("\nApproving AcuaVolumeRewards to spend UTH2…");
  const approveTx = await uth2.approve(VOLUME_REWARDS_ADDRESS, amount);
  await approveTx.wait();
  console.log("✓ Approved");

  // 2. Fund
  console.log("Sending UTH2 to AcuaVolumeRewards…");
  const fundTx = await rewards.fundUTH2(amount);
  await fundTx.wait();
  console.log("✓ Funded:", FUND_AMOUNT, "UTH2");

  // 3. Check contract balance
  const contractBal = await uth2.balanceOf(VOLUME_REWARDS_ADDRESS);
  console.log("Contract UTH2 balance:", ethers.utils.formatEther(contractBal));
  const distributed = await rewards.totalDistributed();
  console.log("Total distributed so far:", ethers.utils.formatEther(distributed), "UTH2");
}

main().catch(e => { console.error(e); process.exit(1) });
