import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function GET() {
  // Nonce: alphanumeric, min 8 chars (World App requirement)
  const nonce = crypto.randomUUID().replace(/-/g, '')

  // Store in httpOnly cookie so backend can verify it later
  const cookieStore = await cookies()
  cookieStore.set('siwe', nonce, {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 60 * 60, // 1 hour
  })

  return NextResponse.json({ nonce })
}
