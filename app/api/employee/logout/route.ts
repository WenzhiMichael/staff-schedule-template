import { clearEmployeeSessionCookie, revokeEmployeeSession } from "../../../../db/employee-auth";

export async function POST(request: Request) {
  await revokeEmployeeSession(request);
  return Response.json({ ok: true }, { headers: { "set-cookie": clearEmployeeSessionCookie(request) } });
}
