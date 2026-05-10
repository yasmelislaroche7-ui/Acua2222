import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

const CHAT_V2 = '0x97CA6216c01E9C9F7cf520Bcd256C6b173B652CA'
const RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/v2/bVo646pb8L7_W_nahCoqW'
const CHAIN_ID = 480

const RELAY_ABI = [
  'function postRelayed(address sender, string calldata text, uint256 nonce, bytes calldata sig) external returns (uint256)',
  'function deleteRelayed(address sender, uint256 msgId, uint256 nonce, bytes calldata sig) external',
  'function getNonce(address addr) external view returns (uint256)',
]

function getRelayWallet() {
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY not configured on server')
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID)
  return new ethers.Wallet(pk, provider)
}

// POST /api/relay/chat
// body: { action: 'post'|'delete', sender, text?, msgId?, nonce, sig }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, sender, text, msgId, nonce, sig } = body as {
      action: string
      sender: string
      text?: string
      msgId?: string
      nonce: string
      sig: string
    }

    if (!action || !sender || !nonce || !sig) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!ethers.isAddress(sender)) {
      return NextResponse.json({ error: 'Invalid sender address' }, { status: 400 })
    }

    const wallet   = getRelayWallet()
    const provider = wallet.provider!
    const contract = new ethers.Contract(CHAT_V2, RELAY_ABI, wallet)

    // Get current on-chain nonce to validate
    const onChainNonce = await contract.getNonce(sender)
    if (onChainNonce.toString() !== nonce.toString()) {
      return NextResponse.json({ error: `Nonce mismatch (expected ${onChainNonce})` }, { status: 409 })
    }

    // Gas price — use actual network price + small buffer
    const feeData    = await provider.getFeeData()
    const maxFee     = feeData.maxFeePerGas  ? feeData.maxFeePerGas  * 3n : 10_000_000n
    const maxPrio    = feeData.maxPriorityFeePerGas ?? 2_000_000n

    let txHash: string
    let id: bigint | undefined

    if (action === 'post') {
      if (!text || text.length < 2 || text.length > 500) {
        return NextResponse.json({ error: 'Invalid message text' }, { status: 400 })
      }
      const tx = await contract.postRelayed(sender, text, nonce, sig, {
        gasLimit: 600_000n,
        maxFeePerGas:         maxFee,
        maxPriorityFeePerGas: maxPrio,
      })
      const receipt = await tx.wait(1)
      txHash = tx.hash
      // Parse MessagePosted log for returned id
      try {
        const iface = new ethers.Interface([
          'event MessagePosted(uint256 indexed id, address indexed sender, string text, uint256 ts, bool relayed)',
        ])
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog(log)
            if (parsed?.name === 'MessagePosted') { id = parsed.args.id; break }
          } catch {}
        }
      } catch {}
    } else if (action === 'delete') {
      if (msgId === undefined || msgId === null) {
        return NextResponse.json({ error: 'Missing msgId' }, { status: 400 })
      }
      const tx = await contract.deleteRelayed(sender, msgId, nonce, sig, {
        gasLimit: 300_000n,
        maxFeePerGas:         maxFee,
        maxPriorityFeePerGas: maxPrio,
      })
      await tx.wait(1)
      txHash = tx.hash
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, txHash, id: id?.toString() })
  } catch (e: any) {
    console.error('[relay/chat]', e?.message ?? e)
    const msg = e?.message ?? 'Relay error'
    const userFacing = msg.includes('banned') ? 'Address is banned'
      : msg.includes('Cooldown')              ? 'Please wait 30 seconds between posts'
      : msg.includes('Hourly')               ? 'Hourly post limit reached'
      : msg.includes('Signature')            ? 'Signature verification failed'
      : msg.includes('nonce')                ? 'Nonce mismatch — please refresh'
      : msg.includes('PRIVATE_KEY')          ? 'Relay not configured'
      : 'Transaction failed'
    return NextResponse.json({ error: userFacing }, { status: 500 })
  }
}

// GET /api/relay/chat?address=0x...  → returns nonce + canPost
export async function GET(req: NextRequest) {
  try {
    const addr = req.nextUrl.searchParams.get('address')
    if (!addr || !ethers.isAddress(addr)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID)
    const contract = new ethers.Contract(CHAT_V2, [
      'function getNonce(address) external view returns (uint256)',
      'function canPost(address) external view returns (bool ok, uint256 nextAllowedAt, uint256 hourlyLeft)',
    ], provider)
    const [nonce, [ok, nextAllowedAt, hourlyLeft]] = await Promise.all([
      contract.getNonce(addr),
      contract.canPost(addr),
    ])
    return NextResponse.json({
      nonce: nonce.toString(),
      canPost: ok,
      nextAllowedAt: nextAllowedAt.toString(),
      hourlyLeft: hourlyLeft.toString(),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status: 500 })
  }
}
