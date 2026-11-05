import {
  clearEmployeeDeviceCookie,
  clearEmployeeSessionCookie,
  revokeEmployeeDevice,
  revokeEmployeeSession,
} from "../../../../db/employee-auth";

// "Not me / shared phone": signs out and removes this phone's employee binding.
export async function POST(request: Request) {
  await revokeEmployeeSession(request);
  await revokeEmployeeDevice(request);
  const headers = new Headers();
  headers.append("set-cookie", clearEmployeeSessionCookie(request));
  headers.append("set-cookie", clearEmployeeDeviceCookie(request));
  return Response.json({ ok: true }, { headers });
}
