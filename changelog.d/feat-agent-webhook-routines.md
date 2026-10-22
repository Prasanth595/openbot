### Added

- You can ask an agent in chat to make a webhook routine, for example "start when my CI sends a
  failed build". The agent makes the routine and gives you its URL and the request format. A card
  in the chat shows the URL, and you make the signing secret there. The agent never gets the
  secret. The routine shows in the Routines settings with the other routines.
- You can change which events start a webhook routine from the chat. Ask the agent, for example
  "only for the main branch", or change the event type and the filters on the card and press Save.
  The URL and the secret stay the same.
