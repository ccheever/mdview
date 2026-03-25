import Electrobun, { Electroview, type RPCSchema } from "electrobun/view";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import frontmatter from "markdown-it-front-matter";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

// Set up markdown-it with plugins
const md = new MarkdownIt({
	html: true,
	linkify: true,
	typographer: true,
	highlight: (str: string, lang: string) => {
		if (lang && hljs.getLanguage(lang)) {
			try {
				return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
			} catch {
				// fall through
			}
		}
		// Auto-detect for unlabeled code blocks
		try {
			return hljs.highlightAuto(str).value;
		} catch {
			return "";
		}
	},
});

md.use(anchor, { permalink: false });
md.use(footnote);
md.use(frontmatter, () => {}); // parse but ignore frontmatter
md.use(taskLists, { enabled: false }); // render checkboxes as disabled

// Track the current file's directory for resolving relative paths
let currentFileDir = "";

function renderMarkdown(content: string, filePath: string) {
	const rawHtml = md.render(content);
	const cleanHtml = DOMPurify.sanitize(rawHtml, {
		ADD_TAGS: ["input"], // for task list checkboxes
		ADD_ATTR: ["checked", "disabled", "type"],
	});

	const contentEl = document.getElementById("content")!;
	const welcomeEl = document.getElementById("welcome")!;

	welcomeEl.style.display = "none";
	contentEl.style.display = "block";
	contentEl.innerHTML = cleanHtml;

	// Resolve relative image paths
	const dir = filePath.substring(0, filePath.lastIndexOf("/"));
	currentFileDir = dir;
	contentEl.querySelectorAll("img").forEach((img) => {
		const src = img.getAttribute("src");
		if (src && !src.startsWith("http") && !src.startsWith("data:") && !src.startsWith("/")) {
			img.src = `file://${dir}/${src}`;
		} else if (src && src.startsWith("/")) {
			img.src = `file://${src}`;
		}
	});

	// Make links open in default browser
	contentEl.querySelectorAll("a").forEach((a) => {
		const href = a.getAttribute("href");
		if (href && href.startsWith("http")) {
			a.addEventListener("click", (e) => {
				e.preventDefault();
				window.open(href, "_blank");
			});
		}
	});

	// Scroll to top on new file
	const mainEl = document.getElementById("main")!;
	mainEl.scrollTo(0, 0);
}

function updateFileList(files: Array<{ path: string; filename: string; isCurrent: boolean }>) {
	const listEl = document.getElementById("document-list")!;
	const sidebarEl = document.getElementById("sidebar")!;
	const welcomeEl = document.getElementById("welcome")!;
	const contentEl = document.getElementById("content")!;

	listEl.innerHTML = "";

	if (files.length === 0) {
		sidebarEl.classList.remove("visible");
		welcomeEl.style.display = "";
		contentEl.style.display = "none";
		return;
	}

	// Show sidebar when there are 2+ files
	if (files.length >= 2) {
		sidebarEl.classList.add("visible");
	} else {
		sidebarEl.classList.remove("visible");
	}

	for (const file of files) {
		const li = document.createElement("li");
		li.className = "document-item" + (file.isCurrent ? " active" : "");
		li.title = file.path;

		const nameSpan = document.createElement("span");
		nameSpan.className = "document-name";
		nameSpan.textContent = file.filename;
		li.appendChild(nameSpan);

		const closeBtn = document.createElement("button");
		closeBtn.className = "document-close";
		closeBtn.textContent = "\u00d7";
		closeBtn.title = "Close";
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			rpc.send("closeFile", { path: file.path });
		});
		li.appendChild(closeBtn);

		li.addEventListener("click", () => {
			rpc.send("selectFile", { path: file.path });
		});

		listEl.appendChild(li);
	}
}

// RPC schema (matches main process)
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

const rpc = Electroview.defineRPC<MdviewRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {},
		messages: {
			renderMarkdown: (data) => {
				renderMarkdown(data.content, data.filePath);
			},
			updateFileList: (data) => {
				updateFileList(data.files);
			},
			setFont: (data) => {
				document.documentElement.style.setProperty("--mdview-font-family", data.fontFamily);
			},
			setFontSize: (data) => {
				document.documentElement.style.setProperty("--mdview-font-size", `${data.size}px`);
			},
			setAppearance: (data) => {
				const root = document.documentElement;
				root.removeAttribute("data-theme");
				if (data.mode === "light") {
					root.setAttribute("data-theme", "light");
				} else if (data.mode === "dark") {
					root.setAttribute("data-theme", "dark");
				}
				// "auto" removes the attribute, falling back to @media queries
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

// Signal to the main process that the webview is ready to receive RPC messages
rpc.send("ready", {});

// Handle drag-and-drop of files onto the window
document.addEventListener("dragover", (e) => {
	e.preventDefault();
	e.stopPropagation();
});

document.addEventListener("drop", async (e) => {
	e.preventDefault();
	e.stopPropagation();

	const files = e.dataTransfer?.files;
	if (!files || files.length === 0) return;

	const mdExts = [".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdx"];

	for (const file of Array.from(files)) {
		const name = file.name;
		const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
		if (!mdExts.includes(ext)) continue;

		const path = (file as any).path;
		if (path) {
			const result = await rpc.request.readFile({ path });
			if ("content" in result) {
				renderMarkdown(result.content, result.path);
			}
		} else {
			// Fallback: read content directly via FileReader
			const reader = new FileReader();
			reader.onload = () => {
				const content = reader.result as string;
				renderMarkdown(content, name);
			};
			reader.readAsText(file);
		}
	}
});
