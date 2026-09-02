export type AvailabilityMap = Record<string, string>;
export type Employee = { id: number; displayName: string };
export type ShiftCode = "early" | "late";
export type ScheduleAssignment = {
  shiftDate: string;
  shiftCode: ShiftCode;
  employeeId: number;
  startMinutes: number;
  endMinutes: number;
};

export const weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
export const englishWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function dateFromIso(iso: string) {
  return new Date(`${iso}T12:00:00Z`);
}

function isoFromDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number) {
  const date = dateFromIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromDate(date);
}

export function dayOptions(index: number, language: "zh" | "en" = "zh") {
  const opening = index < 5 ? "11-6" : "11:30-6";
  const full = index < 5 ? "11-C" : "11:30-C";
  return [
    { label: language === "en" ? "Early" : "早班", value: opening, hint: opening },
    { label: language === "en" ? "Late" : "晚班", value: "6-C", hint: "6-C" },
    { label: language === "en" ? "All day" : "全天", value: full, hint: full },
  ];
}

export function isPreset(code: string, index: number) {
  return dayOptions(index).some((option) => option.value === code);
}

export function shortDate(iso: string, language: "zh" | "en" = "zh") {
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", { month: "short", day: "numeric", timeZone: "UTC" }).format(dateFromIso(iso));
}

export function englishDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(dateFromIso(iso));
}

export function customTimes(dayIndex: number) {
  const opening = dayIndex < 5 ? 11 : 11.5;
  return Array.from({ length: 13 }, (_, index) => {
    const hourValue = opening + index;
    const hour24 = Math.floor(hourValue);
    const minute = hourValue % 1 ? ":30" : "";
    const hour12 = hour24 === 12 ? 12 : hour24 - 12;
    return {
      value: `${hour12}${minute}`,
      label: `${hour12}:${minute ? "30" : "00"} ${hour24 < 12 ? "AM" : "PM"}`,
      minutes: hourValue * 60,
    };
  });
}

export function endTimes(dayIndex: number) {
  return [...customTimes(dayIndex).slice(1), { value: "C", label: "C · 12:00 AM", minutes: 1440 }];
}

function minutes(part: string) {
  if (part === "C") return 1440;
  const [rawHour, rawMinute = "0"] = part.split(":");
  let hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (hour < 11) hour += 12;
  return hour * 60 + minute;
}

export function availabilityCoverage(code: string | undefined, dayIndex: number, shiftCode: ShiftCode) {
  if (!code) return "none" as const;
  const [start, end] = code.split("-").map(minutes);
  const shiftStart = shiftCode === "early" ? (dayIndex < 5 ? 660 : 690) : 1080;
  const shiftEnd = shiftCode === "early" ? 1080 : 1440;
  if (start <= shiftStart && end >= shiftEnd) return "full" as const;
  if (start < shiftEnd && end > shiftStart) return "partial" as const;
  return "none" as const;
}

export function standardShiftMinutes(dayIndex: number, shiftCode: ShiftCode) {
  return shiftCode === "early"
    ? { startMinutes: dayIndex < 5 ? 660 : 690, endMinutes: 1080 }
    : { startMinutes: 1080, endMinutes: 1440 };
}

export function availabilityMinutes(code: string | undefined) {
  if (!code) return null;
  const [start, end] = code.split("-");
  const startMinutes = minutes(start);
  const endMinutes = minutes(end);
  return Number.isFinite(startMinutes) && Number.isFinite(endMinutes) ? { startMinutes, endMinutes } : null;
}

export function availabilitySlot(code: string | undefined, dayIndex: number, shiftCode: ShiftCode) {
  const range = availabilityMinutes(code);
  if (!range || !code) return { visible: false, label: "" };
  const opening = dayIndex < 5 ? 660 : 690;
  const isFullDay = range.startMinutes === opening && range.endMinutes === 1440;
  const isStandardEarly = range.startMinutes === opening && range.endMinutes === 1080;
  const isStandardLate = range.startMinutes === 1080 && range.endMinutes === 1440;

  if (isFullDay) return { visible: true, label: "" };
  if (isStandardEarly) return { visible: shiftCode === "early", label: "" };
  if (isStandardLate) return { visible: shiftCode === "late", label: "" };

  const target: ShiftCode = range.endMinutes <= 1080 ? "early" : "late";
  return { visible: shiftCode === target, label: shiftCode === target ? code : "" };
}

export function assignmentCoverage(code: string | undefined, assignment: ScheduleAssignment) {
  const available = availabilityMinutes(code);
  if (!available) return "none" as const;
  if (available.startMinutes <= assignment.startMinutes && available.endMinutes >= assignment.endMinutes) return "full" as const;
  if (available.startMinutes < assignment.endMinutes && available.endMinutes > assignment.startMinutes) return "partial" as const;
  return "none" as const;
}

export function isStandardAssignment(assignment: ScheduleAssignment, dayIndex: number) {
  const standard = standardShiftMinutes(dayIndex, assignment.shiftCode);
  return assignment.startMinutes === standard.startMinutes && assignment.endMinutes === standard.endMinutes;
}

export function displayMinutes(value: number) {
  if (value === 1440) return "C";
  const hour24 = Math.floor(value / 60);
  const minute = value % 60;
  const hour12 = hour24 === 12 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
  return `${hour12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}`;
}

export function formatAssignment(assignment: Pick<ScheduleAssignment, "startMinutes" | "endMinutes">) {
  return `${displayMinutes(assignment.startMinutes)}-${displayMinutes(assignment.endMinutes)}`;
}

export function assignmentsAreContinuous(first: ScheduleAssignment, second: ScheduleAssignment) {
  return first.endMinutes >= second.startMinutes && second.endMinutes >= first.startMinutes;
}

export function managerTimeOptions(dayIndex: number) {
  const opening = dayIndex < 5 ? 660 : 690;
  const values = [opening];
  for (let value = 720; value < 1440; value += 60) if (value >= opening) values.push(value);
  return [...new Set(values)].map((value) => ({ value, label: `${displayMinutes(value)}${value % 60 ? "" : ":00"}` }));
}

export function managerEndOptions(dayIndex: number) {
  return [...managerTimeOptions(dayIndex).filter((option) => option.value >= 720), { value: 1440, label: "C · 12:00 AM" }];
}

export function assignmentKey(shiftDate: string, shiftCode: ShiftCode, employeeId: number) {
  return `${shiftDate}|${shiftCode}|${employeeId}`;
}
