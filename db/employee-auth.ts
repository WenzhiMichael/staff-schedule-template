import { getAvailabilityD1 } from "./availability";
import { requestIp } from "./request-ip";

const SESSION_COOKIE = "staff_schedule_employee_session";
const SETUP_COOKIE = "staff_schedule_employee_setup";
const DEVICE_COOKIE = "staff_schedule_employee_device";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const SETUP_SECONDS = 15 * 60;
const DEVICE_SECONDS = 365 * 24 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
// Applies across every IP, so rotating addresses cannot brute-force a four-digit PIN.
const MAX_ACCOUNT_LOGIN_ATTEMPTS = 10;
const encoder = new TextEncoder();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function randomToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function createEmployeePinHash(pin: string, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = 210_000) {
  const hash = await pbkdf2(pin, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyEmployeePin(pin: string, stored: string) {
  const [algorithm, rawIterations, saltValue, hashValue] = stored.split("$");
  const iterations = Number(rawIterations);
  if (algorithm !== "pbkdf2_sha256" || !Number.isInteger(iterations) || iterations < 100_000 || !saltValue || !hashValue) return false;
  const actual = await pbkdf2(pin, fromBase64Url(saltValue), iterations);
  const expected = fromBase64Url(hashValue);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export async function hashEmployeeToken(token: string) {
  return sha256(token);
}

export function createEmployeeToken() {
  return randomToken();
}

function cookieValue(request: Request, name: string) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [cookieName, ...value] = part.trim().split("=");
    if (cookieName === name) return value.join("=");
  }
  return null;
}

function cookie(request: Request, name: string, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function createEmployeeSetupCookie(request: Request, token: string) {
  return cookie(request, SETUP_COOKIE, token, SETUP_SECONDS);
}

export function clearEmployeeSetupCookie(request: Request) {
  return cookie(request, SETUP_COOKIE, "", 0);
}

export function clearEmployeeSessionCookie(request: Request) {
  return cookie(request, SESSION_COOKIE, "", 0);
}

export async function getSetupEmployee(request: Request) {
  const token = cookieValue(request, SETUP_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const tokenHash = await hashEmployeeToken(token);
  return getAvailabilityD1().prepare(
    `SELECT e.id, e.display_name
     FROM employee_access_tokens t
     JOIN availability_employees e ON e.id = t.employee_id
     WHERE t.token_hash = ? AND e.active = 1`,
  ).bind(tokenHash).first<{ id: number; display_name: string }>();
}

export async function createEmployeeSession(request: Request, employeeId: number) {
  const token = randomToken();
  const tokenHash = await hashEmployeeToken(token);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const db = getAvailabilityD1();
  await db.batch([
    db.prepare("DELETE FROM employee_sessions WHERE expires_at <= ?").bind(Math.floor(Date.now() / 1000)),
    db.prepare("INSERT INTO employee_sessions (token_hash, employee_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, employeeId, expiresAt),
  ]);
  return cookie(request, SESSION_COOKIE, token, SESSION_SECONDS);
}

export async function getEmployeeSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const tokenHash = await hashEmployeeToken(token);
  return getAvailabilityD1().prepare(
    `SELECT e.id, e.display_name
     FROM employee_sessions s
     JOIN availability_employees e ON e.id = s.employee_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND e.active = 1`,
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first<{ id: number; display_name: string }>();
}

export async function revokeEmployeeSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token && /^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    await getAvailabilityD1().prepare("DELETE FROM employee_sessions WHERE token_hash = ?").bind(await hashEmployeeToken(token)).run();
  }
}

// ---- Device binding -------------------------------------------------------
// The one-time setup link binds the phone to one employee. The staff home page
// only ever shows that employee, so the full name list is never public.

export async function createEmployeeDevice(request: Request, employeeId: number) {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  const db = getAvailabilityD1();
  await db.batch([
    db.prepare("DELETE FROM employee_devices WHERE expires_at <= ?").bind(now),
    db.prepare("INSERT INTO employee_devices (token_hash, employee_id, expires_at) VALUES (?, ?, ?)")
      .bind(await hashEmployeeToken(token), employeeId, now + DEVICE_SECONDS),
  ]);
  return cookie(request, DEVICE_COOKIE, token, DEVICE_SECONDS);
}

export async function getDeviceEmployee(request: Request) {
  const token = cookieValue(request, DEVICE_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  return getAvailabilityD1().prepare(
    `SELECT e.id, e.display_name
     FROM employee_devices d
     JOIN availability_employees e ON e.id = d.employee_id
     WHERE d.token_hash = ? AND d.expires_at > ? AND e.active = 1`,
  ).bind(await hashEmployeeToken(token), Math.floor(Date.now() / 1000)).first<{ id: number; display_name: string }>();
}

export async function revokeEmployeeDevice(request: Request) {
  const token = cookieValue(request, DEVICE_COOKIE);
  if (token && /^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    await getAvailabilityD1().prepare("DELETE FROM employee_devices WHERE token_hash = ?").bind(await hashEmployeeToken(token)).run();
  }
}

export function clearEmployeeDeviceCookie(request: Request) {
  return cookie(request, DEVICE_COOKIE, "", 0);
}

// ---- Login rate limits -----------------------------------------------------

export async function employeeLoginKeys(request: Request, employeeId: number) {
  return {
    client: await sha256(`${requestIp(request)}|${employeeId}`),
    account: `account:${employeeId}`,
  };
}

type LoginKeys = Awaited<ReturnType<typeof employeeLoginKeys>>;

async function attemptsBlocked(clientKey: string, max: number) {
  const now = Math.floor(Date.now() / 1000);
  const row = await getAvailabilityD1().prepare("SELECT attempts, window_started FROM employee_login_attempts WHERE client_key = ?").bind(clientKey).first<{ attempts: number; window_started: number }>();
  if (!row || now - row.window_started >= LOGIN_WINDOW_SECONDS) return false;
  return row.attempts >= max;
}

export async function employeeLoginBlocked(keys: LoginKeys) {
  const [client, account] = await Promise.all([
    attemptsBlocked(keys.client, MAX_LOGIN_ATTEMPTS),
    attemptsBlocked(keys.account, MAX_ACCOUNT_LOGIN_ATTEMPTS),
  ]);
  return client || account;
}

async function recordFailure(clientKey: string) {
  const now = Math.floor(Date.now() / 1000);
  await getAvailabilityD1().prepare(
    `INSERT INTO employee_login_attempts (client_key, attempts, window_started) VALUES (?, 1, ?)
     ON CONFLICT(client_key) DO UPDATE SET
       attempts = CASE WHEN ? - employee_login_attempts.window_started >= ? THEN 1 ELSE employee_login_attempts.attempts + 1 END,
       window_started = CASE WHEN ? - employee_login_attempts.window_started >= ? THEN ? ELSE employee_login_attempts.window_started END`,
  ).bind(clientKey, now, now, LOGIN_WINDOW_SECONDS, now, LOGIN_WINDOW_SECONDS, now).run();
}

export async function recordEmployeeLoginFailure(keys: LoginKeys) {
  await recordFailure(keys.client);
  await recordFailure(keys.account);
}

export async function clearEmployeeLoginFailures(keys: LoginKeys) {
  const db = getAvailabilityD1();
  await db.batch([
    db.prepare("DELETE FROM employee_login_attempts WHERE client_key = ?").bind(keys.client),
    db.prepare("DELETE FROM employee_login_attempts WHERE client_key = ?").bind(keys.account),
  ]);
}
