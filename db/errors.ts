/**
 * Logs the real error on the server and returns only a generic message,
 * so database or configuration details never reach the browser.
 */
export function serverError(error: unknown, message: string, status = 500) {
  console.error(error);
  return Response.json({ error: message }, { status });
}
