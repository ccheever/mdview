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
	window.scrollTo(0, 0);
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
		};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {};
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
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

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

	const file = files[0];
	const name = file.name;

	// Check if it's a markdown file
	const ext = name.substring(name.lastIndexOf(".")).toLowerCase();
	const mdExts = [".md", ".markdown", ".mdown", ".mkd", ".mkdn", ".mdx"];
	if (!mdExts.includes(ext)) return;

	// Try to get file path (may work in some webview implementations)
	const path = (file as any).path;
	if (path) {
		const result = await rpc.request.readFile({ path });
		if ("content" in result) {
			renderMarkdown(result.content, result.path);
			return;
		}
	}

	// Fallback: read content directly via FileReader
	const reader = new FileReader();
	reader.onload = () => {
		const content = reader.result as string;
		renderMarkdown(content, name);
	};
	reader.readAsText(file);
});
