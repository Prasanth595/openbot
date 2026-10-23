### Changed

- A webhook routine now shows its setup as three steps: copy the endpoint, add the signing secret to
  the sender, and send a test event. A new routine has a "Save and get the endpoint" button, and
  "How to sign a request" shows a curl example. Schedule and Webhook are now two buttons above the
  trigger, not an item in a menu.
- The agent and channel settings panel opens wider, so routine settings have more room.
- Save now tells you what is missing, under the name, the instruction or the filter, instead of
  staying unavailable.

### Added

- "Send test event" signs an event that matches the routine and receives it as a real request. The
  routine runs once, and the editor says whether the run started or why it did not. A joined server
  must also run this version.
