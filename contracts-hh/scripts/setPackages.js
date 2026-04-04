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
    { price:"0.05", yearly:"50" },
    { price:"0.1", yearly:"100" },
    { price:"0.3", yearly:"250" },
    { price:"0.5", yearly:"320" },
    { price:"1", yearly:"500" },
    { price:"5", yearly:"1500" },
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