import { getAvailabilityD1, initializeAvailabilityDatabase, requestedWeek } from "../../../../../db/availability";
import { hasManagerSession } from "../../../../../db/manager-auth";

export async function POST(request: Request) {
  if (!(await hasManagerSession(request))) return Response.json({ error: "请先登录经理页面。" }, { status: 401 });
  await initializeAvailabilityDatabase();
  const body = await request.json() as { weekStart?: unknown };
  const weekStart = typeof body.weekStart === "string" ? requestedWeek(body.weekStart) : "";
  if (body.weekStart !== weekStart) return Response.json({ error: "请选择正确的排班周。" }, { status: 400 });
  const db = getAvailabilityD1();
  await db.batch([
    db.prepare("DELETE FROM weekly_schedule_assignments WHERE week_start = ? AND state = 'published'").bind(weekStart),
    db.prepare(
      `INSERT INTO weekly_schedule_assignments (week_start, shift_date, shift_code, employee_id, start_minutes, end_minutes, state)
       SELECT week_start, shift_date, shift_code, employee_id, start_minutes, end_minutes, 'published'
       FROM weekly_schedule_assignments WHERE week_start = ? AND state = 'draft'`,
    ).bind(weekStart),
    db.prepare(
      `INSERT INTO weekly_schedule_publications (week_start, published_at) VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(week_start) DO UPDATE SET published_at = CURRENT_TIMESTAMP`,
    ).bind(weekStart),
  ]);
  const publication = await db.prepare("SELECT published_at FROM weekly_schedule_publications WHERE week_start = ?").bind(weekStart).first<{ published_at: string }>();
  return Response.json({ ok: true, publishedAt: publication?.published_at ?? null });
}
