import { initializeAvailabilityDatabase, listEmployees } from "../../../db/availability";

export async function GET() {
  try {
    await initializeAvailabilityDatabase();
    return Response.json({ employees: await listEmployees() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "员工名单暂时无法打开。";
    return Response.json({ error: message }, { status: 500 });
  }
}
