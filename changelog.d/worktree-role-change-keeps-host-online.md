### Fixed

- Keep the server and its members connected when an owner or admin changes the role of a member.
  Before, each change to Admin or Member disconnected the host and every connected member, and the
  server showed as offline until it connected again. Now only the member whose role changed
  connects again, with the new role.
