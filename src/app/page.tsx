'use client';

import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import PanDeJamonPosApp from '@/components/PanDeJamonPosApp';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export default function HomePage() {
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const [authenticated, setAuthenticated] = useState(!isSupabaseConfigured);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session));
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authErr) {
      setError('Correo o contraseña incorrectos.');
    }
    setLoading(false);
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        Cargando Pan de Jamón POS...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-lg">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-600 text-white">
              <UtensilsCrossed className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900">Pan de Jamón POS</h1>
            <p className="text-xs text-zinc-500">Inicia sesión con tu cuenta de Supabase</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700">Correo</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700">Contraseña</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-xs font-medium text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {loading ? 'Ingresando...' : 'Entrar al sistema'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <PanDeJamonPosApp />;
}
