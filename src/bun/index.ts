import {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  Utils,
} from "electrobun/bun";
import Electrobun from "electrobun/bun";
import { existsSync, readFileSync, realpathSync, statSync, symlinkSync, unlinkSync, readlinkSync } from "fs";
import { resolve, dirname, basename, join } from "path";
import type { MdviewRPC } from "../shared/rpc-types";

// --- Constants ---

const FALLBACK_BUNDLE_ID = "com.mdview.viewer";
const MD_UTI = "net.daringfireball.markdown";

// --- Menu state ---

let menuState = {
  fileMenuEnabled: false,
  checkedFont: "font_system",
  mdAssociated: false,
};

// --- Helper: get bundle identifier ---

function currentBundleId(): string {
  try {
    const exe = process.execPath;
    // <App>.app/Contents/MacOS/<binary>
    const infoPlist = join(dirname(exe), "..", "Info.plist");
    if (existsSync(infoPlist)) {
      const result = Bun.spawnSync(["defaults", "read", infoPlist, "CFBundleIdentifier"]);
      const id = result.stdout.toString().trim();
      if (id) return id;
    }
  } catch {}
  return FALLBACK_BUNDLE_ID;
}

// --- Helper: check if mdview is default handler for .md ---

function isMdAssociated(): boolean {
  const bundleId = currentBundleId();
  const script = `import CoreServices; import Foundation; if let h = LSCopyDefaultRoleHandlerForContentType("${MD_UTI}" as NSString as CFString, .all) { print(h.takeRetainedValue()) } else { print("none") }`;
  try {
    const result = Bun.spawnSync(["swift", "-e", script]);
    const stdout = result.stdout.toString().trim().toLowerCase();
    return stdout === bundleId.toLowerCase();
  } catch {
    return false;
  }
}

// --- Helper: set/unset file association ---

function setMdAssociation(enable: boolean): { ok: boolean; error?: string } {
  const selfBundle = currentBundleId();
  const targetBundle = enable ? selfBundle : "com.apple.TextEdit";
  const script = `import CoreServices; import Foundation; let r = LSSetDefaultRoleHandlerForContentType("${MD_UTI}" as NSString as CFString, .all, "${targetBundle}" as NSString as CFString); print(r == 0 ? "ok" : "err")`;

  try {
    const result = Bun.spawnSync(["swift", "-e", script]);
    const stdout = result.stdout.toString().trim();
    if (stdout === "ok") {
      return { ok: true };
    }
    const stderr = result.stderr.toString().trim();
    return {
      ok: false,
      error: `Failed to ${enable ? "set" : "remove"} file association. ${stderr}\n\nTry: ensure you are running the .app bundle and that the app is in /Applications.\nYou can always change this in Finder: right-click a .md file → Get Info → Open With.`,
    };
  } catch (e) {
    return { ok: false, error: `Failed to run swift: ${e}` };
  }
}

// --- Helper: install CLI tool ---

function installCli(): string {
  const exePath = process.execPath;
  const target = "/usr/local/bin/mdview";

  try {
    if (existsSync(target)) {
      const stats = statSync(target, { throwIfNoEntry: false });
      // Check if it's a symlink pointing to our binary
      try {
        const existing = readlinkSync(target);
        if (existing === exePath) {
          return "already-installed";
        }
      } catch {}

      // Remove existing file/symlink
      try {
        unlinkSync(target);
      } catch {}
    }

    // Try direct symlink first
    try {
      symlinkSync(exePath, target);
      return "ok";
    } catch {}

    // Fall back to osascript with admin privileges
    const script = `do shell script "ln -sf '${exePath}' '${target}'" with administrator privileges`;
    const result = Bun.spawnSync(["osascript", "-e", script]);
    if (result.exitCode === 0) {
      return "ok";
    }
    return "cancelled";
  } catch (e) {
    return `Failed: ${e}`;
  }
}

// --- Helper: find project root (.git) ---

function findProjectRoot(filePath: string): string | null {
  let dir = filePath;
  try {
    const stat = statSync(dir);
    if (stat.isFile()) {
      dir = dirname(dir);
    }
  } catch {
    dir = dirname(dir);
  }

  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// --- Helper: read file ---

function readFile(path: string): { content: string; path: string; dir: string } {
  const resolved = resolve(path);
  let canonical: string;
  try {
    canonical = realpathSync(resolved);
  } catch (e) {
    throw new Error(`Cannot resolve path '${path}': ${e}`);
  }

  let content: string;
  try {
    content = readFileSync(canonical, "utf-8");
  } catch (e) {
    throw new Error(`Cannot read file '${canonical}': ${e}`);
  }

  const dir = dirname(canonical);
  return { content, path: canonical, dir };
}

// --- Build menu ---

function buildMenu() {
  const { fileMenuEnabled, checkedFont, mdAssociated } = menuState;

  ApplicationMenu.setApplicationMenu([
    // App menu (first, unnamed submenu)
    {
      submenu: [
        { label: "About mdview", role: "hide" },
        { type: "separator" },
        { label: "Hide mdview", role: "hide" },
        { label: "Hide Others", role: "hideOthers" },
        { label: "Show All", role: "showAll" },
        { type: "separator" },
        { label: "Quit mdview", role: "quit" },
      ],
    },
    // File menu
    {
      label: "File",
      submenu: [
        { label: "Open…", action: "open_file", accelerator: "o" },
        { type: "separator" },
        {
          label: "Copy File Path",
          action: "copy_file_path",
          accelerator: "shift+c",
          enabled: fileMenuEnabled,
        },
        {
          label: "Copy Containing Folder Path",
          action: "copy_dir_path",
          enabled: fileMenuEnabled,
        },
        {
          label: "Copy Project Path",
          action: "copy_project_path",
          enabled: fileMenuEnabled,
        },
        { type: "separator" },
        {
          label: "Reveal in Finder",
          action: "reveal_finder",
          accelerator: "shift+r",
          enabled: fileMenuEnabled,
        },
        { type: "separator" },
        {
          label: "Export as PDF…",
          action: "export_pdf",
          accelerator: "p",
          enabled: fileMenuEnabled,
        },
      ],
    },
    // Edit menu
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    // View menu
    {
      label: "View",
      submenu: [
        {
          label: "Font",
          submenu: [
            {
              label: "System Default",
              action: "font_system",
              checked: checkedFont === "font_system",
            },
            {
              label: "Inter",
              action: "font_inter",
              checked: checkedFont === "font_inter",
            },
            { type: "separator" },
            {
              label: "Serif",
              action: "font_serif",
              checked: checkedFont === "font_serif",
            },
            {
              label: "Sans-serif",
              action: "font_sans",
              checked: checkedFont === "font_sans",
            },
            {
              label: "Monospace",
              action: "font_mono",
              checked: checkedFont === "font_mono",
            },
            {
              label: "Readable",
              action: "font_readable",
              checked: checkedFont === "font_readable",
            },
          ],
        },
      ],
    },
    // Tools menu
    {
      label: "Tools",
      submenu: [
        {
          label: "Install Command Line Tool…",
          action: "install_cli",
        },
        {
          label: "Associate .md Files with mdview",
          action: "associate_md",
          checked: mdAssociated,
        },
      ],
    },
  ]);
}

// --- RPC setup ---

const rpc = BrowserView.defineRPC<MdviewRPC>({
  maxRequestTime: 10000,
  handlers: {
    requests: {
      readFile: ({ path }) => {
        return readFile(path);
      },
      getInitialFile: () => {
        // Check CLI args for a file path
        const args = process.argv;
        for (const arg of args) {
          if (!arg.startsWith("-") && (arg.endsWith(".md") || arg.endsWith(".markdown") || arg.endsWith(".mdown") || arg.endsWith(".mkd") || arg.endsWith(".mkdn") || arg.endsWith(".mdx") || arg.endsWith(".txt"))) {
            return arg;
          }
        }
        // Also check for any non-flag arg that might be a file
        for (let i = 1; i < args.length; i++) {
          const arg = args[i];
          if (!arg.startsWith("-")) {
            try {
              if (existsSync(arg)) return arg;
            } catch {}
          }
        }
        return null;
      },
      findProjectRoot: ({ filePath }) => {
        return findProjectRoot(filePath);
      },
      revealInFinder: ({ filePath }) => {
        Utils.showItemInFolder(filePath);
      },
      copyToClipboard: ({ text }) => {
        Utils.clipboardWriteText(text);
      },
      showOpenDialog: async () => {
        const paths = await Utils.openFileDialog({
          allowedFileTypes: "md,markdown,mdown,mkd,mkdn,mdx,txt",
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: false,
        });
        if (paths && paths.length > 0) {
          return paths[0];
        }
        return null;
      },
      openExternal: ({ url }) => {
        Utils.openExternal(url);
      },
      isMdAssociated: () => {
        return isMdAssociated();
      },
      setMdAssociation: ({ enable }) => {
        const result = setMdAssociation(enable);
        if (result.ok) {
          menuState.mdAssociated = enable;
          buildMenu();
          return enable;
        }
        throw new Error(result.error);
      },
    },
    messages: {
      syncFontMenu: ({ fontId }) => {
        menuState.checkedFont = fontId;
        buildMenu();
      },
      setFileMenuEnabled: ({ enabled }) => {
        menuState.fileMenuEnabled = enabled;
        buildMenu();
      },
      setWindowTitle: ({ title }) => {
        win.setTitle(title);
      },
    },
  },
});

// --- Check initial file association state ---

menuState.mdAssociated = isMdAssociated();

// --- Build initial menu ---

buildMenu();

// --- Create window ---

const win = new BrowserWindow({
  title: "mdview",
  url: "views://main-ui/index.html",
  frame: {
    width: 860,
    height: 700,
    x: -1,
    y: -1,
  },
  rpc,
});

// --- Handle menu events ---

Electrobun.events.on("application-menu-clicked", (e) => {
  const action = e.data.action;

  if (action === "open_file") {
    // Trigger open dialog from menu
    Utils.openFileDialog({
      allowedFileTypes: "md,markdown,mdown,mkd,mkdn,mdx,txt",
      canChooseFiles: true,
      canChooseDirectory: false,
      allowsMultipleSelection: false,
    }).then((paths) => {
      if (paths && paths.length > 0) {
        win.webview.rpc.send.openFile({ filePath: paths[0] });
      }
    });
    return;
  }

  if (action === "install_cli") {
    const result = installCli();
    win.webview.rpc.send.cliInstallResult({ result });
    return;
  }

  if (action === "associate_md") {
    const newState = !menuState.mdAssociated;
    const result = setMdAssociation(newState);
    if (result.ok) {
      menuState.mdAssociated = newState;
      buildMenu();
    } else {
      win.webview.rpc.send.showError({ message: result.error || "Failed to change file association" });
    }
    return;
  }

  if (action === "export_pdf") {
    win.webview.rpc.send.showError({
      message: "Export as PDF is not yet supported.\n\nCurrent options:\n- Use your browser's print dialog (Cmd+P from within the webview) and choose Save as PDF",
    });
    return;
  }

  // Font actions
  if (action?.startsWith("font_")) {
    menuState.checkedFont = action;
    buildMenu();
    win.webview.rpc.send.setFont({ fontId: action });
    return;
  }

  // Copy/reveal actions forwarded to webview
  if (
    action === "copy_file_path" ||
    action === "copy_dir_path" ||
    action === "copy_project_path" ||
    action === "reveal_finder"
  ) {
    win.webview.rpc.send.menuAction({ action });
    return;
  }
});
