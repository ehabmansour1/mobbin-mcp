# Security

## How your Mobbin session is handled

- `mobbin-mcp auth` reads your Mobbin cookies, keeps only the Supabase session
  (`sb-…-auth-token` cookies), verifies it, and saves the resulting session (access/refresh tokens and the basic user
  record Mobbin's auth server returns) to `~/.mobbin-mcp/auth.json` in your home directory,
  with owner-only file permissions where the OS supports them.
- The session is refreshed automatically. Requests go only to `mobbin.com`, `bytescale.mobbin.com` (screenshots)
  and Mobbin's Supabase auth host (`ujasntkfphywizsdaapi.supabase.co`) for token refresh. There is no telemetry.
- If you use `MOBBIN_AUTH_COOKIE` instead, the session lives only in that environment variable
  and is not written to disk.
- Treat `auth.json` like a password: do not commit it, share it, or paste it into issues.
  To log out, delete the file (and sign out of Mobbin in your browser to revoke the session).
- The `auth` command prints the account email it logged in as. Remove it before you share terminal output.

## Reporting a vulnerability

Please report security problems privately through
[GitHub private vulnerability reporting](https://github.com/ehabmansour1/mobbin-mcp/security/advisories/new),
not in a public issue. Use [GitHub issues](https://github.com/ehabmansour1/mobbin-mcp/issues) only for
non-sensitive bugs. Either way, never include your cookies, tokens, `auth.json` contents, or account email.

This is an unofficial project and is not affiliated with Mobbin. For anything important, prefer
Mobbin's official MCP server at `https://api.mobbin.com/mcp`.
