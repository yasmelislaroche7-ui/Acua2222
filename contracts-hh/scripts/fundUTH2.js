const { ethers } = require("hardhat");

async function main() {

  const CONTRACT = "0xbCF03E16F9114396A849053cb1555aAE744522e6";
  const H2O = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";

  const [signer] = await ethers.getSigners();
  console.log("Admin:", signer.address);

  const erc20Abi = [
    "function transfer(address to,uint256 amount) returns(bool)"
  ];

  const token = new ethers.Contract(H2O, erc20Abi, signer);

  // cantidad a fondear (cambia si quieres)
  const amount = ethers.utils.parseUnits("5000", 18);

  const tx = await token.transfer(CONTRACT, amount);

  console.log("Fondeando contrato...");
  console.log("TX:", tx.hash);

  await tx.wait();
  console.log("Contrato UTH2 fondeado con H2O 💧");
}

main();