# mdview

A lightweight macOS markdown viewer built with Electrobun (Bun/TypeScript).

## Commands

- `bun install` — install dependencies
- `bun start` — build and launch in dev mode
- `bun run build:dev` — build for development
- `bun run build:release` — build release .app bundle
- `bunx electrobun dev` — launch dev mode (after building)
- `bunx electrobun build` — build the app

## Project Structure

- `src/bun/index.ts` — main process (window, menus, RPC handlers, file I/O)
- `src/main-ui/index.ts` — webview frontend (markdown rendering, UI)
- `src/main-ui/index.html` — HTML shell
- `src/main-ui/styles.css` — all styles
- `src/shared/rpc-types.ts` — typed RPC contract between bun and webview
- `electrobun.config.ts` — Electrobun build configuration

## Style

- Use `bun` for all package management and script running (never npm/npx)
- TypeScript throughout (no plain JS files)
- RPC types shared between bun and webview via `src/shared/rpc-types.ts`
