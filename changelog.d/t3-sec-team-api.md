### Security

- Disable and remove members correctly when an admin uses a team app on a server with an OpenBot
  account. Before, the change was only in the team file of the server: the account kept the
  membership, and the member stayed connected. Now the account changes, and the server closes each
  session of that member. This also applies to a change from the desktop app.
- Count failed sign-in attempts for each connected device. Before, all devices that connect through
  the account service used one count, so one member could stop password sign-in to a user name for
  all other members.
- Count sign-in attempts for a user name with spaces around it as attempts for that user name.
