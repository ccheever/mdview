import Electrobun, {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  Utils,
} from "electrobun/bun";
import { join, dirname, resolve, basename } from "path";
import { homedir, tmpdir } from "os";
import type { MdviewRPC } from "../rpc";

// ── Settings persistence ──

const configDir = join(homedir(), ".config", "mdview");
const configPath = join(configDir, "settings.json");

async function readSettings(): Promise<{ font: string; size: number }> {
  try {
    const file = Bun.file(configPath);
    const data = await file.json();
    return { font: data.font ?? "system", size: data.size ?? 16 };
  } catch {
    return { font: "system", size: 16 };
  }
}

async function writeSettings(settings: {
  font?: string;
  size?: number;
}): Promise<boolean> {
  const current = await readSettings();
  const merged = { ...current, ...settings };
  const json = JSON.stringify(merged, null, 2);
  try {
    await Bun.write(configPath, json);
    return true;
  } catch {
    const { mkdirSync } = require("fs");
    try {
      mkdirSync(configDir, { recursive: true });
      await Bun.write(configPath, json);
      return true;
    } catch {
      return false;
    }
  }
}

async function getSavedFont(): Promise<string> {
  return (await readSettings()).font;
}

async function saveFont(font: string): Promise<boolean> {
  return writeSettings({ font });
}

async function getSavedSize(): Promise<number> {
  return (await readSettings()).size;
}

async function saveSize(size: number): Promise<boolean> {
  return writeSettings({ size });
}

// ── Font sizes ──

const FONT_SIZES = [12, 14, 16, 18, 20, 22, 24];
const DEFAULT_SIZE = 16;

function clampSize(size: number): number {
  if (size <= FONT_SIZES[0]) return FONT_SIZES[0];
  if (size >= FONT_SIZES[FONT_SIZES.length - 1])
    return FONT_SIZES[FONT_SIZES.length - 1];
  return size;
}

function stepSize(current: number, direction: 1 | -1): number {
  const idx = FONT_SIZES.indexOf(current);
  if (idx === -1) {
    // Current size isn't in the list; snap to nearest
    const nearest = FONT_SIZES.reduce((prev, s) =>
      Math.abs(s - current) < Math.abs(prev - current) ? s : prev
    );
    const nearIdx = FONT_SIZES.indexOf(nearest);
    const next = nearIdx + direction;
    return FONT_SIZES[Math.max(0, Math.min(next, FONT_SIZES.length - 1))];
  }
  const next = idx + direction;
  return FONT_SIZES[Math.max(0, Math.min(next, FONT_SIZES.length - 1))];
}

// ── Read a markdown file ──

async function readMarkdownFile(filePath: string) {
  const absPath = resolve(filePath);
  const file = Bun.file(absPath);
  const content = await file.text();
  return {
    content,
    filePath: absPath,
    dirPath: dirname(absPath),
  };
}

// ── RPC handlers ──

const rpc = BrowserView.defineRPC<MdviewRPC>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      readFile: async ({ path }) => {
        return await readMarkdownFile(path);
      },
      openFileDialog: async () => {
        const files = await Utils.openFileDialog({
          startingFolder: "~/",
          allowedFileTypes: "md,markdown,mdown,mkd,mkdn,mdx,txt",
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: false,
        });
        if (files && files.length > 0 && files[0] !== "") {
          return { filePath: files[0] };
        }
        return { filePath: null };
      },
      getSavedFont: async () => {
        const font = await getSavedFont();
        return { font };
      },
      saveFont: async ({ font }) => {
        const success = await saveFont(font);
        return { success };
      },
      getSavedSize: async () => {
        const size = await getSavedSize();
        return { size };
      },
      saveSize: async ({ size }) => {
        const success = await saveSize(size);
        return { success };
      },
    },
    messages: {},
  },
});

// ── Create window ──

const win = new BrowserWindow({
  title: "mdview",
  url: "views://mainview/index.html",
  frame: {
    width: 900,
    height: 700,
  },
  rpc,
});

// ── Open a file and send to webview ──

let currentFilePath: string | null = null;

async function openFile(filePath: string) {
  try {
    const data = await readMarkdownFile(filePath);
    currentFilePath = data.filePath;
    win.setTitle(`${basename(data.filePath)} — mdview`);
    win.webview.rpc?.send.loadFile({
      content: data.content,
      filePath: data.filePath,
      dirPath: data.dirPath,
    });
  } catch (err) {
    console.error("Failed to open file:", err);
  }
}

// ── Application Menu ──

let currentFont = "system";
let currentSize = DEFAULT_SIZE;

const fontItems = [
  { label: "System Default", action: "font-system" },
  { label: "Inter", action: "font-inter" },
  { label: "Serif", action: "font-serif" },
  { label: "Sans-serif", action: "font-sans" },
  { label: "Monospace", action: "font-mono" },
  { label: "Readable", action: "font-readable" },
];

const sizeLabels: Record<number, string> = {
  12: "Extra Small",
  14: "Small",
  16: "Default",
  18: "Large",
  20: "Extra Large",
  22: "Huge",
  24: "Maximum",
};

function buildMenuConfig() {
  return [
    {
      submenu: [
        { label: "About mdview", role: "about" },
        { type: "separator" },
        { label: "Quit mdview", role: "quit", accelerator: "q" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "Open…",
          action: "file-open",
          accelerator: "CommandOrControl+O",
        },
        { label: "Export to PDF…", action: "file-export-pdf" },
        { type: "separator" },
        {
          label: "Close Window",
          action: "close-window",
          accelerator: "CommandOrControl+W",
        },
      ],
    },
    {
      label: "Edit",
      submenu: [{ role: "copy" }, { role: "selectAll" }],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Enter Full Screen",
          action: "view-fullscreen",
          accelerator: "CommandOrControl+Shift+F",
        },
      ],
    },
    {
      label: "Font",
      submenu: fontItems.map((item) => ({
        ...item,
        checked: item.action === `font-${currentFont}`,
      })),
    },
    {
      label: "Size",
      submenu: [
        {
          label: "Increase Size",
          action: "size-increase",
          accelerator: "CommandOrControl+=",
        },
        {
          label: "Decrease Size",
          action: "size-decrease",
          accelerator: "CommandOrControl+-",
        },
        {
          label: "Default Size",
          action: "size-default",
          accelerator: "CommandOrControl+0",
        },
        { type: "separator" },
        ...FONT_SIZES.map((size) => ({
          label: `${sizeLabels[size]} (${size}px)`,
          action: `size-${size}`,
          checked: size === currentSize,
        })),
      ],
    },
  ];
}

function updateMenu() {
  ApplicationMenu.setApplicationMenu(buildMenuConfig() as any);
}

// Defer menu setup to ensure native event loop is running
setTimeout(async () => {
  currentFont = await getSavedFont();
  currentSize = await getSavedSize();
  updateMenu();
}, 500);

// ── Menu event handling ──

Electrobun.events.on("application-menu-clicked", async (e) => {
  const action = e.data.action;

  if (action === "file-open") {
    const files = await Utils.openFileDialog({
      startingFolder: "~/",
      allowedFileTypes: "md,markdown,mdown,mkd,mkdn,mdx,txt",
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: false,
    });
    if (files && files.length > 0 && files[0] !== "") {
      await openFile(files[0]);
    }
  } else if (action === "close-window") {
    win.close();
  } else if (action === "view-fullscreen") {
    const isFullScreen = win.isFullScreen();
    win.setFullScreen(!isFullScreen);
  } else if (action === "file-export-pdf") {
    // Determine default filename and directory from current file
    const defaultName = currentFilePath
      ? basename(currentFilePath).replace(/\.[^.]+$/, "") + ".pdf"
      : "document.pdf";
    const defaultDir = currentFilePath ? dirname(currentFilePath) : null;

    // Use osascript to show a native save dialog
    try {
      const script = defaultDir
        ? `set theFile to choose file name with prompt "Export as PDF" default name "${defaultName}" default location (POSIX file "${defaultDir}" as alias)`
        : `set theFile to choose file name with prompt "Export as PDF" default name "${defaultName}"`;
      console.log("PDF export osascript:", script);
      const proc = Bun.spawnSync([
        "osascript",
        "-e",
        script,
        "-e",
        `POSIX path of theFile`,
      ]);
      const savePath = proc.stdout.toString().trim();
      const errOut = proc.stderr.toString().trim();
      if (errOut) console.error("osascript stderr:", errOut);
      if (savePath) {
        // Ensure .pdf extension
        const pdfPath = savePath.endsWith(".pdf") ? savePath : savePath + ".pdf";

        // Request PDF data from the webview
        const result = await win.webview.rpc?.request.exportPDF({});
        if (result?.pdfBase64) {
          // Decode base64 and write to disk
          const buffer = Buffer.from(result.pdfBase64, "base64");
          await Bun.write(pdfPath, buffer);
          // Open the PDF in the default viewer
          Utils.openPath(pdfPath);
        }
      }
    } catch (err) {
      // User cancelled the save dialog or an error occurred
      console.error("PDF export failed:", err);
    }
  } else if (action?.startsWith("font-")) {
    const font = action.replace("font-", "");
    currentFont = font;
    win.webview.rpc?.send.setFont({ font });
    await saveFont(font);
    updateMenu();
  } else if (action === "size-increase") {
    currentSize = stepSize(currentSize, 1);
    win.webview.rpc?.send.setSize({ size: currentSize });
    await saveSize(currentSize);
    updateMenu();
  } else if (action === "size-decrease") {
    currentSize = stepSize(currentSize, -1);
    win.webview.rpc?.send.setSize({ size: currentSize });
    await saveSize(currentSize);
    updateMenu();
  } else if (action === "size-default") {
    currentSize = DEFAULT_SIZE;
    win.webview.rpc?.send.setSize({ size: currentSize });
    await saveSize(currentSize);
    updateMenu();
  } else if (action?.startsWith("size-")) {
    const size = parseInt(action.replace("size-", ""), 10);
    if (!isNaN(size) && FONT_SIZES.includes(size)) {
      currentSize = size;
      win.webview.rpc?.send.setSize({ size: currentSize });
      await saveSize(currentSize);
      updateMenu();
    }
  }
});

// ── CLI argument: open file passed on command line ──

const args = Bun.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("-"));
if (fileArg) {
  // Wait briefly for webview to be ready before sending
  setTimeout(() => openFile(fileArg), 300);
}
