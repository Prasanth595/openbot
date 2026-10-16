### Changed

- Set what an agent may do with one Permissions setting in its agent settings: Workspace only, Ask
  first or Full access. Ask first gives the agent full reach, and it asks you before it runs a
  command, changes a file, uses a tool or publishes a site. Claude agents show Workspace only and
  Full access, because Claude does not ask for approval with full reach. On a joined server, an
  owner or admin can change the Permissions of its agents.
- Full access agents now publish, update and delete public sites and use built-in tools without
  asking, as Turbo mode did before. Before, only Turbo mode let an agent do this without asking.
- A Claude agent with Auto approve off shows Ask first. It asks before it uses a built-in tool or
  publishes a site, as before, but Claude's own tools run without asking. Select Full access or
  Workspace only to change it.
- "Always allow" on an approval card shows only at Ask first, and moves the agent to Full access.

### Removed

- Remove Turbo mode from General settings and the Auto approve switch from the model menu. Each agent
  keeps what it could do: an agent with Turbo mode on before the upgrade has Full access.
