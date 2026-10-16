import { createSignal, For, lazy, onSettled, Show } from "solid-js";
import channelsArt from "../../../content-art/news/art/card/channels-put-agents-in-one-room.webp";
import workspaceArt from "../../../content-art/news/art/card/every-agent-gets-a-workspace.webp";
import introducingArt from "../../../content-art/news/art/card/introducing-openbot.webp";
import providersArt from "../../../content-art/news/art/card/one-agent-many-providers.webp";
import routinesArt from "../../../content-art/news/art/card/routines-give-an-agent-a-schedule.webp";
import localArt from "../../../content-art/news/art/card/your-work-stays-on-your-computer.webp";

// Loaded in the browser, as in `FeaturesSection`: the avatar engine does not run in the Worker.
const AgentAvatar = lazy(() =>
  import("@openbot/ui/features/agents/AgentAvatar").then((module) => ({ default: module.AgentAvatar })),
);

/** The article cards of the news collection, so the art tiles are the site's own pictures. */
const ART = [introducingArt, channelsArt, workspaceArt, providersArt, routinesArt, localArt];

type HoneycombTile = { kind: "agent"; seed: string } | { kind: "art"; src: string };

interface HoneycombCell {
  index: number;
  tile: HoneycombTile;
}

/** A stable mix: with `artEvery` 5, about one tile in five is art. The same seed always gets the same face. */
export function honeycombRows(rows: number, columns: number, artEvery: number, prefix: string): HoneycombCell[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => {
      const index = row * columns + column;
      const art = artEvery > 0 && (index * 7 + 3) % artEvery === 0;
      const tile: HoneycombTile = art
        ? { kind: "art", src: ART[(index * 5) % ART.length] ?? introducingArt }
        : { kind: "agent", seed: `${prefix}-${index}` };
      return { index, tile };
    }),
  );
}

/**
 * Rows of hexagons with a point at the top, as in a honeycomb. Every second row moves half a cell to
 * the right, and the rows lock together. Each cell is clipped to the same hexagon, so each wall is
 * equal: the agent bodies are drawn by hand and are not all the same size.
 *
 * The faces load when the comb comes near the viewport, also with reduced motion, so a page that the
 * reader leaves early does not load the avatar engine. Each face then drifts, blinks and winks; only
 * the one under the pointer turns its eyes to it. Decorative: the caller hides it from assistive
 * technology.
 */
export function AgentHoneycomb(props: { rows: HoneycombCell[][] }) {
  let comb: HTMLDivElement | undefined;
  const [near, setNear] = createSignal(false);
  onSettled(() => {
    if (!comb || !globalThis.IntersectionObserver) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(comb);
    return () => observer.disconnect();
  });
  const [hovered, setHovered] = createSignal<number | null>(null);
  return (
    <div ref={comb} class="agent-honeycomb">
      <For each={props.rows}>
        {(row) => (
          <div class="agent-honeycomb-row">
            <For each={row}>
              {(cell) => (
                <span
                  class="agent-honeycomb-cell"
                  data-kind={cell.tile.kind}
                  onPointerEnter={() => setHovered(cell.index)}
                  onPointerLeave={() => setHovered((index) => (index === cell.index ? null : index))}
                >
                  {cell.tile.kind === "art" ? (
                    <img src={cell.tile.src} alt="" loading="lazy" decoding="async" draggable={false} />
                  ) : (
                    <Show when={near()}>
                      <AgentAvatar
                        seed={cell.tile.seed}
                        hue={null}
                        shape="squircle"
                        motion="always"
                        cycleOffset={(cell.index * 3) % 5}
                        followPointer={hovered() === cell.index}
                        class="agent-honeycomb-avatar"
                      />
                    </Show>
                  )}
                </span>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
