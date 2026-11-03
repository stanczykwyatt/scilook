# Changelog

## 0.1.0

First release.

- **Quick Look previews** for NWB, HDF5, MATLAB (v5 and v7.3) and NumPy (.npy and .npz) files.
- **The file's structure:** groups and arrays with shapes, types and units.
- **NWB facts:** session, start time, identifier and subject.
- **A plot of one array:** lines for signals, a heatmap for images and grids.
- **Big HDF5 and NWB files** read a little at a time.
- **Sandboxed with no permissions,** read-only, no network access. Pickled NumPy objects are never loaded.
