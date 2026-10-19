### Fixed

- Let Claude agents run tools from Homebrew, `~/.local/bin` and other folders of your shell `PATH`
  when you open OpenBot from Finder, the Dock, or a login item. Before, the Bash tool and hooks
  reported `command not found`. An `env.PATH` in your Claude settings still wins.
