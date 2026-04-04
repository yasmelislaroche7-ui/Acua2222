const { ethers } = require("hardhat");

async function main() {

  const CONTRACT = "0xD2E227D30bC94D6FfD4eCf6b56141429C801E228";

  const abi = [
    "function setPackage(uint256 id,uint256 priceWLD,uint256 dailyYield,bool active)"
  ];

  const [signer] = await ethers.getSigners();
  console.log("Admin wallet:", signer.address);

  const contract = new ethers.Contract(CONTRACT, abi, signer);

  const packages = [
    { price:"0.01", yearly:"10" },
    { price:"0.05", yearly:"5" },
    { price:"0.01", yearly:"10" },
    { price:"0.3", yearly:"0.2" },
    { price:"0.05", yearly:"3" },
    { price:"0.01", yearly:"5" },
    { price:"0.001", yearly:"0.00008" },
  ];

  for (let i = 0; i < packages.length; i++) {

    const priceWei = ethers.utils.parseUnits(packages[i].price, 18);

    const daily = Number(packages[i].yearly) / 365;
    const dailyWei = ethers.utils.parseUnits(daily.toString(), 18);

    console.log("Configurando paquete", i);

    const tx = await contract.setPackage(i, priceWei, dailyWei, true);
    console.log("TX:", tx.hash);

    await tx.wait();
  }

  console.log("🔥 PAQUETES ACTUALIZADOS 🔥");
}

main();