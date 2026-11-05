import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomBytes, randomInt } from "node:crypto";
import { testDatabase } from "./postgres-test";
import { createPinHash } from "../db/manager-auth";
import { nextWeekStart, getPublishedSchedule } from "../db/availability";
import { currentWeekStart, addDays } from "../db/schedule";
import * as employees from "../app/api/employees/route";
import * as managerLogin from "../app/api/manager/login/route";
import * as link from "../app/api/manager/employees/[id]/link/route";
import * as rename from "../app/api/manager/employees/[id]/route";
import * as entry from "../app/e/[token]/route";
import * as setup from "../app/api/employee/setup/route";
import * as login from "../app/api/employee/login/route";
import * as availability from "../app/api/availability/route";
import * as manager from "../app/api/manager/availability/route";
import * as schedule from "../app/api/manager/schedule/route";
import * as save from "../app/api/manager/schedule/save/route";
import * as publish from "../app/api/manager/schedule/publish/route";
import * as settings from "../app/api/manager/settings/route";
import * as forget from "../app/api/employee/forget/route";

process.env.DATABASE_URL = process.env.POSTGRES_URL = "isolated-test-database";
const managerPin = String(randomInt(100000, 1000000));
process.env.STAFF_SCHEDULE_MANAGER_PIN_HASH = await createPinHash(managerPin);
process.env.STAFF_SCHEDULE_MANAGER_SESSION_SECRET = randomBytes(32).toString("base64url");
after(() => testDatabase.close());

function request(path: string, method = "GET", body?: unknown, cookie = "", ip = "test-client") {
  return new Request(`https://schedule.test${path}`, {
    method, headers: { "content-type": "application/json", cookie, "x-forwarded-for": ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function session(response: Response, prefix = "") {
  const value = response.headers.getSetCookie().find(value => value.startsWith(prefix));
  assert.ok(value, "session cookie returned");
  assert.match(value, /HttpOnly/);
  return value.split(";")[0];
}
async function json(response: Response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

test("isolated database: employee PINs, privacy, draft/save/publish, renaming and reset", async () => {
  // Privacy: an unknown device never receives the team list.
  const anonymous = await json(await employees.GET(request("/api/employees")));
  assert.deepEqual(anonymous, { employee: null });
  await json(await login.POST(request("/login", "POST", { employeeId: 1, pin: "1234" })), 401);
  await json(await settings.GET(request("/settings")), 401);
  await json(await settings.POST(request("/settings", "POST", { scheduleVisibility: "own" })), 401);
  await json(await availability.GET(request("/api/availability")), 401);
  await json(await manager.GET(request("/api/manager/availability")), 401);
  await json(await rename.PATCH(request("/rename", "PATCH", { displayName: "Test Staff" }), params(1)), 401);
  const managerResponse = await managerLogin.POST(request("/login", "POST", { pin: managerPin }));
  await json(managerResponse);
  const managerCookie = session(managerResponse);
  const employeeCookies: string[] = [];
  const deviceCookies: string[] = [];
  const employeePins = [String(randomInt(1000, 10000)), String(randomInt(1000, 10000))];
  for (const id of [1, 2]) {
    const generated = await json(await link.POST(request("/link", "POST", {}, managerCookie), params(id)));
    const token = new URL(generated.link).pathname.split("/").pop()!;
    const landing = await entry.GET(request(`/e/${token}`), { params: Promise.resolve({ token }) });
    const setupCookie = session(landing);
    const pin = employeePins[id - 1];
    const configured = await setup.POST(request("/setup", "POST", { pin, confirmPin: pin }, setupCookie));
    await json(configured);
    employeeCookies.push(session(configured, "staff_schedule_employee_session="));
    deviceCookies.push(session(configured, "staff_schedule_employee_device="));
    await json(await setup.POST(request("/setup", "POST", { pin, confirmPin: pin }, setupCookie)), 401);
    // A bound device sees only its own employee, and the body cannot pick someone else.
    const bound = await json(await employees.GET(request("/api/employees", "GET", undefined, deviceCookies[id - 1])));
    assert.deepEqual(bound, { employee: { id, displayName: String(id) } });
    await json(await login.POST(request("/login", "POST", { pin })), 401);
    await json(await login.POST(request("/login", "POST", { employeeId: id === 1 ? 2 : 1, pin }, deviceCookies[id - 1])));
  }
  const week = nextWeekStart();
  await json(await availability.POST(request("/availability", "POST", { weekStart: week, employeeId: 2, availability: { [week]: "11-C" } }, employeeCookies[0])));
  const own = await json(await availability.GET(request("/availability?employeeId=2", "GET", undefined, employeeCookies[0])));
  assert.equal(own.employee.id, 1);
  assert.deepEqual(own.record.availability, { [week]: "11-C" });
  const other = await json(await availability.GET(request("/availability", "GET", undefined, employeeCookies[1])));
  assert.deepEqual(other.record.availability, {});
  assert.equal(own.draftAssignments, undefined);
  await json(await availability.POST(request("/availability", "POST", { weekStart: addDays(week, 7), availability: {} }, employeeCookies[0])), 400);
  const assignment = { weekStart: week, shiftDate: week, employeeId: 1, shiftCode: "early", assigned: true, startMinutes: 660, endMinutes: 960 };
  await json(await schedule.POST(request("/schedule", "POST", assignment, managerCookie)));
  await json(await save.POST(request("/save", "POST", { weekStart: week }, managerCookie)));
  assert.equal((await getPublishedSchedule(week)).publishedAt, null);
  assert.equal((await getPublishedSchedule(week)).assignments.length, 0);
  await json(await schedule.POST(request("/schedule", "POST", { ...assignment, shiftCode: "late", startMinutes: 1080, endMinutes: 1440 }, managerCookie)), 400);
  await json(await publish.POST(request("/publish", "POST", { weekStart: week }, managerCookie)));
  assert.equal((await getPublishedSchedule(week)).assignments[0].endMinutes, 960);
  await json(await schedule.POST(request("/schedule", "POST", { ...assignment, endMinutes: 1080 }, managerCookie)));
  assert.equal((await getPublishedSchedule(week)).assignments[0].endMinutes, 960);
  await json(await publish.POST(request("/publish", "POST", { weekStart: week }, managerCookie)));
  assert.equal((await getPublishedSchedule(week)).assignments[0].endMinutes, 1080);
  const publishedOne = await json(await availability.GET(request("/availability", "GET", undefined, employeeCookies[0])));
  const publishedTwo = await json(await availability.GET(request("/availability", "GET", undefined, employeeCookies[1])));
  assert.deepEqual(publishedOne.publishedSchedules, publishedTwo.publishedSchedules);
  assert.deepEqual(publishedOne.record.availability, { [week]: "11-C" });
  assert.equal(publishedTwo.scheduleVisibility, "full");
  assert.equal(publishedTwo.publishedSchedules.next.employees.length, 8);
  // "Own shifts only": the server strips other people's names and shifts.
  await json(await settings.POST(request("/settings", "POST", { scheduleVisibility: "bogus" }, managerCookie)), 400);
  await json(await settings.POST(request("/settings", "POST", { scheduleVisibility: "own" }, managerCookie)));
  const ownOnly = await json(await availability.GET(request("/availability", "GET", undefined, employeeCookies[1])));
  assert.equal(ownOnly.scheduleVisibility, "own");
  assert.deepEqual(ownOnly.publishedSchedules.next.employees, [{ id: 2, displayName: "2" }]);
  assert.deepEqual(ownOnly.publishedSchedules.next.assignments, []);
  assert.equal(JSON.stringify(ownOnly).includes(`"displayName":"1"`), false);
  assert.equal((await json(await settings.GET(request("/settings", "GET", undefined, managerCookie)))).scheduleVisibility, "own");
  await json(await settings.POST(request("/settings", "POST", { scheduleVisibility: "full" }, managerCookie)));
  await json(await rename.PATCH(request("/rename", "PATCH", { displayName: "Test Staff" }, managerCookie), params(1)));
  await json(await rename.PATCH(request("/rename", "PATCH", { displayName: "test staff" }, managerCookie), params(2)), 409);
  await json(await rename.PATCH(request("/rename", "PATCH", { displayName: " " }, managerCookie), params(2)), 400);
  const renamed = await json(await availability.GET(request("/availability", "GET", undefined, employeeCookies[0])));
  assert.equal(renamed.employee.displayName, "Test Staff");
  assert.deepEqual(renamed.record.availability, { [week]: "11-C" });
  const overview = await json(await manager.GET(request("/manager", "GET", undefined, managerCookie)));
  assert.equal(overview.records.length, 8);
  assert.equal(overview.draftAssignments.length, 1);
  await json(await link.POST(request("/link", "POST", {}, managerCookie), params(1)));
  await json(await availability.GET(request("/availability", "GET", undefined, employeeCookies[0])), 401);
  // Resetting an employee also unbinds their old phone.
  assert.deepEqual(await json(await employees.GET(request("/api/employees", "GET", undefined, deviceCookies[0]))), { employee: null });
  await json(await login.POST(request("/login", "POST", { pin: employeePins[0] }, deviceCookies[0])), 401);
  // Rotating IP headers must not bypass the per-account lock.
  const wrongEmployeePin = employeePins[1] === "0000" ? "9999" : "0000";
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await login.POST(request("/login", "POST", { pin: wrongEmployeePin }, deviceCookies[1], `rotating-${attempt}`));
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [...Array(9).fill(401), 429]);
  await json(await login.POST(request("/login", "POST", { pin: employeePins[1] }, deviceCookies[1], "brand-new-ip")), 429);
  // "Not me": removes the binding from this phone.
  const forgotten = await forget.POST(request("/forget", "POST", undefined, `${employeeCookies[1]}; ${deviceCookies[1]}`));
  assert.ok(forgotten.headers.getSetCookie().some((value) => value.startsWith("staff_schedule_employee_device=;")));
  assert.deepEqual(await json(await employees.GET(request("/api/employees", "GET", undefined, deviceCookies[1]))), { employee: null });
  for (let attempt = 0; attempt < 5; attempt++) {
    const wrongPin = managerPin === "000000" ? "999999" : "000000";
    await json(await managerLogin.POST(request("/login", "POST", { pin: wrongPin }, "", "blocked-client")), attempt === 4 ? 429 : 401);
  }
  await json(await managerLogin.POST(request("/login", "POST", { pin: managerPin }, "", "blocked-client")), 429);
});

test("Toronto Monday rollover follows local midnight", () => {
  assert.equal(currentWeekStart(new Date("2026-09-07T03:59:59Z")), "2026-08-31");
  assert.equal(currentWeekStart(new Date("2026-09-07T04:00:00Z")), "2026-09-07");
  assert.equal(nextWeekStart(new Date("2026-09-07T04:00:00Z")), "2026-09-14");
});
