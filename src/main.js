import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItFrontMatter from "markdown-it-front-matter";
import markdownItAnchor from "markdown-it-anchor";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

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

let currentFilePath = null;
let currentBaseDir = null;
let currentProjectRoot = null;

// --- Rendering ---

function renderMarkdown(raw) {
  const contentEl = document.getElementById("content");
  contentEl.innerHTML = md.render(raw);

  // Resolve relative image paths to the file's directory
  if (currentBaseDir) {
    contentEl.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !src.startsWith("http") && !src.startsWith("data:") && !src.startsWith("/")) {
        img.src = "asset://localhost/" + currentBaseDir + "/" + src;
      } else if (src && src.startsWith("/")) {
        img.src = "asset://localhost" + src;
      }
    });
  }

  // Open external links in the default browser
  contentEl.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && href.startsWith("http")) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        shellOpen(href);
      });
    }
  });
}

async function openFile(filePath) {
  try {
    const result = await invoke("read_file", { path: filePath });
    currentFilePath = result.path;
    currentBaseDir = result.dir;
    renderMarkdown(result.content);
    const fileName = currentFilePath.split("/").pop();
    await getCurrentWindow().setTitle(fileName + " \u2014 mdview");

    // Enable the file-related menu items by notifying Rust
    invoke("find_project_root", { filePath: currentFilePath }).then((root) => {
      currentProjectRoot = root;
    });

    invoke("set_file_menu_enabled", { enabled: true });
  } catch (err) {
    const contentEl = document.getElementById("content");
    contentEl.innerHTML = `<div id="welcome"><h1>Error</h1><p>${err}</p></div>`;
  }
}

// --- File open dialog (Cmd+O) ---

async function showOpenDialog() {
  const selected = await openDialog({
    multiple: false,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"],
      },
    ],
  });
  if (selected) {
    await openFile(selected);
  }
}

// --- Font selection (driven by menu bar) ---

const fontClassMap = {
  font_system: "font-system",
  font_inter: "font-inter",
  font_serif: "font-serif",
  font_sans: "font-sans",
  font_mono: "font-mono",
  font_readable: "font-readable",
};

function applyFont(key) {
  document.body.className = fontClassMap[key] || "font-system";
  localStorage.setItem("mdview-font", key);
}

// Restore saved font on load and sync menu checkmarks
const savedFont = localStorage.getItem("mdview-font");
if (savedFont && fontClassMap[savedFont]) {
  applyFont(savedFont);
  invoke("sync_font_menu", { fontId: savedFont });
}

// --- Keyboard shortcuts ---

document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key === "o") {
    e.preventDefault();
    showOpenDialog();
  }
});

// --- Tauri events ---

// Listen for file-open events from the Rust backend (CLI args, file associations)
listen("open-file", (event) => {
  openFile(event.payload);
});

// Listen for font changes from the menu bar
listen("set-font", (event) => {
  applyFont(event.payload);
});

// Listen for menu actions (copy paths, reveal)
listen("menu-action", async (event) => {
  const action = event.payload;
  if (!currentFilePath) return;

  switch (action) {
    case "copy_file_path":
      await writeText(currentFilePath);
      break;
    case "copy_dir_path":
      if (currentBaseDir) {
        await writeText(currentBaseDir);
      }
      break;
    case "copy_project_path":
      if (currentProjectRoot) {
        await writeText(currentProjectRoot);
      }
      break;
    case "reveal_finder":
      await invoke("reveal_in_finder", { filePath: currentFilePath });
      break;
  }
});

// Listen for error messages from the backend
listen("show-error", (event) => {
  alert(event.payload);
});

// Listen for CLI install result
listen("cli-install-result", (event) => {
  const result = event.payload;
  if (result === "ok") {
    alert("Command line tool installed successfully.\n\nYou can now run:\n  mdview file.md");
  } else if (result === "already-installed") {
    alert("Command line tool is already installed.\n\nYou can run:\n  mdview file.md");
  } else if (result === "cancelled") {
    // User cancelled the admin prompt, do nothing
  } else {
    alert("Failed to install command line tool.\n\n" + result);
  }
});

// Check if a file was passed via CLI on startup
invoke("get_initial_file").then((filePath) => {
  if (filePath) {
    openFile(filePath);
  }
});
