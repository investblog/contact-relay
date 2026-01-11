/**
 * Sanitize and normalize Telegram username from various formats.
 */
export function sanitizeTelegram(username: string): string {
  let u = (username || "").trim();
  u = u
    .replace(/@/g, "")
    .replace(/https?:\/\/t\.me\//gi, "")
    .replace(/\/+$/, "");
  return u;
}

/**
 * Trim string and limit to max length.
 */
export function trimLimit(value: string | undefined, maxLen: number): string {
  return (value || "").trim().slice(0, maxLen);
}

/**
 * Build the HTML message to send to Telegram.
 */
export function buildMessageText(
  name: string,
  email: string,
  telegram: string,
  message: string,
  originHost: string
): string {
  const lines: string[] = [
    "<b>New Contact Request</b>",
    `<b>Origin:</b> ${originHost || "-"}`,
    `<b>Name:</b> ${escapeHtml(name) || "-"}`,
    `<b>Email:</b> ${escapeHtml(email) || "-"}`,
  ];

  if (telegram) {
    lines.push(`<b>Telegram:</b> https://t.me/${escapeHtml(telegram)}`);
  }

  if (message) {
    lines.push("<b>Message:</b>");
    lines.push(escapeHtml(message));
  }

  return lines.join("\n");
}

/**
 * Escape HTML special characters for Telegram HTML parse mode.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
