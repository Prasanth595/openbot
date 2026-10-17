import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { userInitials } from "@openbot/ui";
import type { ProfileDay, ProfileStats } from "@openbot/ui/features/settings/profile-stats";
import { usageCompact } from "@openbot/ui/features/usage/usage-format";
import { currentText } from "@openbot/ui/text";
import { drawLogo, ellipsize, FONT } from "../agent-templates/agent-template-card";

/*
 * The image of the Share dialog: the account, the last 26 weeks of activity and four numbers, on
 * the light surface of the site's cards. It is drawn here because a picture copies and saves as a
 * file; nothing leaves the computer unless the user sends the file.
 */

const WIDTH = 1200;
const HEIGHT = 690;
const PAD = 56;
const WEEKS = 26;
const AVATAR = 88;
const GRID = { top: 222, gap: 6 };
const TILES = { top: 548, height: 96, gap: 16, radius: 20 };

interface ShareColors {
  surface: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentSoft: string;
  logo: string;
  logoEye: string;
}

export async function renderProfileShareImage(
  account: Pick<CentralAuthUser, "name" | "email" | "avatarUrl">,
  stats: ProfileStats,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The activity image cannot be drawn.");
  await Promise.all([document.fonts.load(`600 40px ${FONT}`), document.fonts.load(`500 22px ${FONT}`)]);

  const colors = shareColors();
  context.fillStyle = colors.surface;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.textBaseline = "alphabetic";
  await drawHeader(context, account, colors);
  drawWeeks(context, stats.days, colors);
  drawTiles(context, stats, colors);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The activity image cannot be encoded.");
  return blob;
}

/** The app's tokens, read from the document so the image follows the brand if it changes. */
function shareColors(): ShareColors {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => {
    const value = style.getPropertyValue(name).trim();
    if (!value) throw new Error(`The activity image needs the ${name} token.`);
    return value;
  };
  return {
    surface: token("--openbot-surface-light"),
    text: token("--openbot-text-on-light"),
    muted: token("--openbot-text-muted-on-light"),
    border: token("--openbot-border-on-light"),
    accent: token("--openbot-accent"),
    accentSoft: token("--openbot-accent-soft"),
    logo: token("--openbot-logo-production"),
    logoEye: token("--openbot-logo-production-eye"),
  };
}

async function drawHeader(
  context: CanvasRenderingContext2D,
  account: Pick<CentralAuthUser, "name" | "email" | "avatarUrl">,
  colors: ShareColors,
): Promise<void> {
  const { t } = currentText();
  const cx = PAD + AVATAR / 2;
  const cy = PAD + AVATAR / 2;
  context.save();
  context.beginPath();
  context.arc(cx, cy, AVATAR / 2, 0, Math.PI * 2);
  context.clip();
  const photo = account.avatarUrl ? await loadPhoto(account.avatarUrl) : null;
  if (photo) {
    const scale = Math.max(AVATAR / photo.naturalWidth, AVATAR / photo.naturalHeight);
    const width = photo.naturalWidth * scale;
    const height = photo.naturalHeight * scale;
    context.drawImage(photo, cx - width / 2, cy - height / 2, width, height);
  } else {
    context.fillStyle = colors.accentSoft;
    context.fillRect(PAD, PAD, AVATAR, AVATAR);
    context.fillStyle = colors.accent;
    context.font = `600 32px ${FONT}`;
    context.textAlign = "center";
    context.fillText(userInitials(account), cx, cy + 11);
    context.textAlign = "start";
  }
  context.restore();

  const logoSize = 56;
  const textX = PAD + AVATAR + 24;
  const textWidth = WIDTH - PAD - logoSize - 24 - textX;
  const name = account.name?.trim() || account.email.split("@")[0] || account.email;
  context.fillStyle = colors.text;
  context.font = `600 40px ${FONT}`;
  const nameLine = context.measureText(name).width > textWidth ? ellipsize(context, name, textWidth) : name;
  context.fillText(nameLine, textX, PAD + 42);
  context.fillStyle = colors.muted;
  context.font = `500 24px ${FONT}`;
  context.fillText(t("settings.profile.share.caption"), textX, PAD + 78);
  await drawLogo(context, WIDTH - PAD - logoSize, PAD + (AVATAR - logoSize) / 2, logoSize, colors);
}

/**
 * The account photo comes from the account server. A photo the server sends without permission
 * for other pages would mark the canvas unreadable, so such a photo gives its place to initials.
 */
async function loadPhoto(url: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

/** The last `WEEKS` columns of the year, Sunday at the top, with the month above its first week. */
function drawWeeks(context: CanvasRenderingContext2D, days: ProfileDay[], colors: ShareColors): void {
  const { format } = currentText();
  const last = days.at(-1);
  const visible = days.slice(-(WEEKS * 7 - (6 - (last?.weekday ?? 6))));
  const slots: Array<ProfileDay | null> = [...Array.from({ length: visible[0]?.weekday ?? 0 }, () => null), ...visible];
  const step = (WIDTH - PAD * 2 + GRID.gap) / WEEKS;
  const cell = step - GRID.gap;
  const max = Math.max(0, ...visible.map((day) => day.tokens));

  context.font = `500 20px ${FONT}`;
  context.fillStyle = colors.muted;
  let previousMonth = "";
  for (let column = 0; column < WEEKS; column += 1) {
    const first = slots.slice(column * 7, column * 7 + 7).find((day) => day !== null);
    if (!first) continue;
    const month = first.date.slice(0, 7);
    if (month === previousMonth) continue;
    previousMonth = month;
    if (column === 0 && Number(first.date.slice(8)) > 7) continue;
    const label = format.date(Date.parse(`${first.date}T00:00:00Z`), { month: "short", timeZone: "UTC" });
    context.fillText(label, PAD + column * step, GRID.top - 14);
  }

  slots.forEach((day, index) => {
    if (!day) return;
    const x = PAD + Math.floor(index / 7) * step;
    const y = GRID.top + (index % 7) * step;
    const ratio = max > 0 ? day.tokens / max : 0;
    context.beginPath();
    context.roundRect(x, y, cell, cell, 6);
    if (ratio <= 0 && day.messages === 0) {
      context.fillStyle = colors.text;
      context.globalAlpha = 0.07;
    } else {
      context.fillStyle = colors.accent;
      context.globalAlpha = ratio <= 0.15 ? 0.32 : ratio <= 0.35 ? 0.55 : ratio <= 0.6 ? 0.78 : 1;
    }
    context.fill();
    context.globalAlpha = 1;
  });
}

function drawTiles(context: CanvasRenderingContext2D, stats: ProfileStats, colors: ShareColors): void {
  const { t, format } = currentText();
  const longDate = (date: string) =>
    format.date(Date.parse(`${date}T00:00:00Z`), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const tiles = [
    { label: t("settings.profile.tile.tokens"), value: usageCompact(stats.tokens) },
    {
      label: stats.peak
        ? `${t("settings.profile.tile.peakDay")} · ${longDate(stats.peak.date)}`
        : t("settings.profile.tile.peakDay"),
      value: stats.peak ? usageCompact(stats.peak.tokens) : "–",
    },
    { label: t("settings.profile.tile.messages"), value: usageCompact(stats.messages) },
    {
      label: t("settings.profile.tile.currentStreak"),
      value: t("settings.profile.tile.days", { count: stats.currentStreak }),
    },
  ];
  const width = (WIDTH - PAD * 2 - TILES.gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((tile, index) => {
    const x = PAD + index * (width + TILES.gap);
    context.beginPath();
    context.roundRect(x + 1, TILES.top + 1, width - 2, TILES.height - 2, TILES.radius);
    context.strokeStyle = colors.border;
    context.lineWidth = 2;
    context.stroke();
    context.font = `500 19px ${FONT}`;
    context.fillStyle = colors.muted;
    const label =
      context.measureText(tile.label).width > width - 40 ? ellipsize(context, tile.label, width - 40) : tile.label;
    context.fillText(label, x + 20, TILES.top + 34);
    context.font = `600 34px ${FONT}`;
    context.fillStyle = colors.text;
    context.fillText(tile.value, x + 20, TILES.top + 76);
  });
}
