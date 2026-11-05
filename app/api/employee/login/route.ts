import {
  clearEmployeeLoginFailures,
  createEmployeeSession,
  employeeLoginBlocked,
  employeeLoginKeys,
  getDeviceEmployee,
  recordEmployeeLoginFailure,
  verifyEmployeePin,
} from "../../../../db/employee-auth";
import { getAvailabilityD1, initializeAvailabilityDatabase } from "../../../../db/availability";
import { serverError } from "../../../../db/errors";

const TOO_MANY = "尝试次数过多，请 15 分钟后再试。";

export async function POST(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    // The employee comes from this phone's device binding, never from the request body.
    const device = await getDeviceEmployee(request);
    if (!device) return Response.json({ error: "这台设备还没有绑定员工，请使用经理发给你的个人链接。" }, { status: 401 });
    const body = await request.json() as { pin?: unknown };
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!/^\d{4}$/.test(pin)) return Response.json({ error: "请输入四位 PIN。" }, { status: 400 });
    const keys = await employeeLoginKeys(request, device.id);
    if (await employeeLoginBlocked(keys)) return Response.json({ error: TOO_MANY }, { status: 429 });
    const credential = await getAvailabilityD1().prepare("SELECT pin_hash FROM employee_credentials WHERE employee_id = ?").bind(device.id).first<{ pin_hash: string | null }>();
    if (!credential?.pin_hash) return Response.json({ error: "还没有设置 PIN，请联系经理索取设置链接。" }, { status: 409 });
    if (!(await verifyEmployeePin(pin, credential.pin_hash))) {
      await recordEmployeeLoginFailure(keys);
      const blocked = await employeeLoginBlocked(keys);
      return Response.json({ error: blocked ? TOO_MANY : "员工 PIN 不正确。" }, { status: blocked ? 429 : 401 });
    }
    await clearEmployeeLoginFailures(keys);
    return Response.json({ ok: true }, { headers: { "set-cookie": await createEmployeeSession(request, device.id) } });
  } catch (error) {
    return serverError(error, "员工登录暂时不可用。");
  }
}
