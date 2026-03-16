import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "mdview",
		identifier: "com.ccheever.mdview",
		version: "0.1.0",
		description: "A lightweight markdown viewer",
	},
	build: {
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
		},
		mac: {
			bundleCEF: false,
			defaultRenderer: "native",
			codesign: false,
		},
		linux: {
			bundleCEF: false,
			defaultRenderer: "native",
		},
		win: {
			bundleCEF: false,
			defaultRenderer: "native",
		},
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
} satisfies ElectrobunConfig;
