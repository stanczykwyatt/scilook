# Contributing

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Reporting a file that doesn't preview

Open a [bug report](https://github.com/stanczykwyatt/scilook/issues/new?template=bug.yml) with the format, what wrote the file (h5py, pynwb, MATLAB, numpy and their versions) and what you saw. A small file with made-up data that shows the problem helps most. Please don't share private data.

## Getting started

You need Node 20 or later and the Xcode Command Line Tools.

```bash
cd js && npm ci && npm test      # the preview code, in Node
scripts/build-core.sh            # bundles it into Sources/SciLookCore/Resources/scilook.js (commit it)
swift test                       # the preview through JavaScriptCore
scripts/build-app.sh             # build/SciLook.app
node scripts/check-rules.mjs     # read-only, no network, sandbox only
```

To try a preview without installing anything, `swift test` renders every test file the way the extension does. Installing a build registers its extension with Quick Look on your Mac; remove it from Applications to undo that.

## How it's put together

- `js/src/summary.js` makes the preview page: it recognizes the file, builds the list of groups and arrays, picks one to plot, and writes self-contained HTML (an SVG line plot, or a heatmap as a small PNG).
- `js/vendor/` holds the shared readers, copied by `scripts/sync-vendor.sh`: `hdf5/hdf5.js` from brainhound, and `formats/` from dropslice. Fix bugs in those projects, then sync.
- `js/src/shims.js`, `inflate.js` and `zlib-shim.js` give the readers what JavaScriptCore lacks: a small Buffer, a TextDecoder, and DEFLATE.
- `Sources/SciLookCore/Renderer.swift` runs the bundle in JavaScriptCore and hands it file bytes.
- `Sources/SciLookPreview` is the Quick Look extension, and `Sources/SciLook` the app that carries it.
- `scripts/make-art.swift` draws the icon, demo and preview image.

## Ground rules

- **Read-only, no network, sandbox only.** No new entitlements.
- **Escape everything from a file** before it goes into the page.
- **Never load pickles** or run anything from a file.
- **Made-up data only** in test files and art.
- Run the tests and `check-rules` before opening a pull request, add a test with your change, and commit the rebuilt `scilook.js`.

## Security issues

Please don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
