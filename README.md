# mdview

A lightweight, native markdown viewer for macOS. Opens `.md` files and renders them in a clean, readable format -- like Preview.app but for Markdown.

Built with [Electrobun](https://blackboard.sh/electrobun/) and [markdown-it](https://github.com/markdown-it/markdown-it)

## Features

- **Open markdown files** from the command line or by double-clicking in Finder
- **High-fidelity rendering** via markdown-it (the same engine VS Code uses), with full CommonMark and GitHub Flavored Markdown support
- **Syntax highlighting** for fenced code blocks
- **Font selection** -- choose between a handful of fonts; defaults to the system font
- **Lightweight** -- ~14 MB bundle, <50ms startup, ~15 MB RAM
- **Tables, task lists, footnotes, and frontmatter** support out of the box

## Usage

```bash
# Open a file from the command line
mdview README.md

# Or double-click any .md file in Finder (after setting mdview as the default app)
```

## Development

### Prerequisites

- [Bun](https://bun.sh/) (`curl -fsSL https://bun.sh/install | bash`)
- Xcode Command Line Tools (`xcode-select --install`)

### Setup

```bash
bun install
bun run dev
```

### Build

```bash
bun run build
```
