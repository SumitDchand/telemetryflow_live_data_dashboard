export const config = {
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  origins: (
    process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
  ).split(","),
  adminToken: process.env.ADMIN_TOKEN,
};
