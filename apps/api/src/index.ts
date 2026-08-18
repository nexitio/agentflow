import { credentialsFromEnv } from "@agentflow/channels/config";
import { createRedisWidgetPublisher } from "@agentflow/channels/widget";
import { createDbClient } from "@agentflow/db/client";
import { loadEnv } from "@agentflow/shared/env";
import { logger } from "@agentflow/shared/logger";
import { serve } from "@hono/node-server";
import { z } from "zod";

import { createApp } from "./app";
import { createInboundQueue } from "./queue";
import { createRedisWidgetHub } from "./widget-hub";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  META_VERIFY_TOKEN: z.string().min(1).optional(),
  WIDGET_TOKEN: z.string().min(1).optional(),
});

const env = loadEnv(envSchema);

const db = env.DATABASE_URL === undefined ? undefined : createDbClient(env.DATABASE_URL).db;
if (db === undefined) {
  logger.warn("DATABASE_URL not set — flow and webhook routes will return a configuration error.");
}

const queue = env.REDIS_URL === undefined ? undefined : createInboundQueue(env.REDIS_URL);
if (queue === undefined) {
  logger.warn("REDIS_URL not set — webhooks will answer 503 (provider retries are safe).");
}

const widgetHub = env.REDIS_URL === undefined ? undefined : createRedisWidgetHub(env.REDIS_URL);
const widgetPublisher =
  env.REDIS_URL === undefined ? undefined : createRedisWidgetPublisher(env.REDIS_URL);

serve(
  {
    fetch: createApp({
      db,
      queue,
      widgetHub,
      widgetPublisher,
      channelCredentials: credentialsFromEnv(env),
      publicBaseUrl: env.PUBLIC_BASE_URL,
      metaVerifyToken: env.META_VERIFY_TOKEN,
      widgetToken: env.WIDGET_TOKEN,
    }).fetch,
    port: env.PORT,
  },
  (info) => {
    logger.info("api listening", { service: "api", port: info.port });
  },
);
