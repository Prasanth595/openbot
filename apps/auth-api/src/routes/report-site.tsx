import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { ReportSitePage } from "../components/report-site/ReportSitePage";

// Reached from any hosted site with that site's name in the query, so it is kept out of search.
export const Route = createFileRoute("/report-site")({
  head: () => ({
    meta: [{ title: "Report a hosted site — OpenBot" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  validateSearch: (value) => ({
    hostname: isDynamicRecord(value) && isString(value.hostname) ? value.hostname : "",
  }),
  component: ReportSite,
});

function ReportSite() {
  const search = Route.useSearch();
  return <ReportSitePage hostname={search().hostname} />;
}
