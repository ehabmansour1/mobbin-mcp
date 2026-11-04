# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-11-04

A fresh implementation of an unofficial Mobbin MCP server, rebuilt against Mobbin's current internal
API (verified 2026-11-04). Inspired by the archived
[`pdcolandrea/mobbin-mcp`](https://github.com/pdcolandrea/mobbin-mcp), whose endpoints now mostly return 404.

### Added

- Eleven MCP tools: `mobbin_search_screens`, `mobbin_search_flows`, `mobbin_search_apps`,
  `mobbin_quick_search`, `mobbin_get_app_screens`, `mobbin_get_app_flows`, `mobbin_get_flow`,
  `mobbin_get_screen_detail`, `mobbin_popular_apps`, `mobbin_list_collections`, `mobbin_get_filters`.
- Natural-language (AI) search and taxonomy filters (screen patterns, UI elements, flow actions, categories)
  for iOS, Android and web.
- Screenshots returned as images the model can see (`mobbin_get_screen_detail`, `mobbin_get_flow`).
- `mobbin-mcp auth` login command: `--clipboard`, a file, or interactive paste. Accepts a
  `document.cookie` string or a cookie-export JSON file.
- Session stored in `~/.mobbin-mcp/auth.json` and refreshed automatically; `MOBBIN_AUTH_COOKIE`
  environment variable as an alternative.
- Free-plan aware: restricted results are shown as "Pro-only" metadata; the paywall is not bypassed.
- Request queueing (400 ms gap) and plain-language errors for 404s and Mobbin rate limits.
- `npm run smoke` live end-to-end check of every tool.
- Install straight from GitHub with `npx -y github:ehabmansour1/mobbin-mcp` (built on install via `prepare`).
- GitHub Actions CI: build, CLI version check and `npm pack --dry-run` on Ubuntu (Node 20 and 22) and Windows (Node 22).
- Requires Node.js 20 or newer.

[2.0.0]: https://github.com/ehabmansour1/mobbin-mcp/releases/tag/v2.0.0
