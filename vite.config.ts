import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    target: "es2022",
  },
  // ES-module workers so dynamic imports (e.g. the parquet reader) are
  // code-split instead of being inlined into the worker chunk.
  worker: {
    format: "es",
  },
});
