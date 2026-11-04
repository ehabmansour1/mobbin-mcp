#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SessionManager, loadSession } from "./auth.js";
import { runAuthCli } from "./cli-auth.js";
import { MobbinClient, MobbinError, type FlowQuery, type Platform, type ScreenQuery } from "./client.js";
import * as fmt from "./format.js";

const VERSION = "2.0.0";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "auth") return runAuthCli(process.argv.slice(3));
  if (cmd === "--version" || cmd === "-v") return console.log(VERSION);

  const session = loadSession();
  if (!session) {
    console.error("mobbin-mcp: not logged in. Run `mobbin-mcp auth` (or `npm run auth`) first, or set MOBBIN_AUTH_COOKIE.");
    process.exit(1);
  }
  const client = new MobbinClient(new SessionManager(session, !process.env.MOBBIN_AUTH_COOKIE));
  const server = new McpServer({ name: "mobbin", version: VERSION });
  registerTools(server, client);
  await server.connect(new StdioServerTransport());
}

const platform = z.enum(["ios", "android", "web"]).default("ios").describe("Platform to search (default ios)");
const limit = (def: number, max: number) =>
  z.number().int().min(1).max(max).default(def).describe(`How many results to show (default ${def}, max ${max})`);
const strList = (d: string) => z.array(z.string()).optional().describe(d);

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function wrap<A>(fn: (a: A) => Promise<{ content: Content[] }>) {
  return async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      const msg = e instanceof MobbinError ? e.message : `Unexpected error: ${(e as Error).message}`;
      return { content: [{ type: "text" as const, text: msg }], isError: true };
    }
  };
}

function registerTools(server: McpServer, client: MobbinClient) {
  server.registerTool(
    "mobbin_search_screens",
    {
      title: "Search Mobbin screens",
      description:
        "Search real app screenshots across Mobbin. Use `query` for a natural-language AI search (e.g. 'dark mode settings with toggles'), " +
        "or filters (screen_patterns, screen_elements, categories) for Mobbin's taxonomy — get valid names from mobbin_get_filters. " +
        "Results include screen IDs; pass one to mobbin_get_screen_detail to see the image.",
      inputSchema: {
        query: z.string().optional().describe("Natural-language search. When set, taxonomy filters are ignored."),
        platform,
        screen_patterns: strList("Screen patterns, e.g. ['Signup', 'Subscription & Paywall']"),
        screen_elements: strList("UI elements, e.g. ['Bottom Sheet', 'Card']"),
        categories: strList("App categories, e.g. ['Finance']"),
        text_in_screenshot: z.string().optional().describe("Match visible (OCR) text inside screenshots"),
        has_animation: z.boolean().optional().describe("Only screens with an animation/video"),
        sort_by: z.enum(["trending", "publishedAt"]).default("trending").describe("Sort order for filter searches"),
        limit: limit(20, 100),
      },
    },
    wrap(async (a) => {
      const q: ScreenQuery = a.query
        ? { type: "free_text_search", query: a.query, mode: "standard", textInScreenshotQuery: a.text_in_screenshot ?? null, hasAnimation: a.has_animation ?? null }
        : {
            type: "filters",
            categories: a.categories?.length ? a.categories : null,
            screenPatterns: a.screen_patterns?.length ? a.screen_patterns : null,
            screenElements: a.screen_elements?.length ? a.screen_elements : null,
            textInScreenshotQuery: a.text_in_screenshot ?? null,
            hasAnimation: a.has_animation ?? null,
            sortBy: a.sort_by,
          };
      const page = await client.searchScreens(a.platform as Platform, q);
      return text(fmt.screens(page, a.limit));
    }),
  );

  server.registerTool(
    "mobbin_search_flows",
    {
      title: "Search Mobbin flows",
      description:
        "Search user flows (multi-screen journeys like onboarding, checkout, login) across Mobbin. Use `query` for natural language " +
        "(e.g. 'Duolingo onboarding') or `flow_actions` for taxonomy filters (see mobbin_get_filters kind 'actions'). " +
        "Pass a flow ID to mobbin_get_flow for its screens.",
      inputSchema: {
        query: z.string().optional().describe("Natural-language search. When set, flow_actions/categories are ignored."),
        platform,
        flow_actions: strList("Flow actions, e.g. ['Logging In', 'Onboarding']"),
        categories: strList("App categories, e.g. ['Finance']"),
        sort_by: z.enum(["trending", "publishedAt"]).default("trending"),
        limit: limit(20, 100),
      },
    },
    wrap(async (a) => {
      const q: FlowQuery = a.query
        ? { type: "free_text_search", query: a.query, mode: "standard", textInScreenshotQuery: null, hasAnimation: null }
        : {
            type: "filters",
            categories: a.categories?.length ? a.categories : null,
            flowActions: a.flow_actions?.length ? a.flow_actions : null,
            sortBy: a.sort_by,
          };
      const page = await client.searchFlows(a.platform as Platform, q);
      return text(fmt.flows(page, a.limit));
    }),
  );

  server.registerTool(
    "mobbin_search_apps",
    {
      title: "Browse Mobbin apps",
      description:
        "Browse apps by category (e.g. Finance, Health & Fitness), newest first. To find a specific app by name use mobbin_quick_search instead.",
      inputSchema: {
        platform,
        categories: strList("App categories (see mobbin_get_filters kind 'categories')"),
        limit: limit(24, 50),
      },
    },
    wrap(async (a) => {
      const page = await client.searchApps(a.platform as Platform, a.categories?.length ? a.categories : null, "publishedAt");
      return text(fmt.apps(page, a.limit));
    }),
  );

  server.registerTool(
    "mobbin_quick_search",
    {
      title: "Find an app by name",
      description: "Look up apps by name (autocomplete) and get their app IDs, for mobbin_get_app_screens / mobbin_get_app_flows.",
      inputSchema: {
        query: z.string().min(1).describe("App name, e.g. 'Notion'"),
        platform,
        limit: limit(5, 10),
      },
    },
    wrap(async (a) => {
      const r = await client.searchBar(a.query, a.platform as Platform);
      const ids = [...r.primary, ...r.other].filter((x) => x.type === "app").map((x) => x.id).slice(0, a.limit);
      if (!ids.length) return text(`No ${a.platform} apps found for "${a.query}".`);
      const infos = [];
      for (const id of ids) infos.push(await client.appInfo(id, a.platform as Platform).catch(() => null));
      return text(fmt.appList(infos.filter((x) => x !== null), `Apps matching "${a.query}" (${a.platform})`));
    }),
  );

  server.registerTool(
    "mobbin_get_app_screens",
    {
      title: "List an app's screens",
      description:
        "List every screen Mobbin has for one app (latest version by default). Get the app_id from mobbin_quick_search. " +
        "Returns screen IDs and links; use mobbin_get_screen_detail to view individual screens.",
      inputSchema: {
        app_id: z.string().uuid(),
        version_index: z.number().int().min(0).default(0).describe("0 = latest version, 1 = previous, …"),
        offset: z.number().int().min(0).default(0),
        limit: limit(50, 200),
      },
    },
    wrap(async (a) => {
      const r = await client.appVersionsScreens(a.app_id);
      return text(fmt.appScreens(r, a.version_index, a.offset, a.limit));
    }),
  );

  server.registerTool(
    "mobbin_get_app_flows",
    {
      title: "List an app's flows",
      description:
        "List user flows for one app (onboarding, login, checkout…). Get the app_id from mobbin_quick_search. " +
        "Optionally narrow with `topic` (e.g. 'onboarding'). Uses Mobbin's search scoped to the app, so very large apps may not list every flow.",
      inputSchema: {
        app_id: z.string().uuid(),
        platform,
        topic: z.string().optional().describe("Optional topic to narrow flows, e.g. 'checkout'"),
        limit: limit(50, 100),
      },
    },
    wrap(async (a) => {
      const info = await client.appInfo(a.app_id, a.platform as Platform);
      const query = a.topic ? `${info.appName} ${a.topic}` : info.appName;
      const page = await client.searchFlows(a.platform as Platform, {
        type: "free_text_search",
        query,
        mode: "standard",
        textInScreenshotQuery: null,
        hasAnimation: null,
      });
      const own = page.data.filter((f) => f.appId === a.app_id);
      return text(fmt.flows({ ...page, data: own, totalCount: own.length }, a.limit, `Flows for ${info.appName} (${a.platform})${a.topic ? ` — "${a.topic}"` : ""}`));
    }),
  );

  server.registerTool(
    "mobbin_get_flow",
    {
      title: "Get a flow's screens",
      description: "Get the ordered screens of one flow, with their patterns. Set include_images to also return the screenshots (up to max_images).",
      inputSchema: {
        flow_id: z.string().uuid(),
        include_images: z.boolean().default(false),
        max_images: z.number().int().min(1).max(12).default(6),
      },
    },
    wrap(async (a) => {
      const f = await client.flowInfo(a.flow_id);
      const content: Content[] = [{ type: "text", text: fmt.flowDetail(f) }];
      if (a.include_images) {
        for (const s of f.appSectionScreens.slice(0, a.max_images)) {
          try {
            const info = await client.screenInfo(s.appScreen.id);
            if (info.screenCdnImgSources) content.push({ type: "image", ...(await client.image(info.screenCdnImgSources, 540)) });
          } catch (e) {
            content.push({ type: "text", text: `(screen ${s.appScreen.id}: ${(e as Error).message})` });
          }
        }
      }
      return { content };
    }),
  );

  server.registerTool(
    "mobbin_get_screen_detail",
    {
      title: "View a screen",
      description: "Fetch one screen's screenshot (as an image the model can see) plus its app info. Takes a screen ID from any other tool.",
      inputSchema: {
        screen_id: z.string().uuid(),
        width: z.number().int().min(200).max(1600).default(720).describe("Approximate image width in px (smaller = cheaper)"),
      },
    },
    wrap(async (a) => {
      const s = await client.screenInfo(a.screen_id);
      const content: Content[] = [{ type: "text", text: fmt.screenDetail(s) }];
      if (s.screenCdnImgSources) content.push({ type: "image", ...(await client.image(s.screenCdnImgSources, a.width)) });
      else content.push({ type: "text", text: "Mobbin did not return an image for this screen." });
      return { content };
    }),
  );

  server.registerTool(
    "mobbin_popular_apps",
    {
      title: "Popular apps by category",
      description: "Most popular apps on Mobbin, grouped by category.",
      inputSchema: { platform, limit_per_category: z.number().int().min(1).max(10).default(3) },
    },
    wrap(async (a) => text(fmt.popular(await client.popularApps(a.platform as Platform, a.limit_per_category), a.platform))),
  );

  server.registerTool(
    "mobbin_list_collections",
    {
      title: "List my collections",
      description: "List the collections saved in your Mobbin account.",
      inputSchema: {},
    },
    wrap(async () => text(fmt.collections(await client.collections()))),
  );

  server.registerTool(
    "mobbin_get_filters",
    {
      title: "List filter values",
      description:
        "Valid values for one filter facet, to use in the search tools: categories, patterns (screen patterns), elements (UI elements), actions (flow actions).",
      inputSchema: {
        kind: z.enum(["categories", "patterns", "elements", "actions"]),
        experience: z.enum(["mobile", "web"]).default("mobile"),
        include_definitions: z.boolean().default(false),
      },
    },
    wrap(async (a) => {
      const slug = { categories: "appCategories", patterns: "screenPatterns", elements: "screenElements", actions: "flowActions" }[a.kind];
      const cats = await client.catalogs();
      const groups = cats[a.experience]?.[slug];
      if (!groups) return text(`No ${a.kind} filters returned for ${a.experience}.`);
      return text(fmt.filters(groups, a.kind, a.include_definitions));
    }),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
