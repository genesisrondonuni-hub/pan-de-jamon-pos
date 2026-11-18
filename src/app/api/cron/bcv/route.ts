import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `BCV API HTTP ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    const rate = Number(data?.promedio);
    if (!Number.isFinite(rate) || rate <= 0) {
      return NextResponse.json({ ok: false, error: 'Tasa inválida' }, { status: 502 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceKey) {
      const admin = createClient(url, serviceKey);
      await admin
        .from('app_settings')
        .update({ exchange_rate_ves_usd: Number(rate.toFixed(4)), updated_at: new Date().toISOString() })
        .eq('id', 1);
    }

    return NextResponse.json({ ok: true, rate: Number(rate.toFixed(2)), synced_at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
