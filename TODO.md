# TODO

1. ~~Make the `mdview` CLI command accept command line arguments (e.g. flags for help, version, etc.)~~ Done: CLI now supports `--help`, `--version`, validates files exist, and reports unknown flags
2. ~~Make a way for the program to be associated with .md files so double-clicking a markdown file opens it in mdview — most people will want this~~ Done: LSHandlerRank set to "Default", added "Set as Default for .md Files" menu item that calls LSSetDefaultRoleHandlerForContentType
3. ~~When opening multiple .md files at once, show a document chooser sidebar on the left (like Preview does when you open a bunch of PDFs)~~ Done: sidebar appears when 2+ files are open, with close buttons and click-to-switch
