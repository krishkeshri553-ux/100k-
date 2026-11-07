/** Centralised, typed access to environment configuration. Secrets are only ever read from env, never from files in the repo. */
export interface Env {
  appEnv: "development" | "production" | "test";
  ownerName: string;
  ownerLinkedinUrl: string | null;
  ownerTimezone: string;
  anthropicApiKey: string | null;
  claudeModel: string;
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  trackerPassphrase: string | null;
  trackerSessionSecret: string | null;
  google: { clientId: string | null; clientSecret: string | null; refreshToken: string | null; calendarId: string };
  notifyWebhookUrl: string | null;
  backupEncryptionKey: string | null;
}

const v = (k: string): string | null => {
  const x = process.env[k];
  return x && x.trim() !== "" ? x.trim() : null;
};

export function loadEnv(): Env {
  const appEnv = (v("APP_ENV") ?? (process.env.VITEST ? "test" : "development")) as Env["appEnv"];
  return {
    appEnv,
    ownerName: v("OWNER_NAME") ?? "Krish Keshri",
    ownerLinkedinUrl: v("OWNER_LINKEDIN_URL"),
    ownerTimezone: v("OWNER_TIMEZONE") ?? "Asia/Kolkata",
    anthropicApiKey: v("ANTHROPIC_API_KEY"),
    claudeModel: v("CLAUDE_MODEL") ?? "claude-opus-5-5",
    supabaseUrl: v("SUPABASE_URL"),
    supabaseServiceRoleKey: v("SUPABASE_SERVICE_ROLE_KEY"),
    trackerPassphrase: v("TRACKER_PASSPHRASE"),
    trackerSessionSecret: v("TRACKER_SESSION_SECRET"),
    google: {
      clientId: v("GOOGLE_CLIENT_ID"),
      clientSecret: v("GOOGLE_CLIENT_SECRET"),
      refreshToken: v("GOOGLE_REFRESH_TOKEN"),
      calendarId: v("GOOGLE_CALENDAR_ID") ?? "primary",
    },
    notifyWebhookUrl: v("NOTIFY_WEBHOOK_URL"),
    backupEncryptionKey: v("BACKUP_ENCRYPTION_KEY"),
  };
}

export const isProduction = (env: Env) => env.appEnv === "production";
