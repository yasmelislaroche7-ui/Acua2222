import { Contract, parseUnits } from "ethers";
import { H2O_STAKING_ADDRESS, H2O_STAKING_ABI } from "../lib/h2oStaking";

async function getContract() {
  const signer = await getSigner();
  return new Contract(H2O_STAKING_ADDRESS, H2O_STAKING_ABI, signer);
}

// Registrar referido
export async function registerReferrer(ref: string) {
  const contract = await getContract();
  const tx = await contract.registerReferrer(ref);
  return tx.wait();
}

// Comprar VIP
export async function buyVIP(months: number) {
  const contract = await getContract();
  const tx = await contract.buyVIP(months);
  return tx.wait();
}

// Reclamar rewards staking
export async function claimRewards() {
  const contract = await getContract();
  const tx = await contract.claimRewards();
  return tx.wait();
}

// Reclamar rewards referidos
export async function claimRefRewards() {
  const contract = await getContract();
  const tx = await contract.claimRefRewards();
  return tx.wait();
}

// Ver rewards pendientes
export async function getMyRewards(address: string) {
  const contract = await getContract();
  return await contract.earned(address);
}

// Unstake
export async function unstake(amount: string) {
  const contract = await getContract();
  const tx = await contract.unstake(parseUnits(amount, 18));
  return tx.wait();
}