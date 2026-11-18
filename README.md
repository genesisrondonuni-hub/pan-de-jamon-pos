# Pan de Jamón POS (Next.js + Supabase + Vercel)

## Despliegue en Vercel
1. Sube esta carpeta a un repositorio en GitHub.
2. En Vercel, importa el repositorio y agrega las variables de entorno:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (opcional, para que el cron `/api/cron/bcv` actualice la base de datos a las 9:00 AM y 4:30 PM VET).
3. Pulsa **Deploy**.
