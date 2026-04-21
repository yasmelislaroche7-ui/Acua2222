const { ethers } = require("hardhat");
async function main() {
  const ROUTER = "0xA2FD6cd36a661E270FC7AdaA82D0d22f4660706d";
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  const c = new ethers.Contract(ROUTER, [
    "function owner() view returns (address)",
    "function volumeRewards() view returns (address)",
    "function swapFeeBps() view returns (uint256)",
  ], signer);
  console.log("Router owner:", await c.owner());
  console.log("Router volumeRewards:", await c.volumeRewards());
  console.log("Router swapFeeBps:", (await c.swapFeeBps()).toString());

  const VOL = "0x81D9a0c80eAD28B1A7364fa73684Cc78e497FA48";
  const v = new ethers.Contract(VOL, [
    "function owner() view returns (address)",
    "function swapRouter() view returns (address)",
  ], signer);
  console.log("Volume owner:", await v.owner());
  console.log("Volume swapRouter:", await v.swapRouter());
}
main().catch(e => { console.error(e); process.exit(1); });
