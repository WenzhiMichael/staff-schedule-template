import { initializeAvailabilityDatabase } from "../../../db/availability";
import { getDeviceEmployee } from "../../../db/employee-auth";
import { serverError } from "../../../db/errors";

// Never returns the team list. A phone only learns the one employee that its
// one-time setup link bound it to; an unknown device gets `employee: null`.
export async function GET(request: Request) {
  try {
    await initializeAvailabilityDatabase();
    const device = await getDeviceEmployee(request);
    return Response.json(
      { employee: device ? { id: device.id, displayName: device.display_name } : null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return serverError(error, "员工入口暂时无法打开。");
  }
}
