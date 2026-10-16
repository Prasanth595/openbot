### Fixed

- Start OpenBot faster after a clean stop when the database is large. Before, each start read the
  full database file to check it, which took minutes on a large file. The check now runs only after
  a stop that did not close the database, or after a database upgrade.
