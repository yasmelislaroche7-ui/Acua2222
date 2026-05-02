import { ethers } from 'ethers'

export type NetworkId = 'wld' | 'bnb' | 'polygon'

export interface NetworkConfig {
  id: NetworkId
  name: string
  shortName: string
  chainId: number
  rpc: string
  nativeSymbol: string
  nativeDecimals: number
  color: string
  gradient: string
  logoUrl: string
  explorerUrl: string
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  wld: {
    id: 'wld',
    name: 'World Chain',
    shortName: 'WLD',
    chainId: 480,
    rpc: 'https://worldchain-mainnet.g.alchemy.com/public',
    nativeSymbol: 'WLD',
    nativeDecimals: 18,
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg,#1d4ed8,#2563eb)',
    logoUrl: 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
    explorerUrl: 'https://worldscan.org',
  },
  bnb: {
    id: 'bnb',
    name: 'BNB Chain',
    shortName: 'BNB',
    chainId: 56,
    rpc: 'https://bnb-mainnet.g.alchemy.com/v2/bVo646pb8L7_W_nahCoqW',
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    color: '#f0b90b',
    gradient: 'linear-gradient(135deg,#c88a05,#f0b90b)',
    logoUrl: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    explorerUrl: 'https://bscscan.com',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    shortName: 'POL',
    chainId: 137,
    rpc: 'https://polygon-mainnet.g.alchemy.com/v2/bVo646pb8L7_W_nahCoqW',
    nativeSymbol: 'POL',
    nativeDecimals: 18,
    color: '#8247e5',
    gradient: 'linear-gradient(135deg,#6c35bf,#8247e5)',
    logoUrl: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
    explorerUrl: 'https://polygonscan.com',
  },
}

const _providers: Partial<Record<NetworkId, ethers.JsonRpcProvider>> = {}

export function getNetworkProvider(id: NetworkId): ethers.JsonRpcProvider {
  if (!_providers[id]) {
    _providers[id] = new ethers.JsonRpcProvider(NETWORKS[id].rpc)
  }
  return _providers[id]!
}

export async function getNativeBalance(address: string, networkId: NetworkId): Promise<bigint> {
  const provider = getNetworkProvider(networkId)
  return await provider.getBalance(address)
}

export function formatNative(wei: bigint, decimals = 18, precision = 4): string {
  const val = Number(wei) / Math.pow(10, decimals)
  return val.toFixed(precision)
}
