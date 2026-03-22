// Centralized color palette for the llm-party TUI.
// Change a color here, it changes everywhere.

export const COLORS = {
  // Accent colors
  primary: "#00BFFF",       // info, headers, focused fields
  success: "#00FF88",       // active state, selections, confirm keys
  human: "#00FF00",         // user/human name highlight
  agent: "#FF00FF",         // agent/AI identity, magenta accent
  error: "#FF4444",         // errors, cancel keys
  warning: "#FF8800",       // warnings, secondary alerts

  // Text hierarchy
  textPrimary: "#FFFFFF",
  textSecondary: "#AAAAAA",
  textMuted: "#888888",
  textDim: "#666666",
  textSubtle: "#555555",
  textFaint: "#444444",

  // Borders and dividers
  borderActive: "#00FF00",
  borderDim: "#555555",
  borderStrong: "#333333",

  // Backgrounds
  bgPanel: "#0d0d1a",
  bgContent: "#111122",
  bgFocus: "#1a1a2e",
  bgActiveTab: "#1a2a1a",
  bgError: "#1a0000",
  bgSweepDim: "#1a1a1a",
  bgSweepLow: "#333333",
} as const;

// Party colors used for disco animations and sweep bars
export const PARTY_COLORS = [COLORS.agent, COLORS.success, COLORS.primary, "#FFE000"];
