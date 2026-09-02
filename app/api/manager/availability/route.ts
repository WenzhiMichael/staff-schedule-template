import { getEmployeeLinkStates, getManagerWeek, getScheduleAssignments, initializeAvailabilityDatabase, nextWeekStart, requestedWeek } from "../../../../db/availability";
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
    const [records, draftAssignments, linkStates] = await Promise.all([
      getManagerWeek(weekStart),
      getScheduleAssignments(weekStart, "draft"),
      getEmployeeLinkStates(),
    ]);
    return Response.json({
      weekStart,
      currentWeekStart: currentWeekStart(),
      records,
      draftAssignments,
      publishedAt: publication?.published_at ?? null,
      linkStates,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "经理总表暂时无法打开。";
    return Response.json({ error: message }, { status: 500 });
  }
}
