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
  const list = await json(await employees.GET());
  assert.deepEqual(list.employees, Array.from({ length: 8 }, (_, index) => ({ id: index + 1, displayName: String(index + 1) })));
  await json(await availability.GET(request("/api/availability")), 401);
  await json(await manager.GET(request("/api/manager/availability")), 401);
  await json(await rename.PATCH(request("/rename", "PATCH", { displayName: "Test Staff" }), params(1)), 401);
  const managerResponse = await managerLogin.POST(request("/login", "POST", { pin: managerPin }));
  await json(managerResponse);
  const managerCookie = session(managerResponse);
  const employeeCookies: string[] = [];
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
    await json(await setup.POST(request("/setup", "POST", { pin, confirmPin: pin }, setupCookie)), 401);
    await json(await login.POST(request("/login", "POST", { employeeId: id, pin })));
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
  await json(await login.POST(request("/login", "POST", { employeeId: 1, pin: employeePins[0] })), 409);
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
