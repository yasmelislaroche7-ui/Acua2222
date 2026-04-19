// lib/stakingService.ts

import { ethers } from 'ethers';
import { MiniKit } from '@worldcoin/minikit-js';
import { H2O_TOKEN, WLD_TOKEN, PERMIT_TUPLE_INPUT } from './contract'; // Tokens y Permit2 config
import { NEW_STAKING_ABI } from './h2oStaking'; // ABI del nuevo contrato

// Asume que NEW_STAKING_CONTRACT_ADDRESS se define en contract.ts o es pasado al constructor
// const NEW_STAKING_CONTRACT_ADDRESS = "0x...";

// Helper para generar el payload de Permit2 (si aún se usa en el nuevo contrato)
function randomNonce(): bigint {
    const arr = new Uint32Array(2)
    crypto.getRandomValues(arr)
    return BigInt(arr[0]) * 65536n + BigInt(arr[1] & 0xffff)
}

function buildPermit2Payload(token: string, parsedAmount: bigint, spenderAddress: string) {
    const deadline = Math.floor(Date.now() / 1000) + 1800
    const nonce = randomNonce()
    const permitArg = {
        permitted: { token, amount: parsedAmount.toString() },
        nonce: nonce.toString(),
        deadline: deadline.toString(),
    }
    const permit2Entry = {
        permitted: { token, amount: parsedAmount.toString() },
        spender: spenderAddress,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
    }
    return { permitArg, permit2Entry }
}


export class StakingService {
    private provider: ethers.Provider;
    private signer: ethers.Signer | null = null;
    private newStakingContract: ethers.Contract;
    private newStakingContractAddress: string;

    constructor(provider: ethers.Provider, signer: ethers.Signer | null, newStakingContractAddress: string) {
        this.provider = provider;
        this.signer = signer;
        this.newStakingContractAddress = newStakingContractAddress;
        this.newStakingContract = new ethers.Contract(this.newStakingContractAddress, NEW_STAKING_ABI, signer || provider);
    }

    // Funciones de consulta para el nuevo contrato (lectura)
    async getUserStakeInfo(userAddress: string): Promise<any> { // Ajusta 'any' a una interfaz más específica
        try {
            const userInfo = await this.newStakingContract.users(userAddress);
            const earnedRewards = await this.newStakingContract.earned(userAddress);
            return {
                balance: userInfo.balance,
                rewardDebt: userInfo.rewardDebt,
                pending: earnedRewards,
                // Puedes agregar más datos si el contrato los expone
                vipExpire: await this.newStakingContract.vipExpire(userAddress),
                referrerOf: await this.newStakingContract.referrerOf(userAddress),
            };
        } catch (error) {
            console.error("Error fetching new stake info:", error);
            return null;
        }
    }

    // Funciones de escritura para el nuevo contrato

    async stakeH2O(amount: string): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");
        const parsedAmount = ethers.parseUnits(amount, 18); // Asumiendo 18 decimales para H2O

        const { permitArg, permit2Entry } = buildPermit2Payload(H2O_TOKEN, parsedAmount, this.newStakingContractAddress);

        try {
            const result = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: this.newStakingContractAddress,
                    abi: NEW_STAKING_ABI, // Asegúrate de que este ABI contenga la función 'stake'
                    functionName: 'stake',
                    args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'], // La firma de Permit2 se gestiona automáticamente por MiniKit
                }],
                permit2: [permit2Entry],
            });

            if (result.finalPayload.status === 'success') {
                return (result.finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((result.finalPayload as any).message ?? 'Transacción de staking H2O fallida en V2');
            }
        } catch (error: any) {
            console.error("[StakingService] ERROR staking H2O in V2:", error);
            throw new Error(error?.message ?? 'Error desconocido al stakear H2O en V2');
        }
    }

    async buyAndStakeWLD(amount: string): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");
        const parsedAmount = ethers.parseUnits(amount, 18); // Asumiendo 18 decimales para WLD

        const { permitArg, permit2Entry } = buildPermit2Payload(WLD_TOKEN, parsedAmount, this.newStakingContractAddress);

        try {
            const result = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: this.newStakingContractAddress,
                    abi: NEW_STAKING_ABI, // Asegúrate de que este ABI contenga la función 'buyAndStake'
                    functionName: 'buyAndStake',
                    args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0', '0'], // '0' para amountOutMin (sin slippage guard en UI)
                }],
                permit2: [permit2Entry],
            });

            if (result.finalPayload.status === 'success') {
                return (result.finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((result.finalPayload as any).message ?? 'Transacción de compra y staking WLD fallida en V2');
            }
        } catch (error: any) {
            console.error("[StakingService] ERROR buying and staking WLD in V2:", error);
            throw new Error(error?.message ?? 'Error desconocido al comprar y stakear WLD en V2');
        }
    }

    async addStakeH2O(amount: string): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");
        const parsedAmount = ethers.parseUnits(amount, 18);

        const { permitArg, permit2Entry } = buildPermit2Payload(H2O_TOKEN, parsedAmount, this.newStakingContractAddress);

        try {
            const result = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: this.newStakingContractAddress,
                    abi: NEW_STAKING_ABI,
                    functionName: 'addStake', // Asegúrate de que este ABI contenga la función 'addStake'
                    args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0'],
                }],
                permit2: [permit2Entry],
            });

            if (result.finalPayload.status === 'success') {
                return (result.finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((result.finalPayload as any).message ?? 'Transacción de añadir stake H2O fallida en V2');
            }
        } catch (error: any) {
            console.error("[StakingService] ERROR adding stake H2O in V2:", error);
            throw new Error(error?.message ?? 'Error desconocido al añadir stake H2O en V2');
        }
    }

    async addStakeWithBuyWLD(amount: string): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");
        const parsedAmount = ethers.parseUnits(amount, 18);

        const { permitArg, permit2Entry } = buildPermit2Payload(WLD_TOKEN, parsedAmount, this.newStakingContractAddress);

        try {
            const result = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: this.newStakingContractAddress,
                    abi: NEW_STAKING_ABI,
                    functionName: 'addStakeWithBuy', // Asegúrate de que este ABI contenga la función 'addStakeWithBuy'
                    args: [permitArg, 'PERMIT2_SIGNATURE_PLACEHOLDER_0', '0'],
                }],
                permit2: [permit2Entry],
            });

            if (result.finalPayload.status === 'success') {
                return (result.finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((result.finalPayload as any).message ?? 'Transacción de añadir stake con compra WLD fallida en V2');
            }
        } catch (error: any) {
            console.error("[StakingService] ERROR adding stake with buy WLD in V2:", error);
            throw new Error(error?.message ?? 'Error desconocido al añadir stake con compra WLD en V2');
        }
    }

    async unstake(amount: string): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");
        const parsedAmount = ethers.parseUnits(amount, 18); // Cantidad a retirar

        try {
            const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: this.newStakingContractAddress,
                    abi: NEW_STAKING_ABI, // Asegúrate de que este ABI contenga la función 'unstake'
                    functionName: 'unstake',
                    args: [parsedAmount],
                }],
            });

            if (finalPayload.status === 'success') {
                return (finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((finalPayload as any).message ?? 'Transacción de retiro fallida en V2');
            }
        } catch (error: any) {
            console.error("[StakingService] ERROR unstaking in V2:", error);
            throw new Error(error?.message ?? 'Error desconocido al retirar en V2');
        }
    }

    async claimRewards(): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");

        try {
            const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: this.newStakingContractAddress,
                    abi: NEW_STAKING_ABI, // Asegúrate de que este ABI contenga la función 'claimRewards'
                    functionName: 'claimRewards',
                    args: [],
                }],
            });

            if (finalPayload.status === 'success') {
                return (finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((finalPayload as any).message ?? 'Transacción de reclamo fallida en V2');
            }
        } catch (error: any) {
            console.error("[StakingService] ERROR claiming rewards in V2:", error);
            throw new Error(error?.message ?? 'Error desconocido al reclamar en V2');
        }
    }

    async registerReferrer(refAddress: string): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");

        try {
            const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
                transaction: [{
                    address: this.newStakingContractAddress,
                    abi: NEW_STAKING_ABI,
                    functionName: 'registerReferrer',
                    args: [refAddress],
                }],
            });

            if (finalPayload.status === 'success') {
                return (finalPayload as any).transaction_id ?? 'ok';
            } else {
                throw new Error((finalPayload as any).message ?? 'Registro de referido fallido en V2');
            }
        } catch (error: any) {
            console.error("[StakingService] ERROR registering referrer in V2:", error);
            throw new Error(error?.message ?? 'Error desconocido al registrar referido en V2');
        }
    }

    async buyVIP(months: number): Promise<string> {
        if (!this.signer) throw new Error("No signer available for transaction.");

        try {
            
