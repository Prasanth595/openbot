import { SheetPageStack } from "@/shared/components/sheet-page-stack";
import { useText } from "@/shared/lib/text";

export default function MarketInstallLayout() {
  const { t } = useText();
  return <SheetPageStack title={t("mobile.market.review")} />;
}
