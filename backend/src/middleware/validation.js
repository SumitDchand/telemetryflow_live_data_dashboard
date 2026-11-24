import { z } from "zod";
export const id = z.string().regex(/^MCH-\d{3}$/);
const date = z.iso.datetime({ offset: true }).optional();
export const querySchema = z
  .object({
    machine_id: id.optional(),
    start: date,
    end: date,
    range: z.enum(["15m", "1h", "6h", "24h", "7d"]).default("1h"),
    metric: z
      .enum(["temperature", "pressure", "vibration", "power"])
      .default("temperature"),
    severity: z.enum(["warning", "critical"]).optional(),
    status: z.enum(["active", "acknowledged"]).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    cursor: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
  })
  .refine((q) => !q.start || !q.end || new Date(q.start) <= new Date(q.end), {
    message: "Start must precede end",
  })
  .refine(
    (q) =>
      !q.start ||
      !q.end ||
      new Date(q.end) - new Date(q.start) <= 31 * 86400000,
    { message: "Maximum date range is 31 days" },
  );
export function parseQuery(req) {
  return querySchema.parse(req.query);
}
export function fail(status, message) {
  return Object.assign(new Error(message), { status });
}
