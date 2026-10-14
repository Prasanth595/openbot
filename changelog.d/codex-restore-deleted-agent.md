### Added

- Restore removed local desktop agents with Ctrl+Z (Cmd+Z on macOS) in the sidebar chat list, or with "Restore last deleted agent" in the sidebar menu.
- Restore agents newest first, including after restart. Keep their chats, memory, routines, settings and files. Removed agents cannot work until restored.
- Permanently delete the newest removed local desktop agent from the sidebar menu after confirmation. The next removed agent stays available for restore. Permanent deletion cannot be undone.

### Fixed

- Apply each restored agent's missed-run policy before scheduling it. Keep other agents' routine schedules unchanged.
- Report marketplace uninstall success only after permanent deletion succeeds.
