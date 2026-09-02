import { createEmployeeToken, hashEmployeeToken } from "../../../../../../db/employee-auth";
import { employeeIdFrom, getAvailabilityD1, getEmployee, initializeAvailabilityDatabase } from "../../../../../../db/availability";
import { hasManagerSession } from "../../../../../../db/manager-auth";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await hasManagerSession(request))) return Response.json({ error: "请先登录经理页面。" }, { status: 401 });
  await initializeAvailabilityDatabase();
  const employeeId = employeeIdFrom((await context.params).id);
  if (!employeeId || !(await getEmployee(employeeId))) return Response.json({ error: "找不到这位员工。" }, { status: 404 });
  const token = createEmployeeToken();
  const tokenHash = await hashEmployeeToken(token);
  const db = getAvailabilityD1();
  await db.batch([
    db.prepare(
      `INSERT INTO employee_access_tokens (employee_id, token_hash) VALUES (?, ?)
       ON CONFLICT(employee_id) DO UPDATE SET token_hash = excluded.token_hash, updated_at = CURRENT_TIMESTAMP`,
    ).bind(employeeId, tokenHash),
    db.prepare(
      `INSERT INTO employee_credentials (employee_id, pin_hash, pin_set_at) VALUES (?, NULL, NULL)
       ON CONFLICT(employee_id) DO UPDATE SET pin_hash = NULL, pin_set_at = NULL, updated_at = CURRENT_TIMESTAMP`,
    ).bind(employeeId),
    db.prepare("DELETE FROM employee_sessions WHERE employee_id = ?").bind(employeeId),
    db.prepare("DELETE FROM employee_login_attempts"),
  ]);
  return Response.json({ ok: true, employeeId, link: `${new URL(request.url).origin}/e/${token}` });
}
