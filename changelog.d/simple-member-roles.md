### Changed

- Admins can now change a member's role, remove a member and end a member's session, as the owner
  can. Nobody can change or remove the owner.

### Fixed

- A role change or removal that an admin makes on a joined server now stays. Before, the server
  could undo it at the next member list refresh.
- When the server reads its member list, it now disconnects a member that was removed or got
  another role. Before, the open session could continue with the old role until it ended.
