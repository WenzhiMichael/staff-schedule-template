import {
  getScheduleVisibility,
  initializeAvailabilityDatabase,
  setScheduleVisibility,
  validScheduleVisibility,
} from "../../../../db/availability";
import { serverError } from "../../../../db/errors";
import { hasManagerSession } from "../../../../db/manager-auth";

export async function GET(request: Request) {
  try {
    if (!(await hasManagerSession(request))) return Response.json({ error: "请先登录经理页面。" }, { status: 401 });
    await initializeAvailabilityDatabase();
    return Response.json({ scheduleVisibility: await getScheduleVisibility() });
  } catch (error) {
    return serverError(error, "设置暂时无法打开。");
  }
}

export async function POST(request: Request) {
  try {
    if (!(await hasManagerSession(request))) return Response.json({ error: "请先登录经理页面。" }, { status: 401 });
    await initializeAvailabilityDatabase();
    const body = await request.json() as { scheduleVisibility?: unknown };
    if (!validScheduleVisibility(body.scheduleVisibility)) return Response.json({ error: "设置不正确。" }, { status: 400 });
    await setScheduleVisibility(body.scheduleVisibility);
    return Response.json({ ok: true, scheduleVisibility: body.scheduleVisibility });
  } catch (error) {
    return serverError(error, "设置暂时无法保存。");
  }
}
