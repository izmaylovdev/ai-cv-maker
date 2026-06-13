import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.ADMIN_API_URL ?? 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const authorization = req.headers.get('authorization') ?? '';
  const res = await fetch(`${ADMIN_API_URL}/api/usage-limit`, {
    cache: 'no-store',
    headers: { authorization },
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch usage limit' }, { status: res.status });
  }
  return NextResponse.json(await res.json());
}

export async function PUT(req: NextRequest) {
  const authorization = req.headers.get('authorization') ?? '';
  const body = await req.text();
  const res = await fetch(`${ADMIN_API_URL}/api/usage-limit`, {
    method: 'PUT',
    cache: 'no-store',
    headers: { authorization, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to update usage limit' }, { status: res.status });
  }
  return NextResponse.json(await res.json());
}
