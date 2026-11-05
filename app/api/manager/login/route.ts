import { getAvailabilityD1, initializeAvailabilityDatabase } from "../../../../db/availability";
import { serverError } from "../../../../db/errors";
import {
  createManagerSessionCookie,
  managerClientKey,
  managerConfigurationReady,
  verifyManagerPin,
} from "../../../../db/manager-auth";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
// IP-independent ceiling, so rotating addresses cannot brute-force the manager PIN.
const MAX_GLOBAL_ATTEMPTS = 30;
const GLOBAL_KEY = "manager:all-clients";

type AttemptRow = { attempts: number; window_started: number };

export async function POST(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    if (!managerConfigurationReady()) {
      return Response.json({ error: "经理 PIN 尚未配置。" }, { status: 503 });
    }
    const body = await request.json() as { pin?: unknown };
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    if (!/^\d{6}$/.test(pin)) return Response.json({ error: "请输入六位经理 PIN。" }, { status: 400 });

    const db = getAvailabilityD1();
    const clientKey = await managerClientKey(request);
    const now = Math.floor(Date.now() / 1000);
    const current = await db.prepare(
      "SELECT attempts, window_started FROM manager_login_attempts WHERE client_key = ?",
    ).bind(clientKey).first<AttemptRow>();
    const global = await db.prepare(
      "SELECT attempts, window_started FROM manager_login_attempts WHERE client_key = ?",
    ).bind(GLOBAL_KEY).first<AttemptRow>();
    const inWindow = Boolean(current && now - current.window_started < WINDOW_SECONDS);
    const globalInWindow = Boolean(global && now - global.window_started < WINDOW_SECONDS);
    if ((inWindow && (current?.attempts ?? 0) >= MAX_ATTEMPTS) || (globalInWindow && (global?.attempts ?? 0) >= MAX_GLOBAL_ATTEMPTS)) {
      return Response.json({ error: "尝试次数过多，请 15 分钟后再试。" }, { status: 429 });
    }

    if (!(await verifyManagerPin(pin))) {
      const attempts = inWindow ? (current?.attempts ?? 0) + 1 : 1;
      const windowStarted = inWindow ? current!.window_started : now;
      await db.prepare(
        `INSERT INTO manager_login_attempts (client_key, attempts, window_started)
         VALUES (?, ?, ?)
         ON CONFLICT(client_key) DO UPDATE SET attempts = excluded.attempts, window_started = excluded.window_started`,
      ).bind(clientKey, attempts, windowStarted).run();
      await db.prepare(
        `INSERT INTO manager_login_attempts (client_key, attempts, window_started)
         VALUES (?, ?, ?)
         ON CONFLICT(client_key) DO UPDATE SET attempts = excluded.attempts, window_started = excluded.window_started`,
      ).bind(GLOBAL_KEY, globalInWindow ? (global?.attempts ?? 0) + 1 : 1, globalInWindow ? global!.window_started : now).run();
      const status = attempts >= MAX_ATTEMPTS ? 429 : 401;
      const error = status === 429 ? "尝试次数过多，请 15 分钟后再试。" : "经理 PIN 不正确。";
      return Response.json({ error }, { status });
    }

    await db.prepare("DELETE FROM manager_login_attempts WHERE client_key = ?").bind(clientKey).run();
    return Response.json({ ok: true }, { headers: { "set-cookie": await createManagerSessionCookie(request) } });
  } catch (error) {
    return serverError(error, "经理登录暂时不可用。");
  }
}
