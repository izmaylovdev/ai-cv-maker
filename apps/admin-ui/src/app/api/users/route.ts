import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.ADMIN_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const authorization = req.headers.get('authorization') ?? '';
  const res = await fetch(`${ADMIN_API_URL}/api/users`, {
    cache: 'no-store',
    headers: { authorization },
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: res.status });
  }
  const data = await res.json();
  return NextResponse.json(data);
}
