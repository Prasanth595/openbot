### Fixed

- Reject custom cron numbers that are not plain decimal digits, such as `0x5`, `1e1`, `+5` or `5.0`, when saving a new or changed routine schedule. Keep saved schedules readable and editable.
