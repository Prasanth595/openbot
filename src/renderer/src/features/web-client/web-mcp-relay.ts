// The relayed MCP sign-ins of the browser client (`sign-in-relay-v1`), for the server settings and the
// marketplace. The host starts the sign-in and opens no page. This browser cannot listen for the
// callback, so the user opens the page from the dialog and pastes the address that the browser shows
// at the end. Only its query goes to the host.

import {
  type McpServerConfig,
  type McpSignInRelayPage,
  type McpTestResult,
  relayCallbackQuery,
  type SignInRelayStatus,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { runTeamEffect } from "@openbot/team-client";
import {
  cancelSignInRelay,
  completeSignInRelay,
  signInRelayStatus,
  startMcpSignInRelay,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";

/** How often a sign-in asks the host whether it ended. */
const POLL_MS = 1_000;

/** A relayed sign-in that waits for the address the user pastes. */
interface RelayWait {
  page: URL;
  view: McpSignInRelayPage;
  state: string | null;
  receive: (query: string) => void;
}

export interface WebMcpRelay {
  /** Runs the sign-in of `config` on the host until it ends. */
  signIn: (request: TeamApiRequest, config: McpServerConfig) => Promise<McpTestResult>;
  /** The page of the sign-in of `url`, while it waits in this browser. */
  page: (url: string) => McpSignInRelayPage | null;
  /** Opens the page from a click, so the browser does not block it. */
  open: (url: string) => void;
  /** The address that the browser shows at the end of the sign-in. */
  paste: (url: string, address: string) => Promise<void>;
}

/** `onPage` gets each page when it shows, and `null` when its sign-in ends. */
export function webMcpRelay(
  onPage: (url: string, page: McpSignInRelayPage | null) => void = () => undefined,
): WebMcpRelay {
  const waits = new Map<string, RelayWait>();
  const run = <T>(effect: Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
  const pause = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), POLL_MS));

  async function signIn(request: TeamApiRequest, config: McpServerConfig): Promise<McpTestResult> {
    const url = config.url;
    const { flowId } = await run(startMcpSignInRelay(request, { config }));
    const status = () => run(signInRelayStatus(request, flowId));
    try {
      let current: SignInRelayStatus = await status();
      while (!current.result && !current.authorizeUrl) {
        await pause();
        current = await status();
      }
      if (current.result) return current.result;
      const page = webPage(current.authorizeUrl ?? "");
      if (!page) return { toolCount: 0, error: sourceText("error.backend.mcpSignInNotWebPage") };
      let receive: (query: string) => void = () => undefined;
      const pasted = new Promise<string>((resolve) => {
        receive = resolve;
      });
      const view = { authorizeHost: page.host, listening: false, pasteable: true };
      waits.set(url, { page, view, state: page.searchParams.get("state"), receive });
      onPage(url, view);
      // The host can end the sign-in first: its deadline passed, or the user cancelled.
      while (true) {
        const query = await Promise.race([pasted, pause()]);
        if (query !== null) {
          waits.delete(url);
          current = await run(completeSignInRelay(request, flowId, query));
          break;
        }
        current = await status();
        if (current.result) return current.result;
      }
      while (!current.result) {
        await pause();
        current = await status();
      }
      return current.result;
    } catch (error) {
      void run(cancelSignInRelay(request, flowId)).catch(() => undefined);
      throw error;
    } finally {
      waits.delete(url);
      onPage(url, null);
    }
  }

  return {
    signIn,
    page: (url) => waits.get(url)?.view ?? null,
    open: (url) => {
      const wait = waits.get(url);
      if (wait) window.open(wait.page, "_blank", "noopener,noreferrer");
    },
    paste: (url, address) => {
      const wait = waits.get(url);
      if (!wait) return Promise.reject(new Error(sourceText("error.mcp.relayEnded")));
      const query = relayCallbackQuery(address, wait.state);
      if (query === null) return Promise.reject(new Error(sourceText("error.mcp.relayAddressInvalid")));
      wait.receive(query);
      return Promise.resolve();
    },
  };
}

/** The page address, when it is a web page. The host chose it, so this browser opens nothing else. */
function webPage(address: string): URL | null {
  const url = URL.parse(address);
  return url?.protocol === "https:" ? url : null;
}
