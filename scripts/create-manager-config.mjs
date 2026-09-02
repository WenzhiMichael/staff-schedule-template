import { pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const pin = (await terminal.question("Choose a six-digit manager PIN (visible while typing): ")).trim();
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must contain exactly six digits.");
  const target = new URL("../.env.local", import.meta.url);
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (/^STAFF_SCHEDULE_MANAGER_PIN_HASH=.+/m.test(existing)) {
    throw new Error("Manager configuration already exists. Remove the two manager entries from .env.local to reset it.");
  }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pin, salt, 210_000, 32, "sha256");
  const value = `pbkdf2_sha256$210000$${salt.toString("base64url")}$${hash.toString("base64url")}`;
  const remaining = existing.split(/\r?\n/).filter(line => !/^STAFF_SCHEDULE_MANAGER_(PIN_HASH|SESSION_SECRET)=/.test(line)).join("\n").trim();
  // Vite's dotenv expansion requires escaped dollar signs in local files.
  writeFileSync(target, `${remaining}\nSTAFF_SCHEDULE_MANAGER_PIN_HASH=${value.replaceAll("$", "\\$")}\nSTAFF_SCHEDULE_MANAGER_SESSION_SECRET=${randomBytes(32).toString("base64url")}\n`, { mode: 0o600 });
  console.log("Saved manager configuration in .env.local. Add your own DATABASE_URL there, then run npm run dev.");
} finally {
  terminal.close();
}
