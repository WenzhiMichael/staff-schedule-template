const COOKIE_NAME = "staff_schedule_manager_session";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

type ManagerEnv = {
  STAFF_SCHEDULE_MANAGER_PIN_HASH?: string;
  STAFF_SCHEDULE_MANAGER_SESSION_SECRET?: string;
};

function runtimeEnv(): ManagerEnv {
  return process.env as ManagerEnv;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const result = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations }, key, 256);
  return new Uint8Array(result);
}

export async function createPinHash(pin: string, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = 210_000) {
  const hash = await pbkdf2(pin, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyManagerPin(pin: string) {
  const stored = runtimeEnv().STAFF_SCHEDULE_MANAGER_PIN_HASH;
  if (!stored) throw new Error("经理 PIN 尚未配置。");
  const [algorithm, rawIterations, saltValue, hashValue] = stored.split("$");
  const iterations = Number(rawIterations);
  if (algorithm !== "pbkdf2_sha256" || !Number.isInteger(iterations) || iterations < 100_000 || !saltValue || !hashValue) {
    throw new Error("经理 PIN 配置不正确。");
  }
  const actual = await pbkdf2(pin, fromBase64Url(saltValue), iterations);
  const expected = fromBase64Url(hashValue);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function sessionSecret() {
  const secret = runtimeEnv().STAFF_SCHEDULE_MANAGER_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("经理会话密钥尚未配置。");
  return secret;
}

export async function createManagerSessionCookie(request: Request) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expiresAt);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(sessionSecret()), encoder.encode(payload)));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${payload}.${toBase64Url(signature)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearManagerSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function cookieValue(request: Request) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return null;
}

export async function hasManagerSession(request: Request) {
  try {
    const token = cookieValue(request);
    if (!token) return false;
    const [payload, signatureValue] = token.split(".");
    const expiresAt = Number(payload);
    if (!payload || !signatureValue || !Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
    return crypto.subtle.verify(
      "HMAC",
      await hmacKey(sessionSecret()),
      fromBase64Url(signatureValue),
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
}

export async function managerClientKey(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${forwarded}|${sessionSecret()}`));
  return toBase64Url(new Uint8Array(digest));
}

export function managerConfigurationReady() {
  const runtime = runtimeEnv();
  return Boolean(runtime.STAFF_SCHEDULE_MANAGER_PIN_HASH && runtime.STAFF_SCHEDULE_MANAGER_SESSION_SECRET && runtime.STAFF_SCHEDULE_MANAGER_SESSION_SECRET.length >= 32);
}
