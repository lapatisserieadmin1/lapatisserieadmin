// Runs the SQL rule checks on PGlite (Postgres compiled to WebAssembly, in Node) instead of a local
// PostgreSQL: a fresh database per check file from ../shim.sql plus every migration, then the file,
// then ../check_results.py on the outcome. Nothing touches the Supabase project.
//
//   cd supabase/local/pglite && npm install
//   node run.mjs                    # every check file
//   node run.mjs packing_logic      # some
//
// Needs Python 3 for check_results.py (set PYTHON if it is not "python").
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const migrations = path.join(root, "migrations");
const tests = path.join(root, "tests");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "sql-checks-"));
const only = process.argv.slice(2);
const names = only.length
  ? only
  : fs.readdirSync(tests).filter((f) => f.endsWith(".sql") && f !== "qa_users.sql").map((f) => f.slice(0, -4));

let failed = false;
for (const name of names) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(fs.readFileSync(path.join(here, "../shim.sql"), "utf8"));
  for (const f of fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(fs.readFileSync(path.join(migrations, f), "utf8"));
    } catch (e) {
      console.log(`migration failed: ${f}: ${e.message}`);
      process.exit(1);
    }
  }
  console.log(name);
  try {
    const results = await db.exec(fs.readFileSync(path.join(tests, `${name}.sql`), "utf8"));
    const rows = [...results].reverse().find((r) => r.fields.some((f) => f.name === "check_name"))?.rows ?? [];
    const file = path.join(out, `${name}.out`);
    fs.writeFileSync(file, rows.map((r) => `${r.check_name} => ${r.outcome ?? "NULL"}`).join("\n") + "\n");
    const check = spawnSync(process.env.PYTHON ?? "python", [path.join(here, "../check_results.py"), path.join(tests, `${name}.sql`), file], {
      stdio: "inherit",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    if (check.status !== 0) failed = true;
  } catch (e) {
    console.log(`  ERROR running ${name}: ${e.message}`);
    failed = true;
  }
  await db.close();
}
process.exit(failed ? 1 : 0);
