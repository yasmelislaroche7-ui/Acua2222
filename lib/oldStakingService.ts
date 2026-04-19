// lib/oldStakingService.ts

import { ethers } from 'ethers';
import { MiniKit } from '@worldcoin/minikit-js';
import { STAKING_CONTRACT, StakeInfo } from './contract'; // Asumiendo que STAKING_CONTRACT es la dirección del contrato antiguo
import { OLD_STAKING_ABI } from './h2oStaking'; // ABI del contrato antiguo

// Define las interfaces si no están en contract.ts
// interface StakeInfo {
//     stakedAmount: bigint;
//     pending: bigint;
//     // ... otras propiedades de tu stake antiguo
// }

export class OldStakingService {
    private provider: ethers.Provider;
    private signer: ethers.Signer | null = null;
    private oldStakingContract: ethers.Contract;

    constructor(provider: ethers.Provider, signer: ethers.Signer | null) {
        this.provider = provider;
        this.signer = signer;
        this.oldStakingContract = new ethers.Contract(STAKING_CONTRACT, OLD_STAKING_ABI, signer || provider);
    }

    // Puedes agregar una función para obtener el stakeInfo del contrato antiguo si es necesario
    // async getOldStakeInfo(userAddress: string): Promise<StakeInfo | null> {
    //     // Implementa la lógica para leer el estado del contrato antiguo
    //     // Esto dependerá de cómo tu contrato antiguo expone la información del stake
    //     try {
    //         const balance = await this.oldStakingContract.users(userAddress).balance;
    //         const pending = await this.oldStakingContract.earned(userAddress);
    //         return {
    //             stakedAmount: balance,
    //             pending: pending,
    //             // ... otras propiedades
    //             active: balance > 0n // Ejemplo de cómo determinar si hay stake
    //         };
    //     } catch (error) {
    //         console.error("Error fetching old stake info:", error);
    //         return null;
    //     }
    // }

    async unstakeOld(): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");

        try {
            const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: STAKING_CONTRACT,
                    abi: OLD_STAKING_ABI, // Usa el ABI que contenga la función 'unstake' del contrato antiguo
                    functionName: 'unstake',
                    args: [], // Asumiendo que 'unstake' en el contrato antiguo no requiere argumentos o retira todo
                }],
            });

            if (finalPayload.status === 'success') {
                return (finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((finalPayload as any).message ?? 'Transacción de retiro fallida del contrato antiguo');
            }
        } catch (error: any) {
            console.error("[OldStakingService] ERROR unstaking from old contract:", error);
            throw new Error(error?.message ?? 'Error desconocido al retirar del contrato antiguo');
        }
    }

    async claimRewardsOld(): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");

        try {
            const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: STAKING_CONTRACT,
                    abi: OLD_STAKING_ABI, // Usa el ABI que contenga la función 'claimRewards' del contrato antiguo
                    functionName: 'claimRewards',
                    args: [],
                }],
            });

            if (finalPayload.status === 'success') {
                return (finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((finalPayload as any).message ?? 'Transacción de reclamo fallida del contrato antiguo');
            }
        } catch (error: any) {
            console.error("[OldStakingService] ERROR claiming rewards from old contract:", error);
            throw new Error(error?.message ?? 'Error desconocido al reclamar del contrato antiguo');
        }
    }
}
