// Calls every tool once against the live Mobbin API and prints PASS/FAIL.
// Usage: npm run build && npm run smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist", "index.js")], stderr: "inherit" });
const client = new Client({ name: "smoke", version: "1" });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log(`Server lists ${tools.length} tools: ${tools.join(", ")}\n`);

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const results = [];
async function call(name, args, { find } = {}) {
  const t = Date.now();
  let r;
  try {
    r = await client.callTool({ name, arguments: args });
  } catch (e) {
    r = { isError: true, content: [{ type: "text", text: String(e) }] };
  }
  const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const images = r.content.filter((c) => c.type === "image");
  const ok = !r.isError;
  results.push({ name, ok, ms: Date.now() - t, images: images.length, kb: Math.round(images.reduce((n, i) => n + i.data.length * 0.75, 0) / 1024), preview: text.replace(/\s+/g, " ").slice(0, 200) });
  return find ? (text.match(find) || [])[1] : text;
}

await call("mobbin_get_filters", { kind: "patterns" });
await call("mobbin_get_filters", { kind: "actions" });
await call("mobbin_search_screens", { screen_patterns: ["Signup"], limit: 5 });
const freeScreen = await call("mobbin_search_screens", { query: "dark mode settings toggle", limit: 20 });
await call("mobbin_search_flows", { flow_actions: ["Logging In"], limit: 5 });
await call("mobbin_search_flows", { query: "food delivery checkout", limit: 5 });
await call("mobbin_search_apps", { categories: ["Finance"], limit: 5 });
const appId = await call("mobbin_quick_search", { query: "Notion" }, { find: new RegExp(`app_id: \`(${uuid.source})\``) });
if (appId) {
  await call("mobbin_get_app_screens", { app_id: appId, limit: 5 });
  await call("mobbin_get_app_flows", { app_id: appId, limit: 5 });
  await call("mobbin_get_app_flows", { app_id: appId, topic: "onboarding", limit: 5 });
}
// pick an unrestricted screen/flow to view
const openScreen = freeScreen.split("\n\n").length && (freeScreen.match(/\*\*[^*]+\*\* \([a-z]+\)(?! 🔒)[^\n]*\n[^\n]*\n\s*screen_id: `([0-9a-f-]{36})`/) || [])[1];
if (openScreen) await call("mobbin_get_screen_detail", { screen_id: openScreen, width: 540 });
const flows = await call("mobbin_search_flows", { flow_actions: ["Onboarding"], limit: 50 });
const openFlow = (flows.match(/\*\*[^*]+\*\*(?! 🔒)\n[^\n]*\n\s*flow_id: `([0-9a-f-]{36})`/) || [])[1];
if (openFlow) await call("mobbin_get_flow", { flow_id: openFlow, include_images: true, max_images: 2 });
await call("mobbin_popular_apps", { limit_per_category: 2 });
await call("mobbin_list_collections", {});

for (const r of results)
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(26)} ${String(r.ms).padStart(5)}ms${r.images ? `  ${r.images} img ${r.kb}KB` : ""}\n      ${r.preview}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} calls passed.`);
await client.close();
process.exit(failed ? 1 : 0);
