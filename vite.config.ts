import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/** The commit being built, with a + when the working tree has changes; empty where there is no git. */
function gitBuild(): string {
  try {
    const run = (command: string): string => execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return `${run("git rev-parse --short HEAD")}${run("git status --porcelain") === "" ? "" : "+"}`;
  } catch {
    return "";
  }
}

export default defineConfig({
  base: "/",
  // What a report says built it: the version, and the commit it came from.
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(gitBuild()),
  },
  build: {
    target: "es2022",
  },
  // Cross-origin isolation as deployed (public/_headers), so performance.measureUserAgentSpecificMemory works locally.
  server: {
    headers: { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" },
  },
  // `npm run preview` serves the build with the deployed headers, Content-Security-Policy included, so what it blocks shows up locally.
  preview: {
    headers: {
      "Content-Security-Policy":
        "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; manifest-src 'self'; object-src 'none'",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // ES-module workers so dynamic imports (e.g. the parquet reader) are
  // code-split instead of being inlined into the worker chunk.
  worker: {
    format: "es",
  },
});
