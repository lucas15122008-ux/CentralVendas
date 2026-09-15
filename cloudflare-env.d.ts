declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    MELI_ENCRYPTION_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
