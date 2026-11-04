import { randomUUID } from "node:crypto";
import type { SessionManager } from "./auth.js";
import { IMAGE_HOST, MAX_IMAGE_BYTES, MIN_REQUEST_GAP_MS, MOBBIN_URL, REQUEST_TIMEOUT_MS, USER_AGENT } from "./constants.js";

export type Platform = "ios" | "android" | "web";

export interface CdnImg {
  src: string;
  srcSet?: Array<{ url: string; descriptor: string }>;
  downloadableSrc?: string | null;
}

export interface ScreenItem {
  id: string;
  appId: string;
  appName: string;
  platform: string;
  screenPatterns?: string[];
  screenElements?: string[];
  width?: number;
  height?: number;
  publishedAt?: string;
  restricted?: boolean;
  screenCdnImgSources?: CdnImg | null;
  animationCdnVideoSources?: unknown;
}

export interface FlowItem {
  id: string;
  name: string;
  actions?: string[];
  appId: string;
  appName: string;
  platform: string;
  publishedAt?: string;
  restricted?: boolean;
  screens?: Array<{ screenId: string; screenCdnImgSources?: CdnImg | null }>;
}

export interface AppItem {
  id: string;
  appName: string;
  appTagline?: string;
  platform: string;
  appVersionId?: string;
  appVersionPublishedAt?: string;
  isRestricted?: boolean;
  is_finance_plus?: boolean;
  previewScreens?: Array<{ id: string; screenCdnImgSources?: CdnImg | null }>;
}

export interface SearchPage<T> {
  searchRequestId: string;
  data: T[];
  hasNextPage: boolean;
  totalCount: number | null;
}

export type ScreenQuery =
  | {
      type: "filters";
      categories: string[] | null;
      screenElements: string[] | null;
      screenPatterns: string[] | null;
      textInScreenshotQuery: string | null;
      hasAnimation: boolean | null;
      sortBy: string;
    }
  | FreeTextQuery;

export type FlowQuery =
  | { type: "filters"; categories: string[] | null; flowActions: string[] | null; sortBy: string }
  | FreeTextQuery;

export interface FreeTextQuery {
  type: "free_text_search";
  query: string;
  mode: "standard";
  textInScreenshotQuery: string | null;
  hasAnimation: boolean | null;
}

export class MobbinError extends Error {}

const FRIENDLY: Record<string, string> = {
  unauthenticated: "Mobbin says you are not logged in. Run `mobbin-mcp auth` again.",
  "no workspaces": "Your Mobbin account has no workspace yet — open mobbin.com once in the browser to finish sign-up.",
  "concurrent deny": "Mobbin blocked this request because the account is active in another session. Try again in a moment.",
  "rate limited: clear captcha to continue":
    "Mobbin rate-limited this account and wants a captcha. Open mobbin.com in your browser, solve it, then retry.",
  "rate limited: banned": "Mobbin has temporarily blocked this account for too many requests. Wait a while before retrying.",
  "rate limited: backoff": "Mobbin asked us to slow down. Wait a minute and retry.",
};

export class MobbinClient {
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;
  private catalogCache: Promise<Catalogs> | null = null;

  constructor(private auth: SessionManager) {}

  /** Serialise calls and space them out — Mobbin rate-limits aggressive clients. */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastCall + MIN_REQUEST_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastCall = Date.now();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async api<T>(path: string, body?: unknown, retried = false): Promise<T> {
    const res = await this.schedule(async () =>
      fetch(`${MOBBIN_URL}${path}`, {
        method: "POST",
        headers: {
          Cookie: await this.auth.cookieHeader(),
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
          Origin: MOBBIN_URL,
          Referer: `${MOBBIN_URL}/`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );
    if (res.status === 401 && !retried) {
      await this.auth.refresh();
      return this.api<T>(path, body, true);
    }
    const text = await res.text();
    if (!res.ok) {
      const hint =
        res.status === 404
          ? " — Mobbin may have changed this internal endpoint; the server needs updating."
          : "";
      throw new MobbinError(`Mobbin API ${res.status} on ${path}${hint}`);
    }
    let json: { value?: T; error?: { message?: string } };
    try {
      json = JSON.parse(text);
    } catch {
      throw new MobbinError(`Mobbin returned non-JSON from ${path}`);
    }
    if (json.error) {
      const msg = json.error.message ?? "unknown error";
      if (msg === "unauthenticated" && !retried) {
        await this.auth.refresh();
        return this.api<T>(path, body, true);
      }
      throw new MobbinError(FRIENDLY[msg] ?? `Mobbin error on ${path}: ${msg}`);
    }
    return json.value as T;
  }

  // ---------- search ----------

  searchScreens(platform: Platform, q: ScreenQuery, pageIndex = 0) {
    return this.api<SearchPage<ScreenItem>>("/api/search/fetch-search-page-screens", {
      searchRequestId: randomUUID(),
      pageIndex,
      searchQuery: { platform, ...q },
    });
  }

  searchFlows(platform: Platform, q: FlowQuery, pageIndex = 0) {
    return this.api<SearchPage<FlowItem>>("/api/search/fetch-search-page-flows", {
      searchRequestId: randomUUID(),
      pageIndex,
      searchQuery: { platform, ...q },
    });
  }

  searchApps(platform: Platform, categories: string[] | null, sortBy: string, pageIndex = 0) {
    return this.api<SearchPage<AppItem>>("/api/search/fetch-search-page-apps", {
      searchRequestId: randomUUID(),
      pageIndex,
      searchQuery: { platform, type: "filters", categories, sortBy },
    });
  }

  searchBar(query: string, platform: Platform) {
    return this.api<{
      primary: Array<{ id: string; type: string }>;
      other: Array<{ id: string; type: string }>;
      secondaryPlatform: Array<{ id: string; type: string }>;
    }>("/api/search-bar/search", { query, experience: "apps", platform });
  }

  // ---------- details ----------

  appInfo(appId: string, platform: Platform) {
    return this.api<AppItem & { appLogoUrl?: string }>("/api/app/fetch-app-hover-card-info", { appId, platform });
  }

  appVersionsScreens(appId: string) {
    return this.api<{
      id: string;
      appName: string;
      platform: string;
      appVersions: Array<{ id: string; publishedAt: string; appScreens: Array<{ id: string }> }>;
    }>("/api/app/fetch-app-versions-screens", { appId });
  }

  screenInfo(screenId: string) {
    return this.api<{
      id: string;
      positionInVersion?: number;
      app: { id: string; appName: string; platform: string };
      screenCdnImgSources: CdnImg | null;
      fullpageScreenCdnImgSources: CdnImg | null;
      animationCdnVideoSources: unknown;
    }>("/api/screen/fetch-screen-info", { screenId });
  }

  flowInfo(flowId: string) {
    return this.api<{
      id: string;
      name: string;
      app: { appName: string; platform: string };
      appSectionScreens: Array<{
        appScreen: {
          id: string;
          content_dictionary_tags?: Array<{
            dictionary_entries?: {
              displayName: string;
              dictionary_sub_categories?: { dictionary_categories?: { slug: string } };
            };
          }>;
        };
      }>;
      content_dictionary_tags?: Array<{ dictionary_entries?: { displayName: string } }>;
    }>("/api/flow/fetch-flow-info", { flowId });
  }

  popularApps(platform: Platform, limitPerCategory: number) {
    return this.api<
      Record<string, Array<{ app_id: string; app_name: string; app_tagline?: string; preview_screens?: unknown[] }>>
    >("/api/popular-apps/fetch-popular-apps-with-preview-screens", { platform, limitPerCategory });
  }

  collections() {
    return this.api<Array<Record<string, unknown>>>("/api/collection/fetch-collections");
  }

  catalogs(): Promise<Catalogs> {
    if (!this.catalogCache) {
      this.catalogCache = this.api<Catalogs>("/api/filter-tags/fetch-filter-tag-catalogs");
      this.catalogCache.catch(() => (this.catalogCache = null));
    }
    return this.catalogCache;
  }

  // ---------- images ----------

  /** Fetch a signed Mobbin CDN image and return it base64-encoded. Only Mobbin's own signed URLs are accepted. */
  async image(img: CdnImg, targetWidth = 720): Promise<{ data: string; mimeType: string }> {
    const url = pickSrc(img, targetWidth);
    const u = new URL(url);
    if (u.hostname !== IMAGE_HOST) throw new MobbinError(`Refusing to fetch image from ${u.hostname}`);
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new MobbinError(`Image fetch failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new MobbinError("Image too large");
    if (buf.length < 1024) throw new MobbinError("Mobbin returned a placeholder instead of the image (probably a Pro-only screen).");
    return { data: buf.toString("base64"), mimeType: res.headers.get("content-type")?.split(";")[0] || "image/webp" };
  }
}

export function pickSrc(img: CdnImg, targetWidth: number): string {
  const set = (img.srcSet ?? [])
    .map((s) => ({ url: s.url, w: parseInt(s.descriptor, 10) }))
    .filter((s) => !Number.isNaN(s.w))
    .sort((a, b) => a.w - b.w);
  return (set.find((s) => s.w >= targetWidth) ?? set.at(-1))?.url ?? img.src;
}

export interface CatalogTag {
  id: string;
  displayName: string;
  subCategory?: string;
  definition?: string;
  synonyms?: string[];
  contentCounts?: Record<string, Record<string, number>>;
}
export type CatalogGroup = Array<{ displayName: string; tags: CatalogTag[] }>;
export type Catalogs = Record<string, Record<string, CatalogGroup>>;
