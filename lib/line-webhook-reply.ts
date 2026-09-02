import { replyMessages, type LineMessage } from "@/lib/line";

export async function safeReply(replyToken: string, text: string, lineAccessToken?: string): Promise<void> {
  const message: LineMessage = { type: "text", text };
  try {
    await replyMessages(replyToken, [message], lineAccessToken);
  } catch {
    // LINE 回覆失敗不影響 webhook 回傳 200，避免平台重送已處理事件。
  }
}
