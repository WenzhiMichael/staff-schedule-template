import { createEmployeeSetupCookie, hashEmployeeToken } from "../../../db/employee-auth";
import { getAvailabilityD1, initializeAvailabilityDatabase } from "../../../db/availability";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  await initializeAvailabilityDatabase();
  const token = (await context.params).token;
  const origin = new URL(request.url).origin;
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return Response.redirect(`${origin}/?access=invalid`, 302);
  const tokenHash = await hashEmployeeToken(token);
  const employee = await getAvailabilityD1().prepare(
    `SELECT e.id FROM employee_access_tokens t
     JOIN availability_employees e ON e.id = t.employee_id
     WHERE t.token_hash = ? AND e.active = 1`,
  ).bind(tokenHash).first();
  if (!employee) return Response.redirect(`${origin}/?access=invalid`, 302);
  return new Response(null, {
    status: 302,
    headers: {
      location: `${origin}/?setup=1`,
      "set-cookie": createEmployeeSetupCookie(request, token),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
