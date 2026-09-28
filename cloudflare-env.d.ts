declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    MELI_ENCRYPTION_KEY?: string;
    MELI_AUTOMATION_SECRET?: string;
    ANTHROPIC_API_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
