import {
  cleanAvailability,
  getAvailabilityD1,
  getEmployeeAvailability,
  getPublishedSchedule,
  initializeAvailabilityDatabase,
  nextWeekStart,
} from "../../../db/availability";
import { getEmployeeSession } from "../../../db/employee-auth";
import { currentWeekStart } from "../../../db/schedule";

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    const session = await getEmployeeSession(request);
    if (!session) return Response.json({ error: "请使用经理发给你的个人链接进入。" }, { status: 401 });
    const weekStart = nextWeekStart();
    const employee = { id: session.id, displayName: session.display_name };
    const [record, currentSchedule, nextSchedule] = await Promise.all([
      getEmployeeAvailability(session.id, weekStart),
      getPublishedSchedule(currentWeekStart()),
      getPublishedSchedule(weekStart),
    ]);
    return Response.json({ employee, record, weekStart, currentWeekStart: currentWeekStart(), publishedSchedules: { current: currentSchedule, next: nextSchedule } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    const session = await getEmployeeSession(request);
    if (!session) return Response.json({ error: "个人链接已经失效，请联系经理。" }, { status: 401 });
    const body = await request.json() as { weekStart?: unknown; availability?: unknown };
    const weekStart = nextWeekStart();
    if (body.weekStart !== weekStart) return Response.json({ error: "只能修改下周的可上班时间。" }, { status: 400 });
    const availability = cleanAvailability(body.availability, weekStart);
    if (!availability) return Response.json({ error: "可上班时间不正确，请重新选择。" }, { status: 400 });

    const db = getAvailabilityD1();
    await db.prepare(
      `INSERT INTO employee_weekly_availability (week_start, employee_id, availability_json)
       VALUES (?, ?, ?)
       ON CONFLICT(week_start, employee_id) DO UPDATE SET
         availability_json = excluded.availability_json,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(weekStart, session.id, JSON.stringify(availability)).run();

    return Response.json({
      ok: true,
      employee: { id: session.id, displayName: session.display_name },
      record: await getEmployeeAvailability(session.id, weekStart),
      weekStart,
      currentWeekStart: currentWeekStart(),
    });
  } catch (error) {
    return routeError(error);
  }
}
