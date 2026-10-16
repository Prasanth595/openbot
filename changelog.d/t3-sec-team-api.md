### Security

- Disable and remove members correctly when an admin uses a team app on a server with an OpenBot
  account. Before, the change was only in the team file of the server: the account kept the
  membership, and the member stayed connected. Now the account changes, and the server closes each
  session of that member. This also applies to a change from the desktop app.
- Count failed sign-in attempts for each connected device. Before, all devices that connect through
  the account service used one count, so one member could stop password sign-in to a user name for
  all other members.
- Do not send the full folder path of an agent workspace when a member opens a folder. The path
  now starts with `~` when the workspace is in the home folder, so it does not show the user name
  of the server computer.
