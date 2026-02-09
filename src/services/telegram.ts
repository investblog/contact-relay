const TELEGRAM_API = "https://api.telegram.org";
const MAX_RETRIES = 3;

interface TelegramResponse {
  ok: boolean;
  description?: string;
  parameters?: {
    migrate_to_chat_id?: number;
  };
}

export interface SendResult {
  success: boolean;
  error?: string;
  /** Set when the group was migrated to a supergroup */
  migrated_chat_id?: string;
}

/**
 * Send message to Telegram chat with retry logic.
 * Automatically handles supergroup migration.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<SendResult> {
  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;

  let lastError = "";
  let currentChatId = chatId;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: currentChatId,
          text: text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      const result: TelegramResponse = await response.json();

      if (result.ok) {
        return currentChatId !== chatId
          ? { success: true, migrated_chat_id: currentChatId }
          : { success: true };
      }

      // Handle supergroup migration — retry immediately with new chat ID
      const newChatId = result.parameters?.migrate_to_chat_id;
      if (newChatId) {
        currentChatId = String(newChatId);
        continue; // retry with new ID, don't count as a failed attempt
      }

      lastError = result.description || `HTTP ${response.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }

    // Exponential backoff: 400ms, 800ms, 1200ms
    if (attempt < MAX_RETRIES - 1) {
      await sleep(400 * (attempt + 1));
    }
  }

  return { success: false, error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
