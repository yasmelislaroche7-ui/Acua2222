import { ethers } from "ethers";

// ¡Pon la dirección y ABI de tu contrato viejo aquí!
export const OLD_STAKING_ADDRESS = "0x..."; // tu contrato v1
export const OLD_STAKING_ABI = [
  // ABI mínima, agrega métodos según necesidad
  "function balanceOf(address) view returns (uint256)",
  "function pending(address) view returns (uint256)",
  "function unstake()",
  "function claimRewards()"
];

// Llama al provider que uses (window.ethereum, etc.)
export function getOldStakingContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(OLD_STAKING_ADDRESS, OLD_STAKING_ABI, signerOrProvider);
}

// Obtiene balance y rewards del usuario
export async function getOldStakingInfo(address: string): Promise<{ balance: bigint, rewards: bigint }> {
  try {
    // Usa el provider público para solo lectura
    const provider = new ethers.JsonRpcProvider("https://worldchain-mainnet.g.alchemy.com/public");
    const contract = getOldStakingContract(provider);

    const [bal, rew] = await Promise.all([
      contract.balanceOf(address),
      contract.pending(address)
    ]);
    return { balance: bal as bigint, rewards: rew as bigint };
  } catch (e) {
    return { balance: 0n, rewards: 0n }; // fallback seguro
  }
}

// Retirar todo (via unstake)
export async function withdrawOld() {
  if (!(window as any).ethereum) throw new Error("Wallet no detectada");
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const contract = getOldStakingContract(signer);
  const tx = await contract.unstake();
  return tx.wait();
}

// Reclamar rewards
export async function claimOld() {
  if (!(window as any).ethereum) throw new Error("Wallet no detectada");
  const provider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await provider.getSigner();
  const contract = getOldStakingContract(signer);
  const tx = await contract.claimRewards();
  return tx.wait();
}