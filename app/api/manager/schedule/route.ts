import { addDays, validIsoDate } from "../../../../db/schedule";
import { employeeIdFrom, getAvailabilityD1, getEmployee, initializeAvailabilityDatabase, requestedWeek } from "../../../../db/availability";
import { hasManagerSession } from "../../../../db/manager-auth";

type ShiftCode = "early" | "late";

function validShiftCode(value: unknown): value is ShiftCode {
  return value === "early" || value === "late";
}

function validManagerTime(value: unknown, dayIndex: number, allowClosing = false) {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  if (allowClosing && value === 1440) return true;
  if (dayIndex >= 5 && value === 690) return true;
  return value >= 660 && value < 1440 && value % 60 === 0;
}

export async function POST(request: Request) {
  if (!(await hasManagerSession(request))) return Response.json({ error: "请先登录经理页面。" }, { status: 401 });
  await initializeAvailabilityDatabase();
  const body = await request.json() as {
    weekStart?: unknown;
    shiftDate?: unknown;
    shiftCode?: unknown;
    previousShiftCode?: unknown;
    employeeId?: unknown;
    assigned?: unknown;
    startMinutes?: unknown;
    endMinutes?: unknown;
  };
  const employeeId = employeeIdFrom(body.employeeId);
  const weekStart = typeof body.weekStart === "string" ? requestedWeek(body.weekStart) : "";
  const allowedDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const dayIndex = typeof body.shiftDate === "string" ? allowedDates.indexOf(body.shiftDate) : -1;
  if (body.weekStart !== weekStart || !validIsoDate(body.shiftDate) || dayIndex < 0) return Response.json({ error: "请选择正确的排班周和日期。" }, { status: 400 });
  if (!validShiftCode(body.shiftCode)) return Response.json({ error: "班次位置不正确。" }, { status: 400 });
  const previousShiftCode = validShiftCode(body.previousShiftCode) ? body.previousShiftCode : body.shiftCode;
  if (!employeeId || !(await getEmployee(employeeId))) return Response.json({ error: "员工不正确。" }, { status: 400 });
  if (typeof body.assigned !== "boolean") return Response.json({ error: "排班状态不正确。" }, { status: 400 });

  const db = getAvailabilityD1();
  if (!body.assigned) {
    await db.prepare(
      `DELETE FROM weekly_schedule_assignments
       WHERE week_start = ? AND shift_date = ? AND shift_code = ? AND employee_id = ? AND state = 'draft'`,
    ).bind(weekStart, body.shiftDate, previousShiftCode, employeeId).run();
    return Response.json({ ok: true, assignment: null });
  }

  if (!validManagerTime(body.startMinutes, dayIndex) || !validManagerTime(body.endMinutes, dayIndex, true) || (body.endMinutes as number) <= (body.startMinutes as number)) {
    return Response.json({ error: "请选择有效的开始和结束时间。经理排班使用整点，C 代表午夜。" }, { status: 400 });
  }

  const oppositeShiftCode: ShiftCode = body.shiftCode === "early" ? "late" : "early";
  const opposite = await db.prepare(
    `SELECT start_minutes, end_minutes FROM weekly_schedule_assignments
     WHERE week_start = ? AND shift_date = ? AND shift_code = ? AND employee_id = ? AND state = 'draft'`,
  ).bind(weekStart, body.shiftDate, oppositeShiftCode, employeeId).first<{ start_minutes: number; end_minutes: number }>();
  if (opposite) {
    const overlapsOrTouches = (body.endMinutes as number) >= opposite.start_minutes && opposite.end_minutes >= (body.startMinutes as number);
    if (!overlapsOrTouches) return Response.json({ error: "同一员工当天的早班和晚班必须连续，不能留下中间空档。" }, { status: 400 });
  }

  const statements = [];
  if (previousShiftCode !== body.shiftCode) {
    statements.push(db.prepare(
      `DELETE FROM weekly_schedule_assignments
       WHERE week_start = ? AND shift_date = ? AND shift_code = ? AND employee_id = ? AND state = 'draft'`,
    ).bind(weekStart, body.shiftDate, previousShiftCode, employeeId));
  }
  statements.push(db.prepare(
    `INSERT INTO weekly_schedule_assignments
     (week_start, shift_date, shift_code, employee_id, start_minutes, end_minutes, state)
     VALUES (?, ?, ?, ?, ?, ?, 'draft')
     ON CONFLICT(week_start, shift_date, shift_code, employee_id, state)
     DO UPDATE SET start_minutes = excluded.start_minutes, end_minutes = excluded.end_minutes, updated_at = CURRENT_TIMESTAMP`,
  ).bind(weekStart, body.shiftDate, body.shiftCode, employeeId, body.startMinutes, body.endMinutes));
  await db.batch(statements);

  return Response.json({
    ok: true,
    assignment: {
      shiftDate: body.shiftDate,
      shiftCode: body.shiftCode,
      employeeId,
      startMinutes: body.startMinutes,
      endMinutes: body.endMinutes,
    },
  });
}
