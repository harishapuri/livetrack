#!/usr/bin/env node
/**
 * CLI: regenerate PostgreSQL SQL (+ dashboard) from executions/*.xlsx
 *
 *   npm run generate-day-sql
 *   node liveact/scripts/generate-day-sql.js --date=2026-07-18
 *   node liveact/scripts/generate-day-sql.js --from=2026-07-01 --to=2026-07-18
 */
const { generatePostgresSql } = require("../generate-sql");

function parseArgs(argv) {
  const args = argv.slice(2);
  let dateFilter = null;
  let dateFrom = null;
  let dateTo = null;
  for (const a of args) {
    if (a.startsWith("--date=")) dateFilter = a.slice("--date=".length);
    else if (a.startsWith("--from=")) dateFrom = a.slice("--from=".length);
    else if (a.startsWith("--to=")) dateTo = a.slice("--to=".length);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(a) && !dateFilter) dateFilter = a;
  }
  return { dateFilter, dateFrom, dateTo };
}

generatePostgresSql({ ...parseArgs(process.argv), quiet: false }).catch((err) => {
  console.error(err);
  process.exit(1);
});
