// US-EXT-4 — a deliberately tiny router for the side panel. Chat is the default
// view; Settings and Hotkeys are scaffolded so future config UI can be added
// without re-architecting. No router library — just a typed view union.

export type Route = "chat" | "settings" | "hotkeys";

export const ROUTES: { id: Route; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "settings", label: "Settings" },
  { id: "hotkeys", label: "Hotkeys" },
];

export const DEFAULT_ROUTE: Route = "chat";
