### Security

- A member that the owner or an admin removed could rejoin a server with an invitation or a team link from before the removal. Now that member needs a new invitation or a reactivation.
- An invitation from an admin stayed valid after the admin was removed or demoted. Now it stops working.
- If the public ticket key set had a private key by mistake, `/.well-known/jwks.json` published the private key. Now it publishes only the public members.
