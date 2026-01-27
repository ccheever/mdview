# mdview -- Product Specification

## Overview

mdview is a standalone macOS application that renders Markdown files in a clean, readable format. It serves the same role as Preview.app does for PDFs -- a fast, native viewer that "just works."

## Goals

1. **Fast and lightweight.** Launch instantly, use minimal memory. No Electron.
2. **Beautiful rendering.** Markdown should look as good as a well-formatted web page.
3. **Zero friction.** Open files from Finder or the terminal with no setup.
4. **Simple.** A viewer, not an editor. No sidebar, no file tree, no tabs.

## Non-Goals

- Editing markdown
- Live preview / split pane
- File management or organization
- Exporting to PDF/HTML (may be added later)
- Cross-platform (macOS-only for v1; Tauri makes cross-platform possible later)

---

## Architecture

### Tauri v2

The app uses [Tauri](https://v2.tauri.app/) to create a native macOS application with a web-based UI rendered in a system WebView (WKWebView on macOS).

```
┌──────────────────────────────────────────┐
│  Tauri Shell (Rust)                      │
│  - File I/O (read .md files from disk)   │
│  - CLI argument parsing                  │
│  - macOS file association handling        │
│  - Window management                     │
├──────────────────────────────────────────┤
│  WebView (HTML/CSS/JS)                   │
│  - markdown-it renders MD → HTML         │
│  - highlight.js for code blocks          │
│  - CSS styling and font selection        │
└──────────────────────────────────────────┘
```

### Why Tauri over Electron

| | Tauri | Electron |
|---|---|---|
| Binary size | ~5-10 MB | ~150+ MB |
| RAM usage | ~30-50 MB | ~100-300 MB |
| Startup time | Near-instant | 1-3 seconds |
| Runtime | System WebView | Bundled Chromium |

For a simple viewer app, Tauri's lightweight footprint is the right choice.

### Why markdown-it

markdown-it was selected after evaluating six major JS markdown libraries:

| Library | CommonMark | GFM | Plugins | Secure by Default | Verdict |
|---------|-----------|-----|---------|-------------------|---------|
| **markdown-it** | 100% | Yes (plugins) | Excellent | Yes | **Selected** |
| marked | Partial | Yes (built-in) | Growing | No | Too many compliance gaps |
| remark/rehype | 100% | Yes (plugins) | Best | Yes | Overkill for a viewer |
| micromark | 100% | Yes (extensions) | Low-level | Yes | Good, but harder to extend |
| showdown | No | Partial | Limited | No | Declining maintenance |
| snarkdown | No | No | None | No | Toy library |

Key reasons for choosing markdown-it:
- **VS Code uses it** for its built-in markdown preview -- the strongest endorsement for this exact use case
- **100% CommonMark compliance** ensures all standard markdown renders correctly
- **Rich plugin ecosystem** with drop-in support for GFM tables, task lists, footnotes, frontmatter, and math
- **Secure by default** -- critical for a desktop app opening arbitrary `.md` files from disk
- **Simple API** with a single `highlight` callback for syntax highlighting integration

---

## Features

### 1. File Opening

**From the command line:**
```bash
mdview path/to/file.md
```

**From Finder:**
- Double-click a `.md` file (when mdview is set as the default handler)
- Right-click → Open With → mdview
- Drag and drop a `.md` file onto the mdview icon

**From the app:**
- File → Open (Cmd+O) opens a file picker filtered to `.md` / `.markdown` / `.mdown` files

The Tauri Rust backend reads the file from disk and passes the raw markdown string to the WebView for rendering.

### 2. Markdown Rendering

Powered by markdown-it with the following configuration:

```javascript
const md = new MarkdownIt({
  html: true,          // Allow raw HTML in markdown
  linkify: true,       // Auto-convert URLs to links
  typographer: true,   // Smart quotes and dashes
  highlight: (str, lang) => {
    // highlight.js integration
  }
});
```

**Plugins:**
| Plugin | Purpose |
|--------|---------|
| `markdown-it-footnote` | `[^1]` footnote syntax |
| `markdown-it-task-lists` | `- [x]` checkbox rendering |
| `markdown-it-front-matter` | YAML frontmatter (parsed but hidden from output) |
| `markdown-it-anchor` | Adds `id` attributes to headings |

**Supported syntax:**
- All CommonMark (headings, bold, italic, links, images, code, blockquotes, lists)
- GFM tables
- GFM strikethrough (`~~text~~`)
- GFM task lists (`- [x] done`)
- Fenced code blocks with syntax highlighting
- Footnotes
- Autolinked URLs
- Smart quotes and typographic dashes
- Raw HTML passthrough

### 3. Syntax Highlighting

Fenced code blocks are highlighted using [highlight.js](https://highlightjs.org/) via markdown-it's `highlight` callback.

A single highlight.js theme is bundled (e.g., `github` or `github-dark` depending on system appearance). All common languages are supported.

### 4. Font Selection

Users can choose from a small set of fonts for the document body:

| Font | Description |
|------|-------------|
| **System Default** (default) | `-apple-system, BlinkMacSystemFont` -- matches the OS |
| **Serif** | `Georgia, "Times New Roman", serif` |
| **Sans-serif** | `"Helvetica Neue", Helvetica, Arial, sans-serif` |
| **Monospace** | `"SF Mono", Menlo, Monaco, monospace` |
| **Readable** | `Charter, "Bitstream Charter", "Sitka Text", Cambria, serif` |

Font selection is accessible via a small dropdown or menu bar option (View → Font). The choice is persisted across sessions using Tauri's local storage or a simple JSON config file.

Code blocks always use a monospace font regardless of the body font setting.

### 5. Appearance

**Layout:**
- Single column, centered, max-width ~750px (like a well-formatted article)
- Comfortable line height (~1.6) and paragraph spacing
- Responsive padding that looks good at any window size

**System appearance:**
- Respects macOS light/dark mode automatically
- Light mode: dark text on white/light gray background
- Dark mode: light text on dark background
- Code blocks use appropriate highlight.js theme for each mode

**Images:**
- Relative image paths are resolved relative to the `.md` file's directory
- Images scale to fit the content width (max-width: 100%)

### 6. Window Behavior

- Window title shows the filename (e.g., "README.md -- mdview")
- Standard macOS window controls (close, minimize, zoom)
- Remembers last window size and position
- Cmd+W closes the window
- Scrollable content for long documents

### 7. File Watching (v1 stretch goal)

Optionally watch the open file for changes and re-render automatically. Useful when editing a markdown file in another app and using mdview as a live preview.

---

## CLI Interface

```
mdview [OPTIONS] [FILE]

Arguments:
  [FILE]  Path to a markdown file to open

Options:
  -h, --help     Print help
  -V, --version  Print version
```

If no file is provided, the app opens with a welcome screen or an empty window with a prompt to open a file.

---

## File Associations

The `.app` bundle registers as a handler for these file extensions:
- `.md`
- `.markdown`
- `.mdown`
- `.mkd`
- `.mkdn`
- `.mdx`

This is configured in the Tauri bundle configuration (`tauri.conf.json`) under `bundle > macOS > fileAssociations`.

---

## Project Structure

```
mdview/
├── README.md
├── SPEC.md
├── LICENSE
├── package.json            # Node dependencies (markdown-it, highlight.js)
├── pnpm-lock.yaml
├── src/                    # Frontend (WebView)
│   ├── index.html          # Main HTML shell
│   ├── main.js             # markdown-it setup, rendering logic, font switching
│   └── styles.css          # Document styling, light/dark themes, font classes
├── src-tauri/              # Tauri / Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json     # App config, window settings, file associations
│   ├── src/
│   │   └── main.rs         # File I/O, CLI args, IPC commands
│   └── icons/              # App icons
└── .gitignore
```

---

## Build & Distribution

### Development
```bash
pnpm install
pnpm tauri dev
```

### Production Build
```bash
pnpm tauri build
```

**Outputs:**
- `src-tauri/target/release/bundle/macos/mdview.app` -- macOS app bundle (double-clickable)
- `src-tauri/target/release/mdview` -- standalone binary

### Distribution Options
- Direct `.app` download
- Homebrew cask (`brew install --cask mdview`)
- DMG installer (Tauri can generate this)

---

## Future Considerations (post-v1)

- **Print / Export to PDF** via the WebView's native print support
- **Table of contents** sidebar for long documents
- **Search within document** (Cmd+F, using WebView's built-in find)
- **Multiple windows** for viewing several files at once
- **Cross-platform** builds for Windows and Linux
- **Custom CSS** support for advanced users
- **Math rendering** via KaTeX plugin
