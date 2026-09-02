import {
  clearEmployeeLoginFailures,
  createEmployeeSession,
  employeeClientKey,
  employeeLoginBlocked,
  recordEmployeeLoginFailure,
  verifyEmployeePin,
} from "../../../../db/employee-auth";
import { employeeIdFrom, getAvailabilityD1, getEmployee, initializeAvailabilityDatabase } from "../../../../db/availability";

export async function POST(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    const body = await request.json() as { employeeId?: unknown; pin?: unknown };
    const employeeId = employeeIdFrom(body.employeeId);
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!employeeId || !(await getEmployee(employeeId)) || !/^\d{4}$/.test(pin)) return Response.json({ error: "请选择姓名并输入四位 PIN。" }, { status: 400 });
    const clientKey = await employeeClientKey(request, employeeId);
    if (await employeeLoginBlocked(clientKey)) return Response.json({ error: "尝试次数过多，请 15 分钟后再试。" }, { status: 429 });
    const credential = await getAvailabilityD1().prepare("SELECT pin_hash FROM employee_credentials WHERE employee_id = ?").bind(employeeId).first<{ pin_hash: string | null }>();
    if (!credential?.pin_hash) return Response.json({ error: "这位员工还没有设置 PIN，请联系经理索取设置链接。" }, { status: 409 });
    if (!(await verifyEmployeePin(pin, credential.pin_hash))) {
      await recordEmployeeLoginFailure(clientKey);
      const blocked = await employeeLoginBlocked(clientKey);
      return Response.json({ error: blocked ? "尝试次数过多，请 15 分钟后再试。" : "员工 PIN 不正确。" }, { status: blocked ? 429 : 401 });
    }
    await clearEmployeeLoginFailures(clientKey);
    return Response.json({ ok: true }, { headers: { "set-cookie": await createEmployeeSession(request, employeeId) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "员工登录暂时不可用。";
    return Response.json({ error: message }, { status: 500 });
  }
}
