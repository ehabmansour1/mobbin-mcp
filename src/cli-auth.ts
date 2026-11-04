import { execSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { AUTH_FILE, SessionManager, parseSessionInput, saveSession, type Session } from "./auth.js";

const HELP = `Log in to Mobbin

  1. Open https://mobbin.com and log in.
  2. Copy your cookies in ONE of these ways:
     - Browser console (F12 → Console):  copy(document.cookie)
     - Or a cookie-export extension (JSON format) on mobbin.com
  3. Then either paste below, or run one of:
       mobbin-mcp auth --clipboard        (reads the clipboard)
       mobbin-mcp auth <file>             (reads a saved cookie/JSON file)
`;

export async function runAuthCli(args: string[]): Promise<void> {
  let raw: string;
  if (args[0] === "--clipboard") raw = readClipboard();
  else if (args[0] && args[0] !== "-") raw = fs.readFileSync(args[0], "utf8");
  else raw = await readPasted();

  let session: Session;
  try {
    session = parseSessionInput(raw);
  } catch (e) {
    console.error(`\n✗ ${(e as Error).message}`);
    process.exit(1);
  }

  // Verify by refreshing: proves the refresh token works and gives us a fresh access token.
  const mgr = new SessionManager(session, false);
  try {
    await mgr.refresh();
  } catch (e) {
    console.error(`\n✗ Could not verify the session: ${(e as Error).message}`);
    process.exit(1);
  }
  const fresh = mgr.current;
  saveSession(fresh);
  console.log(`\n✓ Logged in${fresh.user?.email ? ` as ${fresh.user.email}` : ""}. Session saved to ${AUTH_FILE}`);
}

function readClipboard(): string {
  const cmd =
    process.platform === "win32"
      ? 'powershell -NoProfile -Command "Get-Clipboard -Raw"'
      : process.platform === "darwin"
        ? "pbpaste"
        : "xclip -selection clipboard -o";
  return execSync(cmd, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

/** Read pasted input line by line until it parses (handles one-line cookie strings and multi-line JSON). */
function readPasted(): Promise<string> {
  if (process.stdin.isTTY) process.stderr.write(HELP + "\nPaste here, then press Enter:\n");
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    let buf = "";
    const done = () => {
      rl.close();
      resolve(buf);
    };
    rl.on("line", (line) => {
      buf += line + "\n";
      try {
        parseSessionInput(buf);
        done();
      } catch {
        /* keep reading until complete */
      }
    });
    rl.on("close", () => resolve(buf));
  });
}
