let opener: (() => void) | null = null;
let pending = false;

/**
 * Opens the search of the home screen from outside it, such as from a quick action of the app icon.
 * A request that comes before the home screen shows waits for it.
 */
export function requestHomeSearch(): void {
  if (opener) opener();
  else pending = true;
}

/**
 * Drops a waiting request. Home calls it when its list is ready but the field cannot show, such as
 * with no agents, so the field does not take the keyboard later with no request.
 */
export function dropHomeSearchRequest(): void {
  pending = false;
}

/** The home screen registers how it opens its search, and `null` when it unmounts. */
export function setHomeSearchOpener(open: (() => void) | null): void {
  opener = open;
  if (!open || !pending) return;
  pending = false;
  open();
}
