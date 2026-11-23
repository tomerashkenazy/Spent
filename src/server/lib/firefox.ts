import "server-only";

import fs from "fs";
import os from "os";
import path from "path";

function firefoxCandidates(): string[] {
  const fromEnv = process.env.SPENT_FIREFOX_PATH;
  const home = os.homedir();
  const byPlatform: Record<string, string[]> = {
    darwin: [
      "/Applications/Firefox.app/Contents/MacOS/firefox",
      path.join(home, "Applications/Firefox.app/Contents/MacOS/firefox"),
    ],
    linux: ["/usr/bin/firefox", "/usr/local/bin/firefox", "/usr/lib/firefox/firefox"],
    win32: [
      "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
    ],
  };
  return [...(fromEnv ? [fromEnv] : []), ...(byPlatform[process.platform] ?? [])];
}

export function findFirefox(): string | null {
  for (const candidate of firefoxCandidates()) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here; try the next location.
    }
  }
  return null;
}
