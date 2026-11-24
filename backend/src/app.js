import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { routes } from "./routes/api.js";
import { errors } from "./middleware/errors.js";
import { config } from "./config/index.js";
export function createApp(
  db,
  runtime = { clients: () => 0, broadcast: () => {} },
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) =>
        cb(null, !origin || config.origins.includes(origin)),
    }),
  );
  app.use((req, res, next) => {
    if (req.headers.origin && !config.origins.includes(req.headers.origin))
      return res.status(403).json({ error: { message: "Origin not allowed" } });
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: { message: "Too many requests; retry shortly" } },
    }),
  );
  app.use((req, res, next) => {
    const started = performance.now();
    res.on("finish", () =>
      console.log(
        JSON.stringify({
          event: "http",
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Math.round(performance.now() - started),
        }),
      ),
    );
    next();
  });
  app.use("/api", routes(db, runtime));
  app.use((req, res) =>
    res.status(404).json({ error: { message: "Route not found" } }),
  );
  app.use(errors);
  return app;
}
