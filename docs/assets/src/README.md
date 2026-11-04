# Image sources

The PNGs in `docs/assets/` are rendered from the HTML files in this folder. Each HTML page is self-contained
(inline CSS, system fonts, no network requests), so you can open one in a browser to preview it.

| Source | Output | Size |
| --- | --- | --- |
| `social-preview.html` | `social-preview.png` | 1280×640 (GitHub social preview / Open Graph image) |
| `demo-search-screens.html` | `demo-search-screens.png` | 1360 wide, height fits content |
| `demo-app-flows.html` | `demo-app-flows.png` | 1360 wide, height fits content |
| `demo-flow-detail.html` | `demo-flow-detail.png` | 1360 wide, height fits content |
| `demo-auth.html` | `demo-auth.png` | 1360 wide, height fits content |
| `demo-smoke-test.html` | `demo-smoke-test.png` | 1360 wide, height fits content |

## Re-render

Needs Node 20+ and Google Chrome. Nothing to install.

```bash
node docs/assets/src/render.mjs                       # all images
node docs/assets/src/render.mjs demo-auth             # just one (name without .html)
CHROME_PATH=/path/to/chrome node docs/assets/src/render.mjs   # Chrome somewhere else
```

The script:

1. runs headless Chrome with a throwaway profile in the system temp folder (deleted afterwards),
2. measures each page's height (`--dump-dom`; the page writes its height to `body[data-h]`),
3. screenshots it at 2× device scale, so text stays sharp when GitHub scales the image down,
4. shrinks the PNG to a 256-colour palette (dependency-free, built into the script). `social-preview` skips
   this step because its background gradients would band.

## Content

The tool output in the demo images is real output from this server (captured 2026-11-04 on a free Mobbin
plan), trimmed for width: long IDs are cut with `…` and long lists are collapsed the way Claude Code collapses
them. The assistant replies around the tool calls are example wording.

Two images are not literal captures:

- `demo-auth`: the real `auth` command prints `Logged in as <your email>. Session saved to <absolute path>`. The image
  uses the placeholders `you@example.com` and `/home/you`, and shows the `claude mcp add` / `claude mcp list` output
  for the documented `npx -y github:ehabmansour1/mobbin-mcp` setup.
- `demo-smoke-test`: the PASS/FAIL rows, timings and counts are real, but the previews are condensed summaries. The
  real script prints the first 200 characters of each tool result (whitespace collapsed) on its own line.

Every page has `<meta name="robots" content="noindex">` because GitHub Pages also serves this folder.

When you edit a page, keep it free of account details (emails, cookies, tokens) and don't embed Mobbin-hosted
screenshots: those are other companies' app UIs.
