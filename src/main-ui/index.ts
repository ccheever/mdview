import { Electroview } from "electrobun/view";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItFrontMatter from "markdown-it-front-matter";
import markdownItAnchor from "markdown-it-anchor";
import type { MdviewRPC } from "../shared/rpc-types";

// --- markdown-it setup ---

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (_) {}
    }
    return "";
  },
});

md.use(markdownItFootnote);
md.use(markdownItTaskLists, { enabled: false, label: true });
md.use(markdownItFrontMatter, () => {});
md.use(markdownItAnchor);

// --- State ---

let currentFilePath: string | null = null;
let currentBaseDir: string | null = null;
let currentProjectRoot: string | null = null;

// --- RPC setup ---

const rpc = Electroview.defineRPC<MdviewRPC>({
  handlers: {
    requests: {},
    messages: {
      openFile: ({ filePath }) => {
        openFile(filePath);
      },
      setFont: ({ fontId }) => {
        applyFont(fontId);
      },
      menuAction: async ({ action }) => {
        if (!currentFilePath) return;

        switch (action) {
          case "copy_file_path":
            await electroview.rpc.request.copyToClipboard({ text: currentFilePath });
            break;
          case "copy_dir_path":
            if (currentBaseDir) {
              await electroview.rpc.request.copyToClipboard({ text: currentBaseDir });
            }
            break;
          case "copy_project_path":
            if (currentProjectRoot) {
              await electroview.rpc.request.copyToClipboard({ text: currentProjectRoot });
            }
            break;
          case "reveal_finder":
            await electroview.rpc.request.revealInFinder({ filePath: currentFilePath });
            break;
        }
      },
      showError: ({ message }) => {
        alert(message);
      },
      cliInstallResult: ({ result }) => {
        if (result === "ok") {
          alert("Command line tool installed successfully.\n\nYou can now run:\n  mdview file.md");
        } else if (result === "already-installed") {
          alert("Command line tool is already installed.\n\nYou can run:\n  mdview file.md");
        } else if (result === "cancelled") {
          // User cancelled the admin prompt, do nothing
        } else {
          alert("Failed to install command line tool.\n\n" + result);
        }
      },
    },
  },
});

const electroview = new Electroview({ rpc });

// --- Rendering ---

function renderMarkdown(raw: string) {
  const contentEl = document.getElementById("content")!;
  contentEl.innerHTML = md.render(raw);

  // Resolve relative image paths to the file's directory
  if (currentBaseDir) {
    contentEl.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("http") && !src.startsWith("data:") && !src.startsWith("/")) {
        img.src = "file://" + currentBaseDir + "/" + src;
      } else if (src && src.startsWith("/")) {
        img.src = "file://" + src;
      }
    });
  }

  // Open external links in the default browser
  contentEl.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && href.startsWith("http")) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        electroview.rpc.request.openExternal({ url: href });
      });
    }
  });
}

async function openFile(filePath: string) {
  try {
    const result = await electroview.rpc.request.readFile({ path: filePath });
    currentFilePath = result.path;
    currentBaseDir = result.dir;
    renderMarkdown(result.content);
    const fileName = currentFilePath.split("/").pop();
    electroview.rpc.send.setWindowTitle({ title: fileName + " \u2014 mdview" });

    // Find project root
    electroview.rpc.request.findProjectRoot({ filePath: currentFilePath }).then((root) => {
      currentProjectRoot = root;
    });

    // Enable file-related menu items
    electroview.rpc.send.setFileMenuEnabled({ enabled: true });
  } catch (err) {
    const contentEl = document.getElementById("content")!;
    contentEl.innerHTML = `<div id="welcome"><h1>Error</h1><p>${err}</p></div>`;
  }
}

// --- File open dialog (Cmd+O) ---

async function showOpenDialog() {
  const selected = await electroview.rpc.request.showOpenDialog({});
  if (selected) {
    await openFile(selected);
  }
}

// --- Font selection ---

const fontClassMap: Record<string, string> = {
  font_system: "font-system",
  font_inter: "font-inter",
  font_serif: "font-serif",
  font_sans: "font-sans",
  font_mono: "font-mono",
  font_readable: "font-readable",
};

function applyFont(key: string) {
  document.body.className = fontClassMap[key] || "font-system";
  localStorage.setItem("mdview-font", key);
}

// Restore saved font on load and sync menu checkmarks
const savedFont = localStorage.getItem("mdview-font");
if (savedFont && fontClassMap[savedFont]) {
  applyFont(savedFont);
  electroview.rpc.send.syncFontMenu({ fontId: savedFont });
}

// --- Keyboard shortcuts ---

document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key === "o") {
    e.preventDefault();
    showOpenDialog();
  }
});

// --- Drag and drop ---

document.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    // Try to get the file path (available in some webview implementations)
    const filePath = (file as any).path;
    if (filePath) {
      openFile(filePath);
    } else {
      // Fall back to reading file content via FileReader
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        currentFilePath = file.name;
        currentBaseDir = null;
        renderMarkdown(content);
        electroview.rpc.send.setWindowTitle({ title: file.name + " \u2014 mdview" });
      };
      reader.readAsText(file);
    }
  }
});

// --- Initial file ---

electroview.rpc.request.getInitialFile({}).then((filePath) => {
  if (filePath) {
    openFile(filePath);
  }
});
