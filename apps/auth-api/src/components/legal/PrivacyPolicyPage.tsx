import { onSettled } from "solid-js";
import { PrivacyPolicy } from "../../content/privacy-policy";
import { landingAnalytics } from "../../lib/analytics";
import { formatArticleDate } from "../../lib/content-collection";
import { PRIVACY_POLICY_META, PRIVACY_POLICY_ROUTE, PRIVACY_POLICY_UPDATED_AT } from "../../lib/privacy-policy";
import { LandingFooter } from "../landing/LandingFooter";
import { SiteHeader } from "../landing/SiteHeader";

// The article layout without the artwork, reading progress and related links: a legal text is read, not browsed.
export function PrivacyPolicyPage() {
  onSettled(() => landingAnalytics.start(document, window.location.hostname, PRIVACY_POLICY_ROUTE));

  return (
    <div class="landing-page post-article">
      <SiteHeader page="content" />

      <main class="post-main">
        <article class="post-container post-article-body">
          <header class="post-article-header" data-enter="post-copy">
            <h1 class="post-article-title">{PRIVACY_POLICY_META.title}</h1>
            <p class="post-meta post-article-byline">
              Last updated{" "}
              <time datetime={PRIVACY_POLICY_UPDATED_AT}>{formatArticleDate(PRIVACY_POLICY_UPDATED_AT)}</time>
            </p>
          </header>

          <div class="post-prose" data-enter="post-prose">
            <PrivacyPolicy />
          </div>
        </article>
      </main>

      <LandingFooter />
    </div>
  );
}
