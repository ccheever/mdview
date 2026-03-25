import Electrobun, {
	BrowserWindow,
	BrowserView,
	ApplicationMenu,
	Utils,
	type RPCSchema,
} from "electrobun/bun";
import {
	readFileSync,
	existsSync,
	watchFile,
	unwatchFile,
	writeFileSync,
	unlinkSync,
	renameSync,
} from "fs";
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
			updateFileList: {
				files: Array<{ path: string; filename: string; isCurrent: boolean }>;
			};
			setFont: { fontFamily: string };
			setFontSize: { size: number };
			setAppearance: { mode: string };
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			selectFile: { path: string };
			closeFile: { path: string };
			ready: {};
		};
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
		messages: {
			selectFile: ({ path }) => {
				showFile(path);
			},
			closeFile: ({ path }) => {
				removeFile(path);
			},
			ready: () => {
				console.log("webview ready");
				webviewReady = true;
				const toOpen = pendingFiles.splice(0);
				for (const file of toOpen) {
					openFile(file);
				}
			},
		},
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

// Multi-file state
const openFiles: Map<string, { filename: string }> = new Map();
let currentFilePath: string | null = null;
const watchedFiles: Set<string> = new Set();

// Webview readiness tracking — queue file opens until the webview can receive RPC
let webviewReady = false;
const pendingFiles: string[] = [];

function sendFileList() {
	const files = Array.from(openFiles.entries()).map(([path, { filename }]) => ({
		path,
		filename,
		isCurrent: path === currentFilePath,
	}));
	mainWindow.webview.rpc.send("updateFileList", { files });
}

function showFile(filePath: string) {
	const absPath = resolve(filePath);
	if (!openFiles.has(absPath)) return;

	currentFilePath = absPath;
	const filename = openFiles.get(absPath)!.filename;

	try {
		const content = readFileSync(absPath, "utf-8");
		mainWindow.setTitle(`${filename} — mdview`);
		mainWindow.webview.rpc.send("renderMarkdown", { content, filePath: absPath, filename });
		sendFileList();
	} catch {
		console.error(`Error reading file: ${absPath}`);
	}
}

function removeFile(filePath: string) {
	const absPath = resolve(filePath);
	if (!openFiles.has(absPath)) return;

	openFiles.delete(absPath);
	if (watchedFiles.has(absPath)) {
		unwatchFile(absPath);
		watchedFiles.delete(absPath);
	}

	if (openFiles.size === 0) {
		currentFilePath = null;
		mainWindow.setTitle("mdview");
		// Send empty list — webview will show welcome screen
		sendFileList();
		return;
	}

	// If we closed the current file, switch to the last one in the list
	if (currentFilePath === absPath) {
		const remaining = Array.from(openFiles.keys());
		showFile(remaining[remaining.length - 1]);
	} else {
		sendFileList();
	}
}

function openFile(filePath: string) {
	const absPath = resolve(filePath);

	if (!existsSync(absPath)) {
		console.error(`File not found: ${absPath}`);
		return;
	}

	// Queue if the webview hasn't signalled it's ready for RPC messages
	if (!webviewReady) {
		console.log(`Queuing file (webview not ready): ${absPath}`);
		if (!pendingFiles.includes(absPath)) {
			pendingFiles.push(absPath);
		}
		return;
	}

	const filename = basename(absPath);

	// Add to open files (or just switch to it if already open)
	openFiles.set(absPath, { filename });
	currentFilePath = absPath;

	try {
		const content = readFileSync(absPath, "utf-8");

		mainWindow.setTitle(`${filename} — mdview`);
		mainWindow.webview.rpc.send("renderMarkdown", { content, filePath: absPath, filename });
		sendFileList();

		// Set up file watcher if not already watching
		if (!watchedFiles.has(absPath)) {
			watchedFiles.add(absPath);
			watchFile(absPath, { interval: 500 }, () => {
				try {
					const updated = readFileSync(absPath, "utf-8");
					// Only push update to webview if this is the currently displayed file
					if (currentFilePath === absPath) {
						mainWindow.webview.rpc.send("renderMarkdown", {
							content: updated,
							filePath: absPath,
							filename,
						});
					}
				} catch {
					// File may have been deleted
				}
			});
		}
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
				{ label: "Set as Default for .md Files\u2026", action: "set-default-handler" },
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
			allowsMultipleSelection: true,
		});
		if (result && result.length > 0) {
			for (const file of result) {
				openFile(file);
			}
		}
	} else if (action === "reload" && currentFilePath) {
		openFile(currentFilePath);
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
	} else if (action === "set-default-handler") {
		setAsDefaultHandler();
	}
});

// Set as default handler for .md files
async function setAsDefaultHandler() {
	// Use osascript to call the ObjC bridge for LSSetDefaultRoleHandlerForContentType
	const script = `
		ObjC.import('CoreServices');
		var result = $.LSSetDefaultRoleHandlerForContentType(
			$('net.daringfireball.markdown'),
			$.kLSRolesViewer,
			$('com.ccheever.mdview')
		);
		result;
	`;
	try {
		const proc = Bun.spawn(["osascript", "-l", "JavaScript", "-e", script]);
		await proc.exited;

		if (proc.exitCode === 0) {
			await Utils.showMessageBox({
				type: "info",
				title: "Default Handler Set",
				message: "mdview is now the default viewer for .md files.",
				detail: "Double-clicking a .md file in Finder will now open it in mdview.",
				buttons: ["OK"],
			});
		} else {
			// Fallback: guide the user through manual steps
			await Utils.showMessageBox({
				type: "info",
				title: "Set Default Manually",
				message: "To set mdview as the default for .md files:",
				detail: "1. Right-click any .md file in Finder\n2. Choose \"Get Info\"\n3. Under \"Open with:\", select mdview\n4. Click \"Change All\u2026\"",
				buttons: ["OK"],
			});
		}
	} catch {
		await Utils.showMessageBox({
			type: "info",
			title: "Set Default Manually",
			message: "To set mdview as the default for .md files:",
			detail: "1. Right-click any .md file in Finder\n2. Choose \"Get Info\"\n3. Under \"Open with:\", select mdview\n4. Click \"Change All\u2026\"",
			buttons: ["OK"],
		});
	}
}

// Install CLI tool
const CLI_SCRIPT = [
	'#!/bin/bash',
	'# mdview - Open markdown files in mdview',
	'VERSION="0.1.0"',
	'',
	'show_help() {',
	'    echo "mdview - A lightweight markdown viewer"',
	'    echo ""',
	'    echo "Usage: mdview [options] [file ...]"',
	'    echo ""',
	'    echo "Options:"',
	'    echo "  -h, --help     Show this help message"',
	'    echo "  -v, --version  Show version number"',
	'    echo ""',
	'    echo "Examples:"',
	'    echo "  mdview README.md"',
	'    echo "  mdview ~/notes/*.md"',
	'    echo "  mdview                  # Open mdview without a file"',
	'}',
	'',
	'files=()',
	'for arg in "$@"; do',
	'    case "$arg" in',
	'        -h|--help)',
	'            show_help',
	'            exit 0',
	'            ;;',
	'        -v|--version)',
	'            echo "mdview $VERSION"',
	'            exit 0',
	'            ;;',
	'        -*)',
	'            echo "mdview: unknown option \'$arg\'" >&2',
	'            echo "Try \'mdview --help\' for more information." >&2',
	'            exit 1',
	'            ;;',
	'        *)',
	'            # Resolve to absolute path',
	'            case "$arg" in',
	'                /*) abs="$arg" ;;',
	'                *) abs="$(cd "$(dirname "$arg")" 2>/dev/null && pwd)/$(basename "$arg")" ;;',
	'            esac',
	'            if [ ! -f "$abs" ]; then',
	'                echo "mdview: $arg: No such file" >&2',
	'                exit 1',
	'            fi',
	'            files+=("$abs")',
	'            ;;',
	'    esac',
	'done',
	'',
	'REQUEST_FILE="/tmp/mdview-open-request"',
	'',
	'if [ ${#files[@]} -eq 0 ]; then',
	'    open -b com.ccheever.mdview',
	'else',
	'    # Write paths to a request file that the app polls (more reliable',
	'    # than passing args through Apple Events which can be dropped)',
	'    for f in "${files[@]}"; do',
	'        echo "$f" >> "$REQUEST_FILE"',
	'    done',
	'    open -b com.ccheever.mdview',
	'fi',
	'',
].join("\n");

function ensureDirInPath(dir: string): { added: boolean; profile?: string } {
	const pathEnv = process.env.PATH || "";
	if (pathEnv.split(":").some(p => p === dir)) {
		return { added: false };
	}

	const home = process.env.HOME || "";
	const shellProfiles = [
		join(home, ".zshrc"),
		join(home, ".zshenv"),
		join(home, ".bash_profile"),
		join(home, ".bashrc"),
	];

	for (const profile of shellProfiles) {
		if (existsSync(profile)) {
			try {
				const content = readFileSync(profile, "utf-8");
				if (!content.includes(dir)) {
					writeFileSync(profile, content + `\nexport PATH="${dir}:$PATH"\n`);
					return { added: true, profile: basename(profile) };
				}
				// Already in the profile file even if not in current process PATH
				return { added: false };
			} catch {
				continue;
			}
		}
	}

	return { added: false };
}

function buildSuccessDetail(targetPath: string, dir: string): string {
	let detail = `Installed to: ${targetPath}\n\nUsage:\n  mdview README.md\n  mdview ~/notes/todo.md`;

	const pathResult = ensureDirInPath(dir);
	if (pathResult.added) {
		detail += `\n\n${dir} was not in your PATH, so it was added to ${pathResult.profile}. Open a new terminal for this to take effect.`;
	} else {
		const pathEnv = process.env.PATH || "";
		if (!pathEnv.split(":").some(p => p === dir)) {
			detail += `\n\nNote: ${dir} is not in your PATH. Add it to your shell profile:\n  export PATH="${dir}:$PATH"`;
		}
	}

	return detail;
}

async function installToLocalBin(): Promise<boolean> {
	const home = process.env.HOME || "";
	const dir = join(home, ".local", "bin");
	const targetPath = join(dir, "mdview");

	try {
		const { mkdirSync } = await import("fs");
		mkdirSync(dir, { recursive: true });
		writeFileSync(targetPath, CLI_SCRIPT, { mode: 0o755 });
	} catch {
		await Utils.showMessageBox({
			type: "error",
			title: "Installation Failed",
			message: "Could not write to ~/.local/bin/mdview.",
			buttons: ["OK"],
		});
		return false;
	}

	if (!existsSync(targetPath)) {
		await Utils.showMessageBox({
			type: "error",
			title: "Installation Failed",
			message: "The command line tool could not be installed.",
			buttons: ["OK"],
		});
		return false;
	}

	await Utils.showMessageBox({
		type: "info",
		title: "Command Line Tool Installed",
		message: "The \"mdview\" command has been installed successfully.",
		detail: buildSuccessDetail(targetPath, dir),
		buttons: ["OK"],
	});
	return true;
}

async function installCLI() {
	const globalPath = "/usr/local/bin/mdview";
	const home = process.env.HOME || "";
	const localPath = join(home, ".local", "bin", "mdview");

	// Check if already installed in either location
	const existingPath = existsSync(globalPath) ? globalPath : existsSync(localPath) ? localPath : null;
	if (existingPath) {
		const { response } = await Utils.showMessageBox({
			type: "question",
			title: "Command Line Tool Already Installed",
			message: `"mdview" is already installed at ${existingPath}`,
			detail: "Would you like to reinstall it?",
			buttons: ["Reinstall", "Cancel"],
			defaultId: 1,
			cancelId: 1,
		});
		if (response !== 0) return;
	}

	// Try /usr/local/bin first (with admin prompt)
	const tmpPath = join(tmpdir(), "mdview-cli-install");

	try {
		writeFileSync(tmpPath, CLI_SCRIPT, { mode: 0o755 });

		const proc = Bun.spawn([
			"osascript", "-e",
			`do shell script "mkdir -p /usr/local/bin && cp ${tmpPath} ${globalPath} && chmod +x ${globalPath}" with administrator privileges`,
		]);
		await proc.exited;
		try { unlinkSync(tmpPath); } catch {}

		if (proc.exitCode === 0 && existsSync(globalPath)) {
			await Utils.showMessageBox({
				type: "info",
				title: "Command Line Tool Installed",
				message: "The \"mdview\" command has been installed successfully.",
				detail: buildSuccessDetail(globalPath, "/usr/local/bin"),
				buttons: ["OK"],
			});
			return;
		}
	} catch {
		try { unlinkSync(tmpPath); } catch {}
	}

	// Admin prompt was cancelled or failed — offer ~/.local/bin as fallback
	const { response } = await Utils.showMessageBox({
		type: "question",
		title: "Install Without Admin Access?",
		message: "Would you like to install to ~/.local/bin instead?",
		detail: "This doesn't require administrator access. Your shell PATH will be updated if needed.",
		buttons: ["Install to ~/.local/bin", "Cancel"],
		defaultId: 0,
		cancelId: 1,
	});

	if (response === 0) {
		await installToLocalBin();
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

// --- CLI request file ---
// The CLI writes file paths here instead of passing them through Apple Events.
// This is more reliable than the open(1) → kAEOpenDocuments → NSApplication
// path, which can silently drop events.
// Use /tmp (not tmpdir()) so the path matches the CLI's ${TMPDIR:-/tmp} regardless
// of how the app was launched. macOS Launch Services may set a different $TMPDIR
// than the user's shell.
const cliRequestPath = "/tmp/mdview-open-request";

function drainCliRequestFile() {
	if (!existsSync(cliRequestPath)) return;

	const processingPath = `${cliRequestPath}.${Date.now()}.processing`;
	try {
		renameSync(cliRequestPath, processingPath);
	} catch {
		return; // Another poll already grabbed it
	}

	try {
		const content = readFileSync(processingPath, "utf-8");
		for (const line of content.split("\n")) {
			const filePath = line.trim();
			if (!filePath) continue;
			console.log("cli request:", filePath);
			const ext = extname(filePath).toLowerCase();
			if (MD_EXTENSIONS.has(ext)) {
				openFile(filePath);
			}
		}
	} catch {
		// Ignore read errors
	} finally {
		try { unlinkSync(processingPath); } catch {}
	}
}

setInterval(drainCliRequestFile, 200);
drainCliRequestFile();

// --- Native open-file signal file (fallback for Finder / dock / Apple Events) ---
// Electrobun's macOS Apple Event bridge can enqueue paths into a per-process
// temp file before Bun is ready to handle them. Polling and atomically renaming
// the file avoids the cold-start race without relying on mdview-specific IPC.
const nativeOpenSignalPath = join(tmpdir(), `electrobun-open-file-${process.pid}`);

function drainNativeOpenSignal() {
	if (process.platform !== "darwin" || !existsSync(nativeOpenSignalPath)) {
		return;
	}

	const processingPath = `${nativeOpenSignalPath}.${Date.now()}.processing`;

	try {
		renameSync(nativeOpenSignalPath, processingPath);
	} catch {
		return;
	}

	try {
		const content = readFileSync(processingPath, "utf-8");
		if (!content) {
			return;
		}

		for (const line of content.split("\n")) {
			const filePath = line.endsWith("\r") ? line.slice(0, -1) : line;
			if (!filePath) continue;
			console.log("open-file signal:", filePath);
			const ext = extname(filePath).toLowerCase();
			if (MD_EXTENSIONS.has(ext)) {
				openFile(filePath);
			}
		}
	} catch {
		// Ignore malformed or disappearing signal files.
	} finally {
		try {
			unlinkSync(processingPath);
		} catch {}
	}
}

if (process.platform === "darwin") {
	setInterval(drainNativeOpenSignal, 250);
	drainNativeOpenSignal();
	process.on("exit", () => {
		try { unlinkSync(nativeOpenSignalPath); } catch {}
	});
}

console.log("mdview started");
