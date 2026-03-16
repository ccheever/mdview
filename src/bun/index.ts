import Electrobun, {
	BrowserWindow,
	BrowserView,
	ApplicationMenu,
	Utils,
	type RPCSchema,
} from "electrobun/bun";
import { readFileSync, existsSync, watchFile, unwatchFile, writeFileSync, unlinkSync } from "fs";
import { resolve, basename, extname, join, dirname } from "path";
import { tmpdir } from "os";
import { dlopen, suffix, FFIType } from "bun:ffi";

const MD_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdx"]);

// Load native wrapper for print support
const libPath = join(dirname(process.argv0), `libNativeWrapper.${suffix}`);
let nativeLib: any = null;
try {
	nativeLib = dlopen(libPath, {
		webviewPrint: { args: [FFIType.ptr], returns: FFIType.void },
	});
} catch {
	console.log("Could not load native wrapper for print support");
}

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
			setAppearance: { mode: string };
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

		// Watch for changes and auto-reload
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

function printWebView() {
	if (nativeLib) {
		// Use native NSPrintOperation for proper print/PDF export
		const webviewPtr = (mainWindow.webview as any).ptr;
		if (webviewPtr) {
			nativeLib.symbols.webviewPrint(webviewPtr);
			return;
		}
	}
	console.log("Print not available");
}

// State
const FONTS: Record<string, string> = {
	"font-system": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
	"font-serif": "Georgia, 'Times New Roman', serif",
	"font-sans": "'Helvetica Neue', Helvetica, Arial, sans-serif",
	"font-mono": "'SF Mono', Menlo, Monaco, monospace",
	"font-readable": "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
	"font-inter": "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
};

const FONT_LABELS: Record<string, string> = {
	"font-system": "System Default",
	"font-serif": "Serif",
	"font-sans": "Sans-serif",
	"font-mono": "Monospace",
	"font-readable": "Readable",
	"font-inter": "Inter",
};

let currentFont = "font-system";
let currentFontSize = 16;
let currentAppearance = "auto"; // "auto", "light", "dark"

function rebuildMenu() {
	ApplicationMenu.setApplicationMenu([
		{
			label: "mdview",
			submenu: [
				{ label: "About mdview", role: "about" },
				{ type: "divider" },
				{ label: "Install Command Line Tool…", action: "install-cli" },
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
				{ label: "Automatic", action: "appearance-auto", checked: currentAppearance === "auto" },
				{ label: "Light", action: "appearance-light", checked: currentAppearance === "light" },
				{ label: "Dark", action: "appearance-dark", checked: currentAppearance === "dark" },
			],
		},
		{
			label: "Font",
			submenu: Object.entries(FONT_LABELS).map(([key, label]) => ({
				label,
				action: key,
				checked: currentFont === key,
			})),
		},
	]);
}

// Set up application menu (delay slightly to ensure native app is ready)
setTimeout(rebuildMenu, 100);

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
	} else if (action === "print" || action === "export-pdf") {
		printWebView();
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
			currentFont = action;
			mainWindow.webview.rpc.send("setFont", { fontFamily });
			rebuildMenu();
		}
	} else if (action && action.startsWith("appearance-")) {
		currentAppearance = action.replace("appearance-", "");
		mainWindow.webview.rpc.send("setAppearance", { mode: currentAppearance });
		rebuildMenu();
	} else if (action === "install-cli") {
		installCLI();
	}
});

// Install CLI tool
async function installCLI() {
	const cliScript = [
		"#!/bin/bash",
		"# mdview - Open markdown files in mdview",
		'if [ $# -eq 0 ]; then',
		'    open -b com.ccheever.mdview',
		'else',
		'    for f in "$@"; do',
		'        open -b com.ccheever.mdview "$f"',
		'    done',
		'fi',
		'',
	].join("\n");

	const tmpPath = join(tmpdir(), "mdview-cli-install");
	const targetPath = "/usr/local/bin/mdview";

	try {
		writeFileSync(tmpPath, cliScript, { mode: 0o755 });
		const proc = Bun.spawn([
			"osascript", "-e",
			`do shell script "cp ${tmpPath} ${targetPath} && chmod +x ${targetPath}" with administrator privileges`,
		]);
		await proc.exited;
		try { unlinkSync(tmpPath); } catch {}
		if (proc.exitCode === 0) {
			console.log("CLI tool installed at /usr/local/bin/mdview");
		}
	} catch {
		console.error("Failed to install CLI tool");
	}
}

// Handle files opened from Finder / file associations
Electrobun.events.on("open-file", (event) => {
	const filePath = event.data.path;
	console.log("open-file event:", filePath);

	const ext = extname(filePath).toLowerCase();
	if (!MD_EXTENSIONS.has(ext)) {
		console.log(`Ignoring non-markdown file: ${filePath}`);
		return;
	}

	openFile(filePath);
});

// Watch for file-open signals from the native Apple Event handler.
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
