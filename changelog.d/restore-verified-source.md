### Fixed

- Docker instance restore now verifies the backup before it stops the target or replaces its data.
  A backup with valid checksums but a damaged database could previously replace healthy data.
