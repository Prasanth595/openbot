### Fixed

- A message that you send while Codex compacts the context now waits in the queue and runs after the compaction. Before, Codex refused it and the message failed. When a compaction takes too long, OpenBot now asks Codex to stop it before the queue continues. Thanks to @Johnny-xuan for the report and the first fix (#1766).
