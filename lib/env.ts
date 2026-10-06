import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export function gmailCredentials() {
  return {
    user: required("GMAIL_USER"),
    // Google displays app passwords in groups of four separated by spaces.
    pass: required("GMAIL_APP_PASSWORD").replace(/\s+/g, ""),
  };
}

export function mongoUri() {
  return required("MONGODB_URI");
}

export function missingEnv(): string[] {
  return ["MONGODB_URI", "GMAIL_USER", "GMAIL_APP_PASSWORD", "CRON_SECRET", "APP_PASSWORD"].filter(
    (name) => !process.env[name]?.trim(),
  );
}
