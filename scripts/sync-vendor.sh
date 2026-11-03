#!/bin/bash
# Copies the shared readers into js/vendor: the HDF5 reader from brainhound and the format readers
# from dropslice. They're kept as exact copies so fixes flow both ways; run this after changing
# either project, then rebuild with scripts/build-core.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
brainhound="${BRAINHOUND:-../brainhound}"
dropslice="${DROPSLICE:-../dropslice}"
cp "$brainhound/src/hdf5/hdf5.js" js/vendor/hdf5/hdf5.js
for f in tree npy zip mat5 detect; do cp "$dropslice/src/formats/$f.js" "js/vendor/formats/$f.js"; done
echo "Synced from $brainhound and $dropslice"
