/**
 * Channel configuration from the environment (Phase 5 path). Zod at the boot
 * boundary — a missing required secret fails fast with a plain-English
 * ConfigurationError, never a confusing provider 4xx at send time.
 */

import { z } from "zod";

import type { ChannelCredentials } from "./types";

export const channelEnvSchema = z.object({
  META_APP_SECRET: z.string().min(1).optional(),
  META_PAGE_TOKEN: z.string().min(1).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1).optional(),
  TIKTOK_CLIENT_SECRET: z.string().min(1).optional(),
  TIKTOK_ACCESS_TOKEN: z.string().min(1).optional(),
  WIDGET_TOKEN: z.string().min(1).optional(),
  /** Verify token for the Meta webhook challenge handshake (GET). */
  META_VERIFY_TOKEN: z.string().min(1).optional(),
  /** Public base URL for the setup screen's webhook URLs (Caddy provisioned). */
  PUBLIC_BASE_URL: z.string().url().optional(),
});

export type ChannelEnv = z.infer<typeof channelEnvSchema>;

export function credentialsFromEnv(
  env: Partial<ChannelEnv> = process.env as Partial<ChannelEnv>,
): ChannelCredentials {
  return {
    appSecret: env.META_APP_SECRET,
    accessToken: env.META_PAGE_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    clientSecret: env.TIKTOK_CLIENT_SECRET,
    tiktokAccessToken: env.TIKTOK_ACCESS_TOKEN,
    widgetToken: env.WIDGET_TOKEN,
  };
}
