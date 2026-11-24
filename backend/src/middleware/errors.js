import { ZodError } from "zod";
export function errors(err, req, res, next) {
  const status = err instanceof ZodError ? 400 : err.status || 503;
  console.error(
    JSON.stringify({
      event: "request_error",
      path: req.path,
      code: err.code,
      status,
    }),
  );
  res
    .status(status)
    .json({
      error: {
        message:
          status === 400
            ? "Invalid request parameters"
            : status < 500
              ? err.message
              : "Service temporarily unavailable",
        ...(err instanceof ZodError
          ? { details: err.issues.map((i) => i.message) }
          : {}),
      },
    });
}
