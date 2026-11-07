import { readFileSync } from "node:fs";

let result;
try {
  result = JSON.parse(readFileSync(0, "utf8"));
} catch {
  result = null;
}

const migrations = result?.migrations;
if (
  !Array.isArray(migrations) ||
  migrations.length === 0 ||
  migrations.some(
    (row) =>
      row === null ||
      typeof row !== "object" ||
      typeof row.local !== "string" ||
      row.local.length === 0 ||
      row.local !== row.remote,
  )
) {
  console.error("Production migration history does not match local migrations.");
  process.exitCode = 1;
}
