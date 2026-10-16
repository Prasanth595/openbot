### Changed

- Set what an agent may do with one Permissions setting in its agent settings: Workspace only, Ask
  first or Full access. Ask first gives the agent full reach, and it asks you before it runs a
  command, changes a file, uses a tool or publishes a site. Claude agents show Workspace only and
  Full access, because Claude does not ask for approval with full reach. On a joined server, an
  owner or admin can change the Permissions of its agents.
- Full access agents now publish, update and delete public sites and use built-in tools without
  asking, as Turbo mode did before. Before, only Turbo mode let an agent do this without asking.
- A Claude agent with full reach now has Full access in all cases. Before, a Claude agent with Auto
  approve off still asked before it used a built-in tool or published a site.
- "Always allow" on an approval card shows only at Ask first, and moves the agent to Full access.

### Removed

- Remove Turbo mode from General settings and the Auto approve switch from the model menu. Each agent
  keeps what it could do: an agent with Turbo mode on before the upgrade has Full access.
