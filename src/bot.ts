/**
 * OpenClaw Web Chat 消息处理逻辑 - OpenClaw Core 路由接入版
 */

import type {
  ClawdbotConfig,
  RuntimeEnv,
  HistoryEntry,
  InboundMessage,
  Envelope,
} from "openclaw/plugin-sdk";
import type { OpenClaw Web ChatMessageEvent } from "./types.js";
import { sendMessageOpenClaw Web Chat } from "./send.js";

export interface HandleOpenClaw Web ChatMessageOpts {
  cfg: ClawdbotConfig;
  event: OpenClaw Web ChatMessageEvent;
  runtime?: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
  accountId: string;
  // OpenClaw Core 路由回调
  onMessage?: (envelope: Envelope) => Promise<void> | void;
}

/**
 * 处理收到的消息
 * 
 * 关键流程：
 * 1. 接收 Web 聊天室消息
 * 2. 转换为 OpenClaw Envelope 格式
 * 3. 调用 onMessage 回调接入 OpenClaw Core 路由
 * 4. 等待 OpenClaw 处理并返回回复
 * 5. 将回复发送回 Web 聊天室
 */
export async function handleOpenClaw Web ChatMessage(
  opts: HandleOpenClaw Web ChatMessageOpts
): Promise<void> {
  const { cfg, event, runtime, chatHistories, accountId, onMessage } = opts;
  const log = runtime?.log ?? console.log;

  log(`[OpenClaw Web Chat ${accountId}] Received message from ${event.senderName}: ${event.content.slice(0, 50)}...`);

  // 标准化消息格式为 OpenClaw Envelope
  const envelope = createOpenClaw Web ChatEnvelope(event, accountId);

  // 保存到历史记录
  const historyKey = `${accountId}:${envelope.chat_id}`;
  const history = chatHistories.get(historyKey) || [];
  history.push({
    role: "user",
    content: event.content,
    timestamp: event.timestamp,
  });
  chatHistories.set(historyKey, history);

  // 接入 OpenClaw Core 路由
  if (onMessage) {
    try {
      await onMessage(envelope);
    } catch (err) {
      log(`[OpenClaw Web Chat ${accountId}] Error routing message: ${err}`);
      
      // 发送错误提示给用户
      await sendReply(cfg, accountId, event, "抱歉，处理消息时出错了，请稍后重试。");
    }
  } else {
    log(`[OpenClaw Web Chat ${accountId}] Warning: No onMessage handler registered`);
  }
}

/**
 * 创建 OpenClaw Envelope
 */
function createOpenClaw Web ChatEnvelope(
  event: OpenClaw Web ChatMessageEvent,
  accountId: string
): Envelope {
  const chatId = event.isDirect
    ? `user:${event.senderId}`
    : `chat:${event.chatId}`;

  return {
    // 消息元数据
    message_id: event.messageId,
    channel: "web-chat",
    chat_id: chatId,
    
    // 作者信息
    author_id: event.senderId,
    author_name: event.senderName,
    
    // 消息内容
    text: event.content,
    timestamp: event.timestamp,
    
    // 回复关系
    reply_to: event.replyTo,
    
    // 账号信息（用于路由到正确的配置）
    account_id: accountId,
    
    // 其他元数据
    metadata: {
      messageType: event.messageType,
      chatType: event.isDirect ? "direct" : "group",
    },
  };
}

/**
 * 发送回复到 Web 聊天室
 * 
 * 这是 OpenClaw Core 处理完消息后调用的回调
 */
export async function sendOpenClaw Web ChatReply(
  cfg: ClawdbotConfig,
  accountId: string,
  originalEvent: OpenClaw Web ChatMessageEvent,
  replyText: string
): Promise<void> {
  const chatId = originalEvent.isDirect
    ? originalEvent.senderId
    : originalEvent.chatId;

  const target = originalEvent.isDirect
    ? `user:${originalEvent.senderId}`
    : `chat:${originalEvent.chatId}`;

  await sendMessageOpenClaw Web Chat({
    cfg,
    accountId,
    to: target,
    text: replyText,
    replyTo: originalEvent.messageId, // 引用原消息
  });
}

/**
 * 简化的回复发送函数
 */
async function sendReply(
  cfg: ClawdbotConfig,
  accountId: string,
  originalEvent: OpenClaw Web ChatMessageEvent,
  text: string
): Promise<void> {
  const target = originalEvent.isDirect
    ? `user:${originalEvent.senderId}`
    : `chat:${originalEvent.chatId}`;

  await sendMessageOpenClaw Web Chat({
    cfg,
    accountId,
    to: target,
    text,
    replyTo: originalEvent.messageId,
  });
}

/**
 * 构建回复消息格式
 */
export function buildOpenClaw Web ChatReply(
  text: string,
  replyTo?: string
): {
  content: string;
  messageType: "text";
  replyTo?: string;
} {
  return {
    content: text,
    messageType: "text",
    replyTo,
  };
}

/**
 * 创建 OpenClaw InboundMessage 格式
 * 
 * 用于更高级的集成场景
 */
export function createInboundMessage(
  event: OpenClaw Web ChatMessageEvent,
  accountId: string
): InboundMessage {
  return {
    id: event.messageId,
    channel: "web-chat",
    chat: {
      id: event.isDirect ? event.senderId : event.chatId,
      type: event.isDirect ? "direct" : "group",
      name: event.isDirect ? event.senderName : undefined,
    },
    author: {
      id: event.senderId,
      name: event.senderName,
    },
    content: {
      type: "text",
      text: event.content,
    },
    timestamp: event.timestamp,
    replyTo: event.replyTo,
    accountId,
  };
}
