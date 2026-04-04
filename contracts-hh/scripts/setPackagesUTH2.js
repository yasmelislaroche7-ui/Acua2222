const { ethers } = require("hardhat");

async function main() {

  const CONTRACT = "0xbCF03E16F9114396A849053cb1555aAE744522e6";

  const abi = [
    "function setPackage(uint256 id,uint256 priceUTH2,uint256 dailyYield,bool active)"
  ];

  const [signer] = await ethers.getSigners();
  console.log("Admin wallet:", signer.address);

  const contract = new ethers.Contract(CONTRACT, abi, signer);

  const packages = [
    { price:"0.001", yearly:"1" },
    { price:"0.005", yearly:"5" },
    { price:"0.01", yearly:"10" },
    { price:"0.03", yearly:"25" },
    { price:"0.05", yearly:"32" },
    { price:"0.1", yearly:"50" },
    { price:"1", yearly:"150" },
  ];

  for (let i = 0; i < packages.length; i++) {

    const priceWei = ethers.utils.parseUnits(packages[i].price, 18);

    const daily = Number(packages[i].yearly) / 365;
    const dailyWei = ethers.utils.parseUnits(daily.toFixed(18), 18);

    console.log("Configurando paquete", i);

    const tx = await contract.setPackage(i, priceWei, dailyWei, true);
    console.log("TX:", tx.hash);

    await tx.wait();
  }

  console.log("🔥 PAQUETES UTH2 LISTOS 🔥");
}

main();