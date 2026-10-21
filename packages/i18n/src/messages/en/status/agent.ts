import { defineMessages } from "../../../message";

export const messages = defineMessages("status.agent", {
  "status.agent.claudeWriteOutside":
    "Write {path}, outside the agent's workspace, the shared folder and the temporary folders.",
  "status.agent.contextCleared": "Context cleared. A new chat starts here.",
  "status.agent.modelSwitchedForLimit": "Usage limit reached. Switched to {model}.",
  "status.agent.modelReturnedAfterLimit": "Usage limit ended. Switched back to {model}.",
  "status.agent.marketplaceSuggested": "Suggested a Marketplace app: {app}.",
  "status.agent.screenCaptureScreen": "Capture the main screen and send the image to the agent's model.",
  "status.agent.screenCaptureDisplay": "Capture the display {name} and send the image to the agent's model.",
  "status.agent.screenCaptureWindow": "Capture the window {name} and send the image to the agent's model.",
  "status.agent.screenCaptureRegion":
    "Capture the screen area at {x}, {y}, {width} × {height} points and send the image to the agent's model.",
  "status.agent.screenCaptureProgress": "Asking to capture the screen…",
  "status.agent.screenCaptureReviewing": "Reviewing the screen capture…",
  "status.agent.mcpServerAdd":
    "Add the MCP server {name}: {target}. Every agent on this server gets its tools. OpenBot connects to it to test it.",
  "status.agent.mcpServerChange":
    "Change the MCP server {name} to {target}. Every agent on this server gets its tools. OpenBot connects to it to test it.",
  "status.agent.mcpServerEnable": "Turn on the MCP server {name} for every agent on this server.",
  "status.agent.mcpServerDisable": "Turn off the MCP server {name} for every agent on this server.",
  "status.agent.mcpServerRemove": "Remove the MCP server {name} and its sign-in from every agent on this server.",
  "status.agent.mcpSignInRequested": "The MCP server {name} needs a sign-in. Sign in from Server settings, MCP.",
});
