import pg from "pg";
import { config } from "../config/index.js";
export function listen(onNotify) {
  let client,
    timer,
    stopped = false,
    attempt = 0;
  async function connect() {
    if (stopped) return;
    const connection = new pg.Client({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 3000,
    });
    client = connection;
    let failed = false;
    const retry = () => {
      if (failed || stopped) return;
      failed = true;
      connection.end().catch(() => {});
      timer = setTimeout(
        connect,
        Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)),
      );
    };
    connection.on("error", retry);
    connection.on("end", retry);
    connection.on("notification", onNotify);
    try {
      await connection.connect();
      await connection.query("LISTEN telemetry_committed");
      attempt = 0;
      onNotify();
    } catch {
      retry();
    }
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    return client?.end().catch(() => {});
  };
}
