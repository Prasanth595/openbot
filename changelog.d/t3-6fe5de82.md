### Fixed

- The Linux AppImage starts on Arch Linux, Omarchy and other systems with no libfuse2. It mounts
  itself with `fusermount3` from the `fuse3` package. Before, it stopped with an error about
  `libfuse.so.2`.
