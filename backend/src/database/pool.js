import pg from "pg";
import { config } from "../config/index.js";
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  statement_timeout: 8000,
});
pool.on("error", (err) =>
  console.error(JSON.stringify({ event: "pool_error", code: err.code })),
);
