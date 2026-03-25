# RFC 0001: CLI Argument Behavior

**Status:** Draft
**Author:** Charlie Cheever / Claude
**Date:** 2026-03-25
**Revised:** 2026-03-25

## Summary

Define the complete behavior of the `mdview` command for all argument patterns: no arguments, single file, single directory, multiple files, multiple directories, and mixed file/directory arguments. Also replace the unreliable signal-file IPC mechanism with direct Apple Event delivery.

## Motivation

mdview's CLI currently handles files and no-args, but has no support for directories. Users should be able to point mdview at a folder and browse all the markdown in it. The behavior for each argument pattern should be well-defined and unsurprising.

Additionally, the current file-opening mechanism is unreliable. The CLI writes paths to `/tmp/mdview-open` and then runs `open -b` separately. This has several problems:

- **Race condition on cold start:** If the app isn't already running, it may not read the signal file before the old process's exit handler deletes it, or before the new process creates a fresh empty one.
- **Interleaving:** Concurrent `mdview` invocations append to the same file, so paths from different invocations can intermix, destroying per-invocation ordering.
- **Polling latency:** The app polls the signal file every 300ms, so there's a perceptible delay.
- **No batching:** Paths arrive one-per-line with no grouping, so the app can't know which file should be shown first in a multi-file invocation.

## Current Behavior

| Invocation | What happens today |
|---|---|
| `mdview` | Opens app with welcome screen |
| `mdview file.md` | Opens the file, no sidebar |
| `mdview a.md b.md` | Opens both files, sidebar visible, last file shown (not first) |
| `mdview dir/` | Error: file not found |
| `mdview --help` | Prints usage |
| `mdview --version` | Prints version |

## Design

### File-opening mechanism

Replace the signal-file mechanism with direct Apple Event delivery via the `open` command.

**Current (broken):**
```bash
printf "%s\n" "${files[@]}" >> /tmp/mdview-open
open -b com.ccheever.mdview
```

**Proposed:**
```bash
open -b com.ccheever.mdview "${files[@]}"
```

macOS `open` sends an `odoc` Apple Event to the target app, which triggers `application:openFiles:` — a delegate that the Electrobun patch already implements. This works whether the app is running or not:

- **App not running:** macOS launches the app and delivers the files via `ELECTROBUN_STARTUP_OPEN_FILES` env var and the `application:openFiles:` delegate.
- **App already running:** macOS sends the Apple Event to the running instance, which fires the `open-file` Electrobun event.

The signal file (`/tmp/mdview-open`) and its watcher should be removed entirely.

**Batch awareness:** When multiple `open-file` events arrive within a short window (e.g., the same event-loop tick or within 50ms), they should be treated as a single batch. The first file in the batch is the initially displayed file. This preserves per-invocation ordering without requiring protocol changes.

### Argument resolution

Each positional argument is resolved in order:

1. **File** — If the path is a file with a recognized markdown extension (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdx`), add it to the open list.
2. **Directory** — If the path is a directory, find all markdown files in it (non-recursively by default) and add them to the open list, sorted by last-modified time (newest first), with alphabetical filename as a tiebreaker.
3. **Not found** — Print a warning to stderr (`mdview: no such file or directory: <path>`) and continue processing remaining arguments.
4. **Non-markdown file** — Print a warning to stderr (`mdview: not a markdown file: <path>`) and skip it.

**End-of-options:** `--` terminates flag parsing. Everything after `--` is treated as a path, even if it starts with `-`. This allows opening files like `-notes.md`.

**Exit codes:**

| Condition | Exit code |
|---|---|
| At least one file resolved successfully | 0 |
| Every argument was invalid (not found, not markdown, or directory with no markdown files) | 1 |
| No arguments (welcome screen) | 0 |
| `--help`, `--version` | 0 |

A directory that exists but contains no markdown files counts as invalid for exit-code purposes — it expanded to zero files.

### Invocation patterns

#### `mdview` (no arguments)

Open the app with the welcome screen, as today. Do **not** implicitly scan the current directory — that would be surprising and slow in large repos.

#### `mdview <file>`

Open the single file. Sidebar hidden (1 file). This is unchanged from today.

#### `mdview <directory>`

Find all markdown files in the directory (top-level only, not recursive). Open them all, sorted by last-modified time (newest first), with alphabetical filename as a tiebreaker. Sidebar visible if 2+ files found.

**Initial file:** If the directory contains a `README.md` (case-insensitive match), display it first regardless of mtime. Otherwise, display the most recently modified file. The sidebar order is always by mtime.

If the directory contains no markdown files, show the welcome screen and print a warning: `mdview: no markdown files in <directory>`.

#### `mdview <file1> <file2> ...`

Open all files. Sidebar visible (2+ files). First file in the argument list is the initially displayed file. The sidebar displays files in argument order.

#### `mdview <file1> <directory> <file2> ...`

Expand directories inline — each directory is replaced by its markdown files (sorted by last-modified, newest first, alphabetical tiebreaker) at the position where it appeared in the argument list. Then open everything. The first resolved file is the initially displayed file.

Example: `mdview intro.md ./guides/ appendix.md` where `guides/` contains `a.md` (modified yesterday) and `b.md` (modified today) results in the open list: `intro.md`, `guides/b.md`, `guides/a.md`, `appendix.md`.

The sidebar displays files in this same resolved order.

### Recursive directory scanning

Directories are scanned non-recursively by default. A `--recursive` / `-r` flag enables recursive scanning for all directory arguments in the invocation. When recursive, files are sorted by last-modified time (newest first), with full relative path as a tiebreaker.

Hidden files and directories (names starting with `.`) are excluded from all directory scans, recursive or not.

### Safety limit

If directory expansion (recursive or not) produces more than 200 markdown files total across all arguments, open only the first 200 (by the resolved order) and print a warning to stderr: `mdview: too many files (N found), opening first 200`. This is a hard limit — not configurable. 200 is high enough for any reasonable use case and low enough to prevent the app from choking.

### Deduplication

If the same file appears multiple times (e.g., explicitly listed and also inside a listed directory), it should appear only once in the open list, at the position of its first occurrence.

"Same file" means the same resolved absolute path after `realpath` — so a symlink and its target are the same file, and `./foo.md` and `foo.md` are the same file.

### Symlinks

File symlinks are followed (the target is opened). During recursive directory scanning, directory symlinks are **not** followed, to avoid cycles.

### Glob expansion

The shell handles glob expansion before mdview sees the arguments (`mdview *.md` becomes `mdview a.md b.md c.md`). No special handling needed in mdview itself, but this is noted for completeness.

### Directory watching

This RFC does not add live-watching of directories for new files. If a file is added to a directory after `mdview` opens it, the user must relaunch or use File > Open. Individual files are still watched for content changes (live reload), as today.

### stdin

`mdview -` or piped input (`cat file.md | mdview`) is out of scope for this RFC.

## Alternatives Considered

**Auto-scan current directory with no args.** Rejected because it would be slow in large repos and surprising — `mdview` with no args is a reasonable way to just launch the app.

**Always recursive by default.** Rejected because deep directory trees (e.g., `node_modules`) could produce thousands of results. Non-recursive is safer and faster; opt-in recursion is available via `-r`.

**Unix domain socket for IPC.** More robust than Apple Events for batching (single JSON message with all files and metadata), but significantly more complex to implement — requires socket lifecycle management, retry logic for cold start, and a fallback for when the socket is stale. Apple Events via `open` are the native macOS mechanism and already work through the Electrobun patch. If Apple Events prove insufficient (e.g., argument length limits with very many files), a socket can be added later.

**Keep signal file as fallback.** Not worth the maintenance burden. The signal file approach has fundamental race conditions that can't be fixed without essentially reinventing a socket protocol on top of a temp file. Better to remove it cleanly.

**Tabs instead of sidebar for multiple files.** Orthogonal to this RFC — the sidebar vs. tabs question is a UI concern. This RFC defines what files get opened, not how they're displayed.

## Implementation Plan

1. **Replace IPC mechanism.** Change the CLI script to pass files directly to `open -b com.ccheever.mdview`. Remove the signal file watcher and `process.on("exit")` cleanup from the main process. Verify the `open-file` Electrobun event fires correctly for both cold and warm start.
2. **Add batch coalescing.** In the main process, collect `open-file` events that arrive within the same tick / 50ms window into a batch. Display the first file in the batch.
3. **Add directory detection to CLI.** Detect directories (via `[ -d "$arg" ]`), expand to markdown file list sorted by mtime, and pass expanded paths to `open`.
4. **Add `--recursive` / `-r` flag and `--` end-of-options.**
5. **Add deduplication** via `realpath` in the CLI script.
6. **Add safety limit** (200 files total).
7. **Update `--help` text** to document directory support, `-r`, and `--`.

Steps 1-2 can be done first as a standalone reliability fix. Steps 3-7 add directory support on top.

## Open Questions

1. Should README.md-as-initial-file apply only to single-directory invocations, or also when a directory appears as one of several arguments? (Proposed: only when the entire invocation is a single directory — in mixed args, argument order determines the initial file.)
