import { getEmployeeLinkStates, getManagerWeek, getScheduleVisibility, getScheduleAssignments, initializeAvailabilityDatabase, nextWeekStart, requestedWeek } from "../../../../db/availability";
import { serverError } from "../../../../db/errors";
import { hasManagerSession } from "../../../../db/manager-auth";
import { currentWeekStart } from "../../../../db/schedule";

export async function GET(request: Request) {
  try {
    if (!(await hasManagerSession(request))) return Response.json({ error: "请先登录经理页面。" }, { status: 401 });
    await initializeAvailabilityDatabase();
    const requested = new URL(request.url).searchParams.get("week");
    const weekStart = requested ? requestedWeek(requested) : nextWeekStart();
    const db = (await import("../../../../db/availability")).getAvailabilityD1();
    const publication = await db.prepare("SELECT published_at FROM weekly_schedule_publications WHERE week_start = ?").bind(weekStart).first<{ published_at: string }>();
    const [records, draftAssignments, linkStates, scheduleVisibility] = await Promise.all([
      getManagerWeek(weekStart),
      getScheduleAssignments(weekStart, "draft"),
      getEmployeeLinkStates(),
      getScheduleVisibility(),
    ]);
    return Response.json({
      weekStart,
      currentWeekStart: currentWeekStart(),
      records,
      draftAssignments,
      publishedAt: publication?.published_at ?? null,
      linkStates,
      scheduleVisibility,
    });
  } catch (error) {
    return serverError(error, "经理总表暂时无法打开。");
  }
}
