# Security

SciLook previews files people may not want to share, so it's built to touch nothing but the file in front of it.

## Reporting a vulnerability

Please report security problems privately through **Security → Report a vulnerability** on this repository, not in a public issue. You'll get a reply within a few days.

## What it can do

- **The Quick Look extension** is sandboxed with no entitlement beyond the sandbox itself. Quick Look gives it read access to the one file being previewed, for the length of the preview. It reads that file at the offsets its readers ask for, at most 256 MB at a time, and returns a page of HTML.
- **The app** only shows a window explaining how to use the extension. It's sandboxed with nothing else too.
- **The preview code** runs in JavaScriptCore with nothing added but a function that reads the file. It has no way to reach the network, other files or other programs.

## What it doesn't do

- **Write anything.** No files, caches or logs. CI checks the Swift code for file-writing calls.
- **Use the network.** No networking code, and the sandbox gives it no network access.
- **Run code from a file.** NumPy object arrays (Python pickles) are refused, never loaded. The preview page contains no scripts at all. Every piece of text from a file is escaped before it goes into the page.

## Hostile files

The HDF5 reader caps each read, the work per preview and how far compressed data may unpack, and refuses loops in a file's structure. The MATLAB and NumPy readers check every size against the data actually there, and everything compressed inside one file shares a single 256 MB unpacking budget. MATLAB v5 and NumPy files over 256 MB aren't read at all; the preview says so. Files under that limit are read whole, so a preview can briefly use a few times the file's size in memory. A file that's damaged or built to cause trouble gets a page saying it couldn't be read.

## The signature

SciLook is signed ad hoc, without a Developer ID, with a requirement that names its bundle identifiers. Neither the app nor the extension holds a permission grant, so no other program could gain anything by sharing those identifiers.

## Dependencies

None at run time beyond macOS. The JavaScript is bundled with esbuild, a build-time tool only.
