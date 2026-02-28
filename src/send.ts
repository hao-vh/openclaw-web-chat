/**
 * XiaoWu 消息发送（连接复用版）
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { resolveXiaoWuAccount } from "./accounts.js";
import { sendWithSharedConnection, createXiaoWuHTTPClient } from "./client.js";
import type { XiaoWuSendMessageRequest } from "./types.js";

export interface SendMessageXiaoWuOpts {
  cfg: ClawdbotConfig;
  accountId?: string;
  to: string;           // chat:xxx 或 user:xxx
  text: string;
  replyTo?: string;     // 回复的消息ID
  threadId?: string;    // 话题ID（可选）
}

/**
 * 发送消息到 XiaoWu
 * 
 * 关键改进：
 * - WebSocket 模式下复用 monitor 的连接，不再每次都新建
 * - 如果连接未就绪，消息会自动排队等待
 */
export async function sendMessageXiaoWu(
  opts: SendMessageXiaoWuOpts
): Promise<{ messageId?: string; error?: string }> {
  const { cfg, accountId, to, text, replyTo } = opts;

  const account = resolveXiaoWuAccount({ cfg, accountId });
  if (!account.enabled || !account.configured) {
    return { error: `XiaoWu account "${accountId || "default"}" not available` };
  }

  // 解析目标
  const chatId = to.replace(/^(chat|user):/, "");

  const message: XiaoWuSendMessageRequest = {
    chatId,
    content: text,
    messageType: "text",
    replyTo,
  };

  try {
    let result;

    if (account.connectionMode === "websocket") {
      // WebSocket 模式：使用共享连接
      // 这会复用 monitor 建立的连接
      result = await sendWithSharedConnection(
        account.accountId,
        account.config,
        message
      );
    } else {
      // HTTP 模式：每次新建请求（HTTP 是无状态的）
      const client = createXiaoWuHTTPClient(account.config);
      result = await client.send(message);
      client.close();
    }

    if (!result.success) {
      return { error: result.error };
    }

    return { messageId: result.messageId };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 批量发送消息
 * 
 * 使用共享连接可以大大提高批量发送的效率
 */
export async function sendMessageBatchXiaoWu(
  opts: {
    cfg: ClawdbotConfig;
    accountId?: string;
    messages: Array<{
      to: string;
      text: string;
      replyTo?: string;
    }>;
  }
): Promise<Array<{ to: string; success: boolean; messageId?: string; error?: string }>> {
  const { cfg, accountId, messages } = opts;

  const account = resolveXiaoWuAccount({ cfg, accountId });
  if (!account.enabled || !account.configured) {
    return messages.map((msg) => ({
      to: msg.to,
      success: false,
      error: `XiaoWu account "${accountId || "default"}" not available`,
    }));
  }

  // 批量发送可以复用同一个连接
  const results = await Promise.all(
    messages.map(async (msg) => {
      const result = await sendMessageXiaoWu({
        cfg,
        accountId,
        to: msg.to,
        text: msg.text,
        replyTo: msg.replyTo,
      });

      return {
        to: msg.to,
        success: !result.error,
        messageId: result.messageId,
        error: result.error,
      };
    })
  );

  return results;
}
