import {
  cleanDisplayName,
  employeeIdFrom,
  getAvailabilityD1,
  getEmployee,
  initializeAvailabilityDatabase,
} from "../../../../../db/availability";
import { hasManagerSession } from "../../../../../db/manager-auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!(await hasManagerSession(request))) return Response.json({ error: "请先登录经理页面。" }, { status: 401 });
    await initializeAvailabilityDatabase();
    const employeeId = employeeIdFrom((await context.params).id);
    if (!employeeId) return Response.json({ error: "员工编号不正确。" }, { status: 400 });
    const body = await request.json() as { displayName?: unknown };
    const displayName = cleanDisplayName(body.displayName);
    if (!displayName) return Response.json({ error: "姓名不能为空，最多 40 个字符。" }, { status: 400 });
    const db = getAvailabilityD1();
    const duplicate = await db.prepare(
      "SELECT id FROM availability_employees WHERE display_name = ? COLLATE NOCASE AND id != ?",
    ).bind(displayName, employeeId).first();
    if (duplicate) return Response.json({ error: "这个姓名已经在名单里。" }, { status: 409 });
    await db.prepare(
      "UPDATE availability_employees SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(displayName, employeeId).run();
    const employee = await getEmployee(employeeId);
    if (!employee) return Response.json({ error: "找不到这位员工。" }, { status: 404 });
    return Response.json({ ok: true, employee });
  } catch (error) {
    const message = error instanceof Error ? error.message : "姓名暂时无法保存。";
    return Response.json({ error: message }, { status: 500 });
  }
}
