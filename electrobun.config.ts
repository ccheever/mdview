import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "mdview",
    identifier: "com.mdview.viewer",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      "main-ui": {
        entrypoint: "src/main-ui/index.ts",
      },
    },
    copy: {
      "src/main-ui/index.html": "views/main-ui/index.html",
      "src/main-ui/styles.css": "views/main-ui/styles.css",
      "src/main-ui/fonts/Inter.var.woff2":
        "views/main-ui/fonts/Inter.var.woff2",
    },
    mac: {
      icons: "icons/icon.icns",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
