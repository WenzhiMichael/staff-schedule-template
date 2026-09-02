import { PGlite } from "@electric-sql/pglite";

export const testDatabase = new PGlite();
export function neon(connection: string) {
  if (connection !== "isolated-test-database") throw new Error("Tests must use the isolated database.");
  return {
    async query(sql: string, values: unknown[]) {
      return (await testDatabase.query(sql, values)).rows;
    },
  };
}
