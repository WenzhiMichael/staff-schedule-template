import {
  cleanAvailability,
  getAvailabilityD1,
  getEmployeeAvailability,
  getPublishedSchedule,
  getScheduleVisibility,
  initializeAvailabilityDatabase,
  nextWeekStart,
} from "../../../db/availability";
import { createEmployeeDevice, getDeviceEmployee, getEmployeeSession } from "../../../db/employee-auth";
import { serverError } from "../../../db/errors";
import { currentWeekStart } from "../../../db/schedule";

function routeError(error: unknown) {
  return serverError(error, "个人时间暂时无法打开。");
}

export async function GET(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    const session = await getEmployeeSession(request);
    if (!session) return Response.json({ error: "请使用经理发给你的个人链接进入。" }, { status: 401 });
    const weekStart = nextWeekStart();
    const employee = { id: session.id, displayName: session.display_name };
    const scheduleVisibility = await getScheduleVisibility();
    const onlyEmployeeId = scheduleVisibility === "own" ? session.id : undefined;
    const [record, currentSchedule, nextSchedule, device] = await Promise.all([
      getEmployeeAvailability(session.id, weekStart),
      getPublishedSchedule(currentWeekStart(), onlyEmployeeId),
      getPublishedSchedule(weekStart, onlyEmployeeId),
      getDeviceEmployee(request),
    ]);
    // Phones signed in before device binding existed get bound on their next visit.
    const headers = new Headers({ "cache-control": "no-store" });
    if (device?.id !== session.id) headers.append("set-cookie", await createEmployeeDevice(request, session.id));
    return Response.json(
      { employee, record, weekStart, currentWeekStart: currentWeekStart(), scheduleVisibility, publishedSchedules: { current: currentSchedule, next: nextSchedule } },
      { headers },
    );
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
