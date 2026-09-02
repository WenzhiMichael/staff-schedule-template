import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Bundle the real routes, substituting only the remote database transport.
const output = new URL("../.test-cache/workflow.mjs", import.meta.url);
await build({
  entryPoints: [fileURLToPath(new URL("./workflow.ts", import.meta.url))],
  outfile: fileURLToPath(output), bundle: true, platform: "node", format: "esm",
  packages: "external",
  alias: { "@neondatabase/serverless": fileURLToPath(new URL("./postgres-test.ts", import.meta.url)) },
});
const result = spawnSync(process.execPath, ["--test", fileURLToPath(output)], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
