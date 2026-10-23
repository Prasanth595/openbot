import type { TextStyle } from "react-native";

/**
 * The type roles of the mobile layout that HeroUI `Typography` has no variant for. `Typography`
 * keeps the family, weight and color; spread a role into its `style`. A theme size class such as
 * `text-label` reads to tailwind-merge as a color, so next to `text-muted` one of the two is lost.
 */
export const typeScale = {
  workComposer: { fontFamily: "Inter", fontSize: 18, lineHeight: 24, fontWeight: "500" },
  workTitle: { fontFamily: "Inter", fontSize: 15, lineHeight: 20, fontWeight: "500" },
  workStatus: { fontFamily: "Inter", fontSize: 10, lineHeight: 14, letterSpacing: 0.72, fontWeight: "600" },
  teamDisplay: { fontFamily: "Inter", fontSize: 44, lineHeight: 53, letterSpacing: -2.2, fontWeight: "500" },
  teamLead: { fontFamily: "Inter", fontSize: 40, lineHeight: 48, letterSpacing: -2, fontWeight: "500" },
  teamSection: { fontFamily: "Inter", fontSize: 28, lineHeight: 34, letterSpacing: -1.4, fontWeight: "500" },
  teamMeta: { fontFamily: "Inter", fontSize: 12, lineHeight: 15, letterSpacing: 0.72, fontWeight: "600" },
  teamName: { fontFamily: "Inter", fontSize: 17, lineHeight: 21, fontWeight: "600" },
  teamPreview: { fontFamily: "Inter", fontSize: 15, lineHeight: 20 },
  chatAuthor: { fontFamily: "Inter", fontSize: 14, lineHeight: 18, fontWeight: "600" },
  chatEvent: {
    fontFamily: "Inter",
    fontSize: 13,
    lineHeight: 18,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  chatEventTime: {
    fontFamily: "Inter",
    fontSize: 11,
    lineHeight: 18,
    letterSpacing: 0.4,
    fontWeight: "600",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  marketMeta: { fontFamily: "Inter", fontSize: 10, lineHeight: 14, letterSpacing: 0.72, fontWeight: "600" },
  marketDescription: { fontFamily: "Inter", fontSize: 14, lineHeight: 20 },
  marketLabel: { fontFamily: "Inter", fontSize: 14, lineHeight: 18, fontWeight: "600" },
  chatDay: { fontFamily: "Inter", fontSize: 10, lineHeight: 14, letterSpacing: 0.6, fontWeight: "600" },
  chatQuestion: { fontFamily: "Inter", fontSize: 13, lineHeight: 19 },
  chatAnswer: { fontFamily: "Inter", fontSize: 14, lineHeight: 20, fontWeight: "500" },
  /** The big header of a full screen: the server name on home, Routines, Usage. */
  largeTitle: { fontSize: 34, lineHeight: 40, letterSpacing: -0.68 },
  /** The big header on Android: the Material 3 headline of a medium top app bar. */
  largeTitleAndroid: { fontSize: 28, lineHeight: 36 },
  /** The heading of the task editor above the search field. */
  taskHeading: { fontSize: 22, lineHeight: 28, letterSpacing: -0.22 },
  /** The server name at the top of the drawer. */
  drawerTitle: { fontSize: 26, lineHeight: 32, letterSpacing: -0.52 },
  /** The small title that the big header leaves in the bar. */
  barTitle: { fontSize: 17, lineHeight: 22 },
  /** The small title on Android: the Material 3 title of a small top app bar. */
  barTitleAndroid: { fontSize: 22, lineHeight: 28 },
  /** A row name: a chat, a server, a drawer row. */
  rowTitle: { fontSize: 16, lineHeight: 21 },
  /** A task or search row name, a little smaller than a chat name. */
  body: { fontSize: 15.5, lineHeight: 20 },
  /** One line under a row name, such as a chat preview, and a drawer row value. */
  preview: { fontSize: 14, lineHeight: 19 },
  /** Section headings, times and supporting lines. */
  caption: { fontSize: 13, lineHeight: 18 },
  /** Labels under avatars and small supporting lines. */
  small: { fontSize: 12.5, lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;
