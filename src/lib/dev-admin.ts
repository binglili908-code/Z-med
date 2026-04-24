export const DEV_PANEL_EMAIL = "binglili908@gmail.com";

export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
}

export function isDevPanelEmail(email?: string | null) {
  return normalizeEmail(email) === DEV_PANEL_EMAIL;
}
