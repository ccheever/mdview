# mdview

A lightweight, native markdown viewer for macOS. Opens `.md` files and renders them in a clean, readable format -- like Preview.app but for Markdown.

Built with [Tauri](https://tauri.app/) (Rust + WebView) and [markdown-it](https://github.com/markdown-it/markdown-it) for fast startup, small binary size, and high-quality rendering.

## Features

- **Open markdown files** from the command line or by double-clicking in Finder
- **High-fidelity rendering** via markdown-it (the same engine VS Code uses), with full CommonMark and GitHub Flavored Markdown support
- **Syntax highlighting** for fenced code blocks
- **Font selection** -- choose between a handful of fonts; defaults to the system font
- **Lightweight** -- native Tauri app with no Electron overhead
- **Tables, task lists, footnotes, and frontmatter** support out of the box

## Usage

```bash
# Open a file from the command line
mdview README.md

# Or double-click any .md file in Finder (after setting mdview as the default app)
```

## Development

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (or npm/yarn)
- Xcode Command Line Tools (`xcode-select --install`)

### Setup

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

This produces a `.app` bundle in `src-tauri/target/release/bundle/macos/` and a standalone binary.

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| App framework | [Tauri v2](https://v2.tauri.app/) | Native webview, tiny binary (~5-10 MB), Rust backend |
| Markdown engine | [markdown-it](https://github.com/markdown-it/markdown-it) | 100% CommonMark, used by VS Code, rich plugin ecosystem, secure by default |
| Syntax highlighting | [highlight.js](https://highlightjs.org/) | Works directly with markdown-it's `highlight` option |
| Frontend | Vanilla HTML/CSS/JS | No framework needed for a read-only viewer |

## License

MIT
