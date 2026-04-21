import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { type MiniAppWalletAuthSuccessPayload, verifySiweMessage } from '@worldcoin/minikit-js'

interface RequestBody {
  payload: MiniAppWalletAuthSuccessPayload
  nonce: string
}

export async function POST(req: NextRequest) {
  const { payload, nonce } = (await req.json()) as RequestBody

  const cookieStore = await cookies()
  const storedNonce = cookieStore.get('siwe')?.value

  if (!storedNonce || nonce !== storedNonce) {
    return NextResponse.json(
      { isValid: false, error: 'Nonce inválido o expirado' },
      { status: 400 },
    )
  }

  try {
    const verification = await verifySiweMessage(payload, nonce)

    if (!verification.isValid) {
      return NextResponse.json(
        { isValid: false, error: 'Firma SIWE inválida' },
        { status: 400 },
      )
    }

    // Clear the nonce cookie after successful verification
    cookieStore.delete('siwe')

    return NextResponse.json({
      isValid: true,
      address: verification.siweMessageData.address,
    })
  } catch (error) {
    console.error('[complete-siwe] error:', error)
    return NextResponse.json(
      { isValid: false, error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 400 },
    )
  }
}
