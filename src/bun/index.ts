import Electrobun, {
	BrowserWindow,
	BrowserView,
	ApplicationMenu,
	Utils,
	type RPCSchema,
} from "electrobun/bun";
import { readFileSync, existsSync, watchFile, unwatchFile, writeFileSync, unlinkSync } from "fs";
import { resolve, basename, extname, join } from "path";
import { tmpdir } from "os";

const MD_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdx"]);

// RPC schema for main <-> webview communication
type MdviewRPC = {
	bun: RPCSchema<{
		requests: {
			readFile: {
				params: { path: string };
				response: { content: string; path: string; filename: string } | { error: string };
			};
		};
		messages: {
			renderMarkdown: {
				content: string;
				filePath: string;
				filename: string;
			};
			setFont: { fontFamily: string };
			setFontSize: { size: number };
			print: {};
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {};
	}>;
};

const rpc = BrowserView.defineRPC<MdviewRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {
			readFile: async ({ path: filePath }) => {
				try {
					const absPath = resolve(filePath);
					const content = readFileSync(absPath, "utf-8");
					return {
						content,
						path: absPath,
						filename: basename(absPath),
					};
				} catch {
					return { error: `Could not read file: ${filePath}` };
				}
			},
		},
		messages: {},
	},
});

const mainWindow = new BrowserWindow({
	title: "mdview",
	url: "views://mainview/index.html",
	frame: {
		width: 900,
		height: 700,
		x: 200,
		y: 100,
	},
	rpc,
});

mainWindow.on("close", () => {
	Utils.quit();
});

// Track the currently watched file so we can unwatch on change
let watchedFilePath: string | null = null;

function openFile(filePath: string) {
	const absPath = resolve(filePath);

	if (!existsSync(absPath)) {
		console.error(`File not found: ${absPath}`);
		return;
	}

	try {
		const content = readFileSync(absPath, "utf-8");
		const filename = basename(absPath);

		mainWindow.setTitle(`${filename} — mdview`);
		mainWindow.webview.rpc.send("renderMarkdown", {
			content,
			filePath: absPath,
			filename,
		});

		// Watch for changes
		if (watchedFilePath) {
			unwatchFile(watchedFilePath);
		}
		watchedFilePath = absPath;
		watchFile(absPath, { interval: 500 }, () => {
			try {
				const updated = readFileSync(absPath, "utf-8");
				mainWindow.webview.rpc.send("renderMarkdown", {
					content: updated,
					filePath: absPath,
					filename,
				});
			} catch {
				// File may have been deleted
			}
		});
	} catch (err) {
		console.error(`Error reading file: ${absPath}`, err);
	}
}

// Set up application menu (delay slightly to ensure native app is ready)
setTimeout(() => {
ApplicationMenu.setApplicationMenu([
	{
		label: "mdview",
		submenu: [
			{ label: "About mdview", role: "about" },
			{ type: "divider" },
			{ label: "Quit mdview", role: "quit", accelerator: "CommandOrControl+Q" },
		],
	},
	{
		label: "File",
		submenu: [
			{ label: "Open…", action: "open-file", accelerator: "CommandOrControl+O" },
			{ type: "divider" },
			{ label: "Print…", action: "print", accelerator: "CommandOrControl+P" },
			{ label: "Export as PDF…", action: "export-pdf" },
			{ type: "divider" },
			{ label: "Close Window", role: "close", accelerator: "CommandOrControl+W" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ label: "Copy", role: "copy", accelerator: "CommandOrControl+C" },
			{ label: "Select All", role: "selectAll", accelerator: "CommandOrControl+A" },
		],
	},
	{
		label: "View",
		submenu: [
			{ label: "Reload", action: "reload", accelerator: "CommandOrControl+R" },
			{ type: "divider" },
			{ label: "Bigger", action: "zoom-in", accelerator: "CommandOrControl+=" },
			{ label: "Smaller", action: "zoom-out", accelerator: "CommandOrControl+-" },
			{ label: "Actual Size", action: "zoom-reset", accelerator: "CommandOrControl+0" },
			{ type: "divider" },
			{ label: "System Default", action: "font-system" },
			{ label: "Serif", action: "font-serif" },
			{ label: "Sans-serif", action: "font-sans" },
			{ label: "Monospace", action: "font-mono" },
			{ label: "Readable", action: "font-readable" },
		],
	},
]);
}, 100);

// Font families
const FONTS: Record<string, string> = {
	"font-system": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
	"font-serif": "Georgia, 'Times New Roman', serif",
	"font-sans": "'Helvetica Neue', Helvetica, Arial, sans-serif",
	"font-mono": "'SF Mono', Menlo, Monaco, monospace",
	"font-readable": "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
};

let currentFontSize = 16;

// Handle menu actions
Electrobun.events.on("application-menu-clicked", async (event) => {
	const action = event.data.action;

	if (action === "open-file") {
		const result = await Utils.openFileDialog({
			allowedFileTypes: "md,markdown,mdown,mkd,mkdn,mdx",
			canChooseFiles: true,
			canChooseDirectory: false,
			allowsMultipleSelection: false,
		});
		if (result && result.length > 0) {
			openFile(result[0]);
		}
	} else if (action === "reload" && watchedFilePath) {
		openFile(watchedFilePath);
	} else if (action === "print") {
		mainWindow.webview.rpc.send("print", {});
	} else if (action === "export-pdf") {
		mainWindow.webview.rpc.send("print", {});
	} else if (action === "zoom-in") {
		currentFontSize = Math.min(32, currentFontSize + 2);
		mainWindow.webview.rpc.send("setFontSize", { size: currentFontSize });
	} else if (action === "zoom-out") {
		currentFontSize = Math.max(10, currentFontSize - 2);
		mainWindow.webview.rpc.send("setFontSize", { size: currentFontSize });
	} else if (action === "zoom-reset") {
		currentFontSize = 16;
		mainWindow.webview.rpc.send("setFontSize", { size: currentFontSize });
	} else if (action && action.startsWith("font-")) {
		const fontFamily = FONTS[action];
		if (fontFamily) {
			mainWindow.webview.rpc.send("setFont", { fontFamily });
		}
	}
});

// Handle files opened from Finder / file associations
Electrobun.events.on("open-file", (event) => {
	const filePath = event.data.path;
	console.log("open-file event:", filePath);

	// Only open markdown files — ignore other args (e.g. launcher scripts)
	const ext = extname(filePath).toLowerCase();
	if (!MD_EXTENSIONS.has(ext)) {
		console.log(`Ignoring non-markdown file: ${filePath}`);
		return;
	}

	openFile(filePath);
});

// Watch for file-open signals from the native Apple Event handler.
// The native side writes file paths to a temp file because the JSCallback
// mechanism doesn't work reliably from within the NSApplication event loop.
const signalFilePath = join(tmpdir(), `electrobun-open-file-${process.pid}`);
writeFileSync(signalFilePath, "");
watchFile(signalFilePath, { interval: 300 }, () => {
	try {
		const content = readFileSync(signalFilePath, "utf-8").trim();
		if (!content) return;
		writeFileSync(signalFilePath, "");
		for (const line of content.split("\n")) {
			const filePath = line.trim();
			if (!filePath) continue;
			console.log("open-file signal:", filePath);
			const ext = extname(filePath).toLowerCase();
			if (MD_EXTENSIONS.has(ext)) {
				openFile(filePath);
			}
		}
	} catch {}
});
process.on("exit", () => { try { unlinkSync(signalFilePath); } catch {} });

console.log("mdview started");
