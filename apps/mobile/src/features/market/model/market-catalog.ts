import { createMarketplaceCatalog } from "@openbot/team-client/marketplace-catalog";
import { fetch } from "@/features/support/model/logged-fetch";

/** Public catalog requests use the account service origin and carry no session credential. */
export function createMobileMarketCatalog(apiUrl: string) {
  return createMarketplaceCatalog((input, init) =>
    fetch(typeof input === "string" ? new URL(input, apiUrl).toString() : input, init),
  );
}
