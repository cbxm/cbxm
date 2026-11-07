import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "cbxm-me",
    compatibilityDate: "2026-10-06",
    domains: ["cbxm.me", "www.cbxm.me"],
    entrypoint: "./src/worker.ts",
    assets: {
      htmlHandling: "drop-trailing-slash",
      notFoundHandling: "404-page",
      runWorkerFirst: ["/mes", "/mes/*"],
    },
  },
});
