// Prints md5(prosrc) of the named functions after building every migration on PGlite, to compare
// with the live project (MCP execute_sql: select proname, md5(replace(prosrc, E'\r', '')) from pg_proc ...).
//   node fn-hash.mjs sales_report revise_tickets
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs"; import path from "node:path";
const root = path.resolve("../.."); const mig = path.join(root, "migrations");
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(fs.readFileSync(path.join(root, "local/shim.sql"), "utf8"));
for (const f of fs.readdirSync(mig).filter((f) => f.endsWith(".sql")).sort()) await db.exec(fs.readFileSync(path.join(mig, f), "utf8"));
for (const x of (await db.query(`select p.proname, md5(replace(p.prosrc, E'\r', '')) as m from pg_proc p where p.proname = any($1) order by 1`, [process.argv.slice(2)])).rows) console.log(x.proname, x.m);
