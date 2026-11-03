import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "cbxm-me",
    compatibilityDate: "2026-10-06",
    assets: {
      htmlHandling: "drop-trailing-slash",
      notFoundHandling: "404-page",
    },
  },
});
