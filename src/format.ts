import type { AppItem, CatalogGroup, FlowItem, MobbinClient, ScreenItem, SearchPage } from "./client.js";

const M = "https://mobbin.com";
const LOCK = "🔒 Pro-only";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export const appUrl = (a: { id: string; appName: string; platform: string }) => `${M}/apps/${slug(a.appName)}-${a.platform}-${a.id}`;

function header(title: string, shown: number, total: number | null, restricted: number) {
  let h = `## ${title}\nShowing ${shown}${total != null ? ` of ${total}` : ""}.`;
  if (restricted) h += ` ${restricted} of the shown results are ${LOCK} on your Mobbin plan (metadata only).`;
  return h + "\n";
}

export function screens(page: SearchPage<ScreenItem>, limit: number): string {
  const items = page.data.slice(0, limit);
  if (!items.length) return "No screens found. Check filter names with mobbin_get_filters, or try a `query` instead.";
  const out = [header("Screens", items.length, page.totalCount, items.filter((s) => s.restricted).length)];
  items.forEach((s, i) => {
    const tags = [...(s.screenPatterns ?? []), ...(s.screenElements ?? [])];
    out.push(
      `${i + 1}. **${s.appName.trim()}** (${s.platform})${s.restricted ? ` ${LOCK}` : ""}${s.animationCdnVideoSources ? " (animated)" : ""}\n` +
        `   ${tags.length ? tags.join(", ") : "—"}\n` +
        `   screen_id: \`${s.id}\` · app_id: \`${s.appId}\` · ${M}/screens/${s.id}`,
    );
  });
  return out.join("\n");
}

export function flows(page: SearchPage<FlowItem>, limit: number, title = "Flows"): string {
  const items = page.data.slice(0, limit);
  if (!items.length) return "No flows found.";
  const out = [header(title, items.length, page.totalCount, items.filter((f) => f.restricted).length)];
  items.forEach((f, i) => {
    out.push(
      `${i + 1}. **${f.appName.trim()} — ${f.name}**${f.restricted ? ` ${LOCK}` : ""}\n` +
        `   ${f.actions?.length ? f.actions.join(", ") : "—"} · ${f.screens?.length ?? "?"} screens\n` +
        `   flow_id: \`${f.id}\` · app_id: \`${f.appId}\` · ${M}/flows/${f.id}`,
    );
  });
  return out.join("\n");
}

export function apps(page: SearchPage<AppItem>, limit: number): string {
  const items = page.data.slice(0, limit);
  if (!items.length) return "No apps found.";
  const out = [header("Apps", items.length, page.totalCount, items.filter((a) => a.isRestricted).length)];
  items.forEach((a, i) => out.push(appLine(a, i)));
  return out.join("\n");
}

function appLine(a: AppItem, i: number) {
  const updated = a.appVersionPublishedAt ? ` · updated ${a.appVersionPublishedAt.slice(0, 10)}` : "";
  return (
    `${i + 1}. **${a.appName.trim()}** (${a.platform})${a.isRestricted ? ` ${LOCK}` : ""} — ${a.appTagline ?? ""}\n` +
    `   app_id: \`${a.id}\`${updated} · ${appUrl(a)}`
  );
}

export function appList(items: AppItem[], title: string): string {
  return [`## ${title}`, ...items.map((a, i) => appLine(a, i))].join("\n");
}

export function appScreens(
  r: Awaited<ReturnType<MobbinClient["appVersionsScreens"]>>,
  versionIndex: number,
  offset: number,
  limit: number,
): string {
  const versions = r.appVersions;
  const v = versions[versionIndex];
  if (!v) return `${r.appName} has ${versions.length} version(s); version_index ${versionIndex} does not exist.`;
  const all = v.appScreens;
  const slice = all.slice(offset, offset + limit);
  const out = [
    `## ${r.appName} (${r.platform}) — screens`,
    `Version ${versionIndex + 1}/${versions.length}, published ${v.publishedAt.slice(0, 10)}. ` +
      `Showing ${offset + 1}–${offset + slice.length} of ${all.length} screens.` +
      (versions.length > 1 ? ` Other versions: ${versions.map((x, i) => `[${i}] ${x.publishedAt.slice(0, 10)} (${x.appScreens.length})`).join(", ")}.` : ""),
    "",
    ...slice.map((s, i) => `${offset + i + 1}. \`${s.id}\` · ${M}/screens/${s.id}`),
  ];
  if (offset + slice.length < all.length) out.push(`\nMore: call again with offset ${offset + slice.length}.`);
  return out.join("\n");
}

export function flowDetail(f: Awaited<ReturnType<MobbinClient["flowInfo"]>>): string {
  const actions = (f.content_dictionary_tags ?? []).map((t) => t.dictionary_entries?.displayName).filter(Boolean);
  const out = [
    `## ${f.app.appName} — ${f.name} (${f.app.platform})`,
    `${M}/flows/${f.id}`,
    actions.length ? `Actions: ${actions.join(", ")}` : "",
    `${f.appSectionScreens.length} screens:`,
  ];
  f.appSectionScreens.forEach((s, i) => {
    const tags = (s.appScreen.content_dictionary_tags ?? []).map((t) => t.dictionary_entries?.displayName).filter(Boolean);
    out.push(`${i + 1}. \`${s.appScreen.id}\`${tags.length ? ` — ${tags.join(", ")}` : ""}`);
  });
  return out.filter((l) => l !== "").join("\n");
}

export function screenDetail(s: Awaited<ReturnType<MobbinClient["screenInfo"]>>): string {
  return [
    `## ${s.app.appName} (${s.app.platform}) — screen`,
    `screen_id: \`${s.id}\` · app_id: \`${s.app.id}\``,
    s.positionInVersion != null ? `Position in app: #${s.positionInVersion + 1}` : "",
    `${M}/screens/${s.id}`,
    s.animationCdnVideoSources ? "Has an animation/video on Mobbin." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function popular(
  r: Record<string, Array<{ app_id: string; app_name: string; app_tagline?: string }>>,
  platform: string,
): string {
  const out = [`## Popular ${platform} apps by category`];
  for (const [cat, list] of Object.entries(r)) {
    out.push(`\n**${cat}**`);
    for (const a of list) out.push(`- ${a.app_name}${a.app_tagline ? ` — ${a.app_tagline}` : ""} · app_id \`${a.app_id}\``);
  }
  return out.join("\n");
}

export function collections(list: Array<Record<string, unknown>>): string {
  if (!list.length) return "You have no saved collections on Mobbin.";
  return [
    `## Your collections (${list.length})`,
    ...list.map((c, i) => {
      const counts = ["appsCount", "screensCount", "flowsCount", "apps_count", "screens_count", "flows_count"]
        .filter((k) => typeof c[k] === "number")
        .map((k) => `${c[k]} ${k.replace(/_?[cC]ount$/, "")}`);
      return `${i + 1}. **${c.name ?? c.title ?? "Untitled"}** · id \`${c.id}\`${counts.length ? ` · ${counts.join(", ")}` : ""}`;
    }),
  ].join("\n");
}

export function filters(groups: CatalogGroup, kind: string, withDefs: boolean): string {
  const out = [`## ${kind} (use the exact names)`];
  for (const g of groups) {
    out.push(`\n**${g.displayName}**`);
    for (const t of g.tags) {
      if (withDefs) out.push(`- ${t.displayName}${t.definition ? `: ${t.definition}` : ""}`);
      else out.push(`- ${t.displayName}`);
    }
  }
  return out.join("\n");
}
