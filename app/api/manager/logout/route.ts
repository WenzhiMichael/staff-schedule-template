import { clearManagerSessionCookie } from "../../../../db/manager-auth";

export async function POST(request: Request) {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearManagerSessionCookie(request) } });
}
