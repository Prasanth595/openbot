import type { JSX } from "@solidjs/web";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";

export interface TransactionalPageProps {
  /** The `id` of the card's heading. The card uses it as its accessible name. */
  titleId: string;
  /** `message` centres short text and actions. `form` makes the card wider and aligns it to the start. */
  layout?: "message" | "form";
  /** More classes for the card, for example `contact-section` for the form field colours. */
  class?: string;
  children: JSX.Element;
}

/**
 * The frame of a page that does one task: join a server, return from Slack or Discord, return from
 * billing, report a site, or show a load error. It has the site header, one centred card, and the
 * site footer, so that these pages look like the rest of the site.
 */
export function TransactionalPage(props: TransactionalPageProps) {
  return (
    <div class="landing-page transactional-page">
      <SiteHeader page="content" />
      <main class="transactional-main">
        <section
          class={props.class ? `join-card transactional-card ${props.class}` : "join-card transactional-card"}
          data-layout={props.layout ?? "message"}
          aria-labelledby={props.titleId}
        >
          {props.children}
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
