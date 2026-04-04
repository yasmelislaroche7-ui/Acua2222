const { ethers } = require("hardhat");

async function main() {

  const CONTRACT = "0xD2E227D30bC94D6FfD4eCf6b56141429C801E228";

  const abi = [
    "function setPackage(uint256 id,uint256 priceWLD,uint256 dailyYield,bool active)"
  ];

  const [signer] = await ethers.getSigners();
  const contract = new ethers.Contract(CONTRACT, abi, signer);

  // 🔥 CONFIGURA AQUI
  // price = costo del paquete en WLD
  // yearlyReward = lo que quieres que genere al año en WLD

  const packages = [
    { price: "10",   yearlyReward: "20"  }, // paquete 0
    { price: "25",   yearlyReward: "60"  }, // paquete 1
    { price: "50",   yearlyReward: "140" }, // paquete 2
    { price: "100",  yearlyReward: "320" }, // paquete 3
    { price: "250",  yearlyReward: "900" }, // paquete 4
    { price: "500",  yearlyReward: "2100"}, // paquete 5
    { price: "1000", yearlyReward: "5000"}  // paquete 6
  ];

  for (let i = 0; i < packages.length; i++) {

    const priceWei = ethers.utils.parseUnits(packages[i].price, 18);

    // anual → diario
    const dailyReward = Number(packages[i].yearlyReward) / 365;
    const dailyWei = ethers.utils.parseUnits(
      dailyReward.toFixed(18),
      18
    );

    console.log(`Configurando paquete ${i}`);
    console.log("Precio:", packages[i].price, "WLD");
    console.log("Reward anual:", packages[i].yearlyReward, "WLD");
    console.log("Reward diario:", dailyReward, "WLD");

    const tx = await contract.setPackage(
      i,
      priceWei,
      dailyWei,
      true
    );

    console.log("TX:", tx.hash);
    await tx.wait();
  }

  console.log("✅ Paquetes actualizados correctamente");
}

main();