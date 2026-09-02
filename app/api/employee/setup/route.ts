import {
  clearEmployeeSetupCookie,
  createEmployeePinHash,
  createEmployeeSession,
  getSetupEmployee,
} from "../../../../db/employee-auth";
import { getAvailabilityD1, initializeAvailabilityDatabase } from "../../../../db/availability";

export async function GET(request: Request) {
  await initializeAvailabilityDatabase();
  const employee = await getSetupEmployee(request);
  if (!employee) return Response.json({ error: "设置链接无效或已经使用，请联系经理。" }, { status: 401 });
  return Response.json({ employee: { id: employee.id, displayName: employee.display_name } });
}

export async function POST(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    const employee = await getSetupEmployee(request);
    if (!employee) return Response.json({ error: "设置链接无效或已经使用，请联系经理。" }, { status: 401 });
    const body = await request.json() as { pin?: unknown; confirmPin?: unknown };
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!/^\d{4}$/.test(pin)) return Response.json({ error: "请输入四位数字 PIN。" }, { status: 400 });
    if (body.confirmPin !== pin) return Response.json({ error: "两次输入的 PIN 不一致。" }, { status: 400 });
    const pinHash = await createEmployeePinHash(pin);
    const db = getAvailabilityD1();
    await db.batch([
      db.prepare(
        `INSERT INTO employee_credentials (employee_id, pin_hash, pin_set_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(employee_id) DO UPDATE SET pin_hash = excluded.pin_hash, pin_set_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
      ).bind(employee.id, pinHash),
      db.prepare("DELETE FROM employee_access_tokens WHERE employee_id = ?").bind(employee.id),
      db.prepare("DELETE FROM employee_sessions WHERE employee_id = ?").bind(employee.id),
    ]);
    const sessionCookie = await createEmployeeSession(request, employee.id);
    const headers = new Headers();
    headers.append("set-cookie", sessionCookie);
    headers.append("set-cookie", clearEmployeeSetupCookie(request));
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "员工 PIN 暂时无法设置。";
    return Response.json({ error: message }, { status: 500 });
  }
}
