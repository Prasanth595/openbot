### Fixed

- A provider CLI that cannot update or set up now shows "Update failed" or "Setup failed". Before, each failure showed "Download failed", also when the download was complete and the new CLI did not start.
- The provider log (`logs/providers/providers.log`) now records the provider, the version and the step where a CLI update failed (`download`, `verify`, `install` or `activate`). Before, the line did not name the step or the version, and it could hold your home folder path.
