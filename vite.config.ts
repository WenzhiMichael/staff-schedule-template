import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(async ({ mode }) => {
  // Only server routes read these values; never use a VITE_ prefix.
  const local = loadEnv(mode, process.cwd(), "");
  for (const key of ["STAFF_SCHEDULE_MANAGER_PIN_HASH", "STAFF_SCHEDULE_MANAGER_SESSION_SECRET", "DATABASE_URL", "POSTGRES_URL"]) {
    if (!process.env[key] && local[key]) process.env[key] = local[key];
  }
  if (process.env.VERCEL) process.env.NITRO_PRESET ??= "vercel";
  return {
    plugins: [vinext(), ...(process.env.VERCEL ? [(await import("nitro/vite")).nitro()] : [])],
  };
});
