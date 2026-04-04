const { ethers } = require("hardhat");
const { CONTRACT } = require("./config");

async function main() {

  const [signer] = await ethers.getSigners();

  // 👉 TOKEN H2O
  const H2O = "0x17392e5483983945dEB92e0518a8F2C4eB6bA59d";

  const erc20Abi = [
    "function transfer(address to,uint256 amount) returns(bool)",
    "function decimals() view returns(uint8)"
  ];

  const token = new ethers.Contract(H2O, erc20Abi, signer);

const amount = ethers.utils.parseUnits("50000", 18); // cantidad a fondear

  const tx = await token.transfer(CONTRACT, amount);

  console.log("Fondeando contrato con H2O...");
  console.log("TX:", tx.hash);

  await tx.wait();

  console.log("Contrato fondeado con H2O 💧");
}

main();