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
    { price: "0.01", yearly: "10" },
    { price: "0.05", yearly: "5" },
    { price: "0.01", yearly: "10" },
    { price: "0.5", yearly: "0.5" },
    { price: "0.05", yearly: "3" },
    { price: "0.01", yearly: "5" },
    { price: "0.1", yearly: "0.008" }, // Este es el paquete problemático
  ];

  for (let i = 0; i < packages.length; i++) {
    // Para el precio, 18 decimales está bien ya que los precios suelen ser más 'limpios'
    const priceWei = ethers.utils.parseUnits(packages[i].price, 18);

    const yearlyNum = Number(packages[i].yearly);
    let daily = yearlyNum / 365;

    // --- SOLUCIÓN: Redondear/truncar 'daily' a una precisión manejable (ej. 18 decimales) ---
    // Usamos toFixed para limitar los decimales, luego convertimos a BigNumber
    // Math.min(18, ...) asegura que no intentemos usar más decimales de los que parseUnits acepta.
    // Aunque parseUnits ya lo limita a 18, toFixed previene el error del 'fractional component exceeds decimals'.
    const decimalsToUse = 18; // Usamos 18 decimales para los tokens ERC20 (WLD, dailyYield)
    const dailyStr = daily.toFixed(decimalsToUse); // Truncamos/redondeamos a 18 decimales
    const dailyWei = ethers.utils.parseUnits(dailyStr, decimalsToUse);

    console.log("Configurando paquete", i);
    console.log(`  Price (WLD): ${packages[i].price} -> ${priceWei.toString()} wei`);
    console.log(`  Daily Yield: ${yearlyNum} / 365 = ${daily} -> ${dailyStr} -> ${dailyWei.toString()} wei`);


    const tx = await contract.setPackage(i, priceWei, dailyWei, true);
    console.log("TX:", tx.hash);

    await tx.wait();
  }

  console.log("🔥 PAQUETES ACTUALIZADOS 🔥");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
