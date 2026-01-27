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

// --- Font selection ---

const fontSelect = document.getElementById("font-select");
const fontClassMap = {
  system: "font-system",
  serif: "font-serif",
  "sans-serif": "font-sans",
  monospace: "font-mono",
  readable: "font-readable",
};

function applyFont(key) {
  document.body.className = fontClassMap[key] || "font-system";
  localStorage.setItem("mdview-font", key);
}

// Restore saved font
const savedFont = localStorage.getItem("mdview-font");
if (savedFont) {
  fontSelect.value = savedFont;
  applyFont(savedFont);
}

fontSelect.addEventListener("change", (e) => {
  applyFont(e.target.value);
});

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

// Check if a file was passed via CLI on startup
invoke("get_initial_file").then((filePath) => {
  if (filePath) {
    openFile(filePath);
  }
});
