import { SheetPageStack } from "@/shared/components/sheet-page-stack";

export const unstable_settings = { initialRouteName: "index" };

/** The page sets its own title, the listing's name, when the listing loads. */
export default function MarketplaceListingLayout() {
  return <SheetPageStack />;
}
