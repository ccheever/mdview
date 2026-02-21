import Electrobun, { Electroview } from "electrobun/view";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import frontMatter from "markdown-it-front-matter";
import anchor from "markdown-it-anchor";
import hljs from "highlight.js";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { MdviewRPC } from "../rpc";

// ── markdown-it setup ──

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        // fall through
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(footnote);
md.use(taskLists, { enabled: false, label: true });
md.use(frontMatter, (_fm: string) => {
  // Silently consume frontmatter
});
md.use(anchor, { permalink: false });

// ── DOM references ──

const contentEl = document.getElementById("content")!;

// ── Render markdown ──

let currentDirPath = "";

function renderMarkdown(content: string, dirPath: string) {
  currentDirPath = dirPath;
  let html = md.render(content);

  // Resolve relative image paths
  if (dirPath) {
    html = html.replace(
      /(<img\s+[^>]*src=")(?!https?:\/\/|data:|file:\/\/)([^"]+)(")/g,
      (_match, pre, src, post) => {
        // Use file:// protocol for local images
        const absPath = dirPath + "/" + src;
        return `${pre}file://${absPath}${post}`;
      }
    );
  }

  contentEl.innerHTML = html;

  // Scroll to top on new file
  window.scrollTo(0, 0);
}

// ── Font management ──

function applyFont(font: string) {
  // Apply font to content area only, not the window chrome
  contentEl.classList.remove(
    "font-system",
    "font-inter",
    "font-serif",
    "font-sans",
    "font-mono",
    "font-readable"
  );
  contentEl.classList.add(`font-${font}`);
}

// ── Size management ──

function applySize(size: number) {
  document.documentElement.style.setProperty("--font-size", `${size}px`);
}

// ── PDF export ──

async function generatePDF(): Promise<string> {
  // Capture the content element as a canvas
  const canvas = await html2canvas(contentEl, {
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;

  // Use letter size (8.5 x 11 inches) in points
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 36; // 0.5 inch margins
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  // Scale image to fit page width
  const scale = usableWidth / imgWidth;
  const scaledHeight = imgHeight * scale;

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  // If content fits on one page
  if (scaledHeight <= usableHeight) {
    pdf.addImage(imgData, "JPEG", margin, margin, usableWidth, scaledHeight);
  } else {
    // Split across multiple pages
    let remainingHeight = imgHeight;
    let sourceY = 0;
    let isFirstPage = true;

    while (remainingHeight > 0) {
      if (!isFirstPage) {
        pdf.addPage();
      }

      // How much of the source image fits on this page
      const sliceHeight = Math.min(remainingHeight, usableHeight / scale);

      // Create a canvas for this page's slice
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = imgWidth;
      pageCanvas.height = sliceHeight;
      const ctx = pageCanvas.getContext("2d")!;
      ctx.drawImage(
        canvas,
        0, sourceY, imgWidth, sliceHeight,
        0, 0, imgWidth, sliceHeight
      );

      const pageImgData = pageCanvas.toDataURL("image/jpeg", 0.95);
      const pageScaledHeight = sliceHeight * scale;
      pdf.addImage(pageImgData, "JPEG", margin, margin, usableWidth, pageScaledHeight);

      sourceY += sliceHeight;
      remainingHeight -= sliceHeight;
      isFirstPage = false;
    }
  }

  // Return as base64 (strip the data:application/pdf;base64, prefix)
  const pdfOutput = pdf.output("datauristring");
  const base64 = pdfOutput.split(",")[1];
  return base64;
}

// ── RPC setup ──

const rpc = Electroview.defineRPC<MdviewRPC>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      exportPDF: async () => {
        const pdfBase64 = await generatePDF();
        return { pdfBase64 };
      },
    },
    messages: {
      loadFile: ({ content, filePath, dirPath }) => {
        renderMarkdown(content, dirPath);
      },
      setFont: ({ font }) => {
        applyFont(font);
      },
      setSize: ({ size }) => {
        applySize(size);
      },
    },
  },
});

const electrobun = new Electrobun.Electroview({ rpc });

// ── Initialize: load saved font and size ──

async function init() {
  try {
    const [fontResult, sizeResult] = await Promise.all([
      electrobun.rpc?.request.getSavedFont({}),
      electrobun.rpc?.request.getSavedSize({}),
    ]);
    if (fontResult?.font) {
      applyFont(fontResult.font);
    }
    if (sizeResult?.size) {
      applySize(sizeResult.size);
    }
  } catch {
    // Default font and size are fine
  }
}

init();
