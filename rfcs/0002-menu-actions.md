# RFC 0002: Menu Action Behaviors

**Status:** Draft
**Author:** Charlie Cheever / Claude
**Date:** 2026-03-25

## Summary

Define the expected behavior, UX, and edge cases for four application menu actions: **Install Command Line Tool**, **Set as Default for .md Files**, **Print**, and **Export as PDF**.

## Motivation

All four menu items are implemented today, but their behavior has grown organically and has several gaps, inconsistencies, and missing feedback. This RFC pins down what each action should do, how it should report success and failure, and what edge cases need handling — so that the implementation can be tightened up against a clear spec.

## Current State

| Menu Item | Current Behavior |
|---|---|
| Install Command Line Tool... | Tries `/usr/local/bin/mdview` with admin prompt, falls back to `~/.local/bin/mdview`. Updates shell profile if needed. |
| Set as Default for .md Files... | Calls `LSSetDefaultRoleHandlerForContentType` via osascript/ObjC bridge for `net.daringfireball.markdown`. Falls back to manual instructions dialog. |
| Print... | Calls native `webviewPrint` which opens the macOS print dialog with 36pt margins. |
| Export as PDF... | Calls the same `webviewPrint` — relies on the user choosing "Save as PDF" from the print dialog. |

## Design

### 1. Install Command Line Tool...

**Happy path:**

1. Check if `mdview` is already installed and up-to-date. If the installed script points to the current app bundle and is identical to what we would write, show a confirmation: *"Command line tool is already installed at /usr/local/bin/mdview."* with an OK button. Do not reinstall.
2. If not installed or out of date, attempt to write to `/usr/local/bin/mdview` using an admin prompt (`osascript` privilege escalation).
3. If the user cancels the admin prompt or it fails, fall back to `~/.local/bin/mdview` without requiring elevation.
4. After writing the script, check whether the target directory is in `$PATH`. If not, append it to the appropriate shell profile (`.zshrc` for zsh, `.bash_profile` for bash).
5. Show a success dialog: *"Installed to /usr/local/bin/mdview. You can now run `mdview file.md` from any terminal."* If the PATH was modified, append: *"You may need to open a new terminal window for the `mdview` command to be available."*

**Edge cases:**

- **App is running from a DMG (not yet copied to /Applications).** The CLI script embeds the path to the .app bundle. If the app is running from a mounted DMG, the path will break as soon as the DMG is ejected. Detect this case (check if the bundle path starts with `/Volumes/`) and show a warning: *"mdview appears to be running from a disk image. Please move it to /Applications first, then install the command line tool."* Do not install.
- **Existing `mdview` binary not ours.** Before overwriting, check if the existing file at the target path was written by us (e.g., contains a known marker comment like `# installed by mdview`). If it's an unrecognized file, warn the user: *"A file already exists at /usr/local/bin/mdview that doesn't appear to belong to mdview. Overwrite it?"* with Cancel / Overwrite buttons.
- **Read-only filesystem / SIP.** If both `/usr/local/bin` and `~/.local/bin` fail, show an error dialog with the manual install command so the user can do it themselves.

**Open question:** Should the CLI script be a symlink to a script inside the .app bundle, or a standalone copy? A symlink stays in sync automatically but breaks if the app moves. A standalone copy is resilient but can go stale. Current implementation uses a standalone copy — this seems fine as long as we re-check on "already installed" detection.

### 2. Set as Default for .md Files...

**Happy path:**

1. Call `LSSetDefaultRoleHandlerForContentType` for UTI `net.daringfireball.markdown` with role `LSRolesViewer`, setting the handler to `com.ccheever.mdview`.
2. On success, show a brief confirmation: *"mdview is now the default app for .md files."*

**Edge cases:**

- **Already the default.** Check first via `LSCopyDefaultRoleHandlerForContentType`. If mdview is already the default, show: *"mdview is already the default app for .md files."* Do not call the setter.
- **API failure.** The `LSSetDefaultRoleHandlerForContentType` call can fail silently or throw. If the osascript bridge fails, show a fallback dialog with manual instructions: *"To set mdview as the default, right-click any .md file in Finder, choose Get Info, change 'Open with' to mdview, and click 'Change All'."*
- **UTI coverage.** The UTI `net.daringfireball.markdown` covers `.md` and `.markdown` but not all markdown-adjacent extensions. The Info.plist already declares `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdx`. The Launch Services API only lets us set a handler per-UTI, not per-extension. For now, targeting `net.daringfireball.markdown` is sufficient — it covers the vast majority of real-world markdown files. We should also set the handler for `public.plain-text` subdomain UTIs if macOS associates `.md` with `public.plain-text` on some systems — but this needs testing and may have the unwanted side effect of claiming all plain text files. Leave this as a future investigation.
- **macOS version differences.** `LSSetDefaultRoleHandlerForContentType` was deprecated in macOS 12 in favor of UTType-based APIs. It still works as of macOS 15, but we should monitor for removal. If we need to migrate, the replacement is setting default handlers via `UTType` and `NSWorkspace`.

### 3. Print...

**Happy path:**

1. Trigger the native `NSPrintOperation` on the webview with the current document.
2. macOS shows the standard print dialog. The user selects a printer, adjusts settings, and prints.
3. Print styles from `@media print` CSS are applied (hide sidebar, adjust margins, etc.).

**Edge cases:**

- **No document open.** If the webview is showing the welcome screen or is otherwise empty, printing should still work (it prints what's on screen), but consider showing a hint or disabling the menu item when there's no meaningful content.
- **Multiple files open (sidebar visible).** Print should print only the currently active document, not the sidebar. The existing `@media print` styles handle this by hiding the sidebar — verify this works correctly.
- **Long documents.** macOS handles pagination natively. No special handling needed, but verify that code blocks, tables, and images don't get clipped at page boundaries in unacceptable ways.
- **Images with relative paths.** If the markdown references local images with relative paths, verify they resolve correctly in the print output. They should, since the webview already resolved them for display.

**Keyboard shortcut:** `Cmd+P` (already implemented).

### 4. Export as PDF...

**Current problem:** Export as PDF currently just opens the print dialog and relies on the user clicking the "PDF" dropdown and choosing "Save as PDF". This is functional but clunky — it's two extra clicks and the user has to know about the macOS print dialog's PDF dropdown.

**Proposed behavior:**

1. Show a standard NSSavePanel (file save dialog) with a default filename derived from the document: `{filename-without-extension}.pdf` in the same directory as the source file.
2. Render the webview content to PDF directly using `NSPrintOperation` configured for PDF output (or `WKWebView.createPDF` if available through Electrobun's webview layer).
3. Write the PDF to the chosen path.
4. On success, show a brief notification or open the PDF in Finder (Cmd-click to reveal). No modal dialog — the file appearing in the save location is confirmation enough.

**If direct PDF export is not feasible** (due to Electrobun/webview API limitations), fall back to the current behavior but improve the UX:

1. Open the print dialog.
2. Pre-select "Save as PDF" in the PDF dropdown if the macOS API allows it (unlikely without private API).
3. At minimum, add a tooltip or subtitle to the menu item: *"Uses the Print dialog's PDF option"* — or just rename the menu item to *"Print / Export as PDF..."* to set expectations.

**Edge cases:**

- **No document open.** Same as Print — disable or warn.
- **Overwriting existing PDF.** The NSSavePanel handles overwrite confirmation natively.
- **Filename collisions.** If `README.pdf` already exists, NSSavePanel will prompt. No special handling needed.

**Open question:** Can we use `WKWebView.createPDF(configuration:)` (available since macOS 11) through Electrobun's FFI layer? This would give us a clean, dialog-free PDF export path. Needs investigation into what the webview pointer gives us access to.

## Alternatives Considered

- **Export as PDF using headless Chrome / Puppeteer.** Too heavy a dependency for a native app. The webview already renders the content — we should use it directly.
- **Export as HTML.** Useful but different enough to be a separate feature / RFC.
- **Auto-install CLI on first launch.** Too aggressive. The user should opt in.
- **Set default handler on first launch.** Same — too aggressive. Other apps (VS Code, Typora) don't do this and users would find it presumptuous.

## Implementation Plan

1. **Install CLI improvements** — Add DMG detection, "already installed" check, and foreign-file detection. Small, self-contained changes in `src/bun/index.ts`.
2. **Set default handler improvements** — Add "already default" check and success confirmation. Small change.
3. **Print edge cases** — Verify sidebar hiding, long document pagination, and relative image paths in print output. Mostly testing, may need CSS tweaks.
4. **Export as PDF** — Investigate `WKWebView.createPDF` via FFI. If feasible, implement direct PDF save. If not, keep current behavior and consider renaming the menu item.

## Open Questions

1. **WKWebView.createPDF availability through Electrobun.** Can we call `createPDF(configuration:completionHandler:)` on the webview pointer we get from Electrobun? This is the key question for making Export as PDF a first-class feature vs. a print-dialog shortcut.
2. **UTI landscape.** Are there systems where `.md` files are not associated with `net.daringfireball.markdown`? If so, do we need to register additional UTIs?
3. **CLI script as symlink vs. copy.** Current approach (copy) works but means the script can go stale if the app is updated. Is this worth addressing, or is the "already installed" re-check sufficient?
