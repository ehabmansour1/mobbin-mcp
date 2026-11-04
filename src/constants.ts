export const MOBBIN_URL = "https://mobbin.com";
export const SUPABASE_URL = "https://ujasntkfphywizsdaapi.supabase.co";

/** Public publishable key shipped in Mobbin's own browser JS (needed only for token refresh). Override with MOBBIN_SUPABASE_KEY. */
export const SUPABASE_KEY = process.env.MOBBIN_SUPABASE_KEY || "sb_publishable_YptnKskI90SD2g25sAvVxQ_tZltjYFE";

export const COOKIE_PREFIX = "sb-ujasntkfphywizsdaapi-auth-token";
export const COOKIE_CHUNK_SIZE = 3180;
export const REFRESH_BUFFER_SECONDS = 300;

/** Minimum gap between Mobbin API calls, to stay well clear of their rate limiter. */
export const MIN_REQUEST_GAP_MS = 400;
export const REQUEST_TIMEOUT_MS = 30_000;

export const IMAGE_HOST = "bytescale.mobbin.com";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
