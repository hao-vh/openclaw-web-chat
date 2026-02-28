/**
 * Ruyuan-IM 协议适配器
 * 
 * 将 OpenClaw Web Chat 协议与 Ruyuan-IM 协议相互转换
 */

import type {
  OpenClaw Web ChatMessageEvent,
  OpenClaw Web ChatSendMessageRequest,
  RuyuanJsonCommand,
  RuyuanMessageSendRequest,
  RuyuanMessagePush,
  RuyuanMessageAckRequest,
  RuyuanCommandType,
  RuyuanChatType,
  RuyuanMessageType,
  RuyuanConnectionState,
} from "./types.js";

// ==================== 协议转换函数 ====================

/**
 * 将 Ruyuan-IM 消息推送转换为 OpenClaw Web Chat 消息事件
 * 
 * Ruyuan-IM (type: 6) -> OpenClaw Web ChatMessageEvent
 */
export function convertFromRuyuanPush(
  ruyuanMsg: RuyuanJsonCommand,
  senderNameResolver?: (userId: number) => string
): OpenClaw Web ChatMessageEvent {
  const body = ruyuanMsg.body as RuyuanMessagePush;
  
  // 解析发送者名称（如果提供了解析器）
  const senderName = senderNameResolver 
    ? senderNameResolver(body.fromId)
    : `User_${body.fromId}`;

  return {
    messageId: String(body.messageId),
    chatId: String(body.chatId),
    senderId: String(body.fromId),
    senderName,
    content: body.content,
    messageType: body.messageType === 1 ? "text" : "unknown",
    // Ruyuan-IM 使用秒级时间戳，转换为毫秒
    timestamp: body.timestamp * 1000,
    isDirect: body.chatType === 1, // 1=C2C(单聊), 2=C2G(群聊)
    replyTo: undefined, // Ruyuan-IM 暂时不支持回复
  };
}

/**
 * 将 OpenClaw Web Chat 发送请求转换为 Ruyuan-IM 发送消息格式
 * 
 * OpenClaw Web ChatSendMessageRequest -> Ruyuan-IM (type: 5)
 */
export function convertToRuyuanSend(
  web-chatMsg: OpenClaw Web ChatSendMessageRequest,
  userId: number,
  clientType: number,
  sequence: number
): RuyuanJsonCommand {
  const chatId = parseInt(web-chatMsg.chatId, 10);
  const isDirect = !web-chatMsg.chatId.startsWith("group:");
  
  const body: RuyuanMessageSendRequest = {
    messageId: generateMessageId(),
    chatType: isDirect ? 1 : 2, // 1=C2C, 2=C2G
    fromId: userId,
    toId: chatId,
    chatId: chatId,
    messageType: web-chatMsg.messageType === "text" ? 1 : 1, // 暂时只支持文本
    content: web-chatMsg.content,
    sequence,
    timestamp: Math.floor(Date.now() / 1000), // 秒级时间戳
  };

  return {
    userId,
    client: clientType,
    type: 5, // COMMAND_MESSAGE_SEND
    body,
  };
}

/**
 * 创建 Ruyuan-IM 上线请求
 * 
 * type: 3 (ONLINE)
 */
export function createRuyuanOnlineCommand(
  userId: number,
  clientType: number,
  token: string
): RuyuanJsonCommand {
  return {
    userId,
    client: clientType,
    type: 3, // COMMAND_ONLINE
    body: { token },
  };
}

/**
 * 创建 Ruyuan-IM 心跳请求
 * 
 * type: 2 (HEARTBEAT)
 */
export function createRuyuanHeartbeatCommand(
  userId: number,
  clientType: number
): RuyuanJsonCommand {
  return {
    userId,
    client: clientType,
    type: 2, // COMMAND_HEARTBEAT
    body: {},
  };
}

/**
 * 创建 Ruyuan-IM 消息确认请求
 * 
 * type: 7 (MESSAGE_ACK)
 */
export function createRuyuanAckCommand(
  userId: number,
  clientType: number,
  messageId: number,
  chatId: number,
  chatType: RuyuanChatType = 1
): RuyuanJsonCommand {
  const body: RuyuanMessageAckRequest = {
    chatType,
    clientId: clientType,
    chatId,
    memberId: userId,
    messageId,
  };

  return {
    userId,
    client: clientType,
    type: 7, // COMMAND_MESSAGE_ACK
    body,
  };
}

/**
 * 创建 Ruyuan-IM 获取离线消息请求
 * 
 * type: 8 (MESSAGE_FETCH)
 */
export function createRuyuanFetchOfflineCommand(
  userId: number,
  clientType: number,
  chatId: number,
  lastMessageId: number = 0,
  chatType: RuyuanChatType = 1
): RuyuanJsonCommand {
  const body: RuyuanFetchOfflineRequest = {
    chatType,
    memberId: userId,
    chatId,
    clientId: clientType,
    lastMessageId,
  };

  return {
    userId,
    client: clientType,
    type: 8, // COMMAND_MESSAGE_FETCH
    body,
  };
}

// ==================== 工具函数 ====================

/**
 * 生成消息ID
 * Ruyuan-IM 使用数字类型的 messageId
 */
function generateMessageId(): number {
  // 使用当前时间戳作为消息ID
  return Date.now();
}

/**
 * 获取下一个序列号
 */
export function getNextSequence(state: RuyuanConnectionState): number {
  state.sequenceCounter += 1;
  return state.sequenceCounter;
}

/**
 * 初始化 Ruyuan-IM 连接状态
 */
export function initRuyuanConnectionState(
  userId?: number,
  clientType?: number,
  token?: string
): RuyuanConnectionState {
  return {
    isOnline: false,
    userId,
    clientType,
    token,
    sequenceCounter: 0,
  };
}

/**
 * 判断消息是否为 Ruyuan-IM 格式
 * 
 * 特征：包含 userId, client, type, body 字段
 */
export function isRuyuanMessage(data: any): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof data.userId === "number" &&
    typeof data.client === "number" &&
    typeof data.type === "number" &&
    typeof data.body === "object"
  );
}

/**
 * 判断消息是否为 OpenClaw Web Chat 格式
 * 
 * 特征：包含 messageId, chatId, senderId, content 字段
 */
export function isOpenClaw Web ChatMessage(data: any): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (typeof data.messageId === "string" || typeof data.messageId === "number") &&
    typeof data.chatId === "string" &&
    typeof data.content === "string"
  );
}

// ==================== 命令类型名称映射 ====================

const COMMAND_TYPE_NAMES: Record<number, string> = {
  0: "ERROR",
  1: "REGISTER",
  2: "HEARTBEAT",
  3: "ONLINE",
  4: "OFFLINE",
  5: "MESSAGE_SEND",
  6: "MESSAGE_PUSH",
  7: "MESSAGE_ACK",
  8: "MESSAGE_FETCH",
};

/**
 * 获取命令类型名称
 */
export function getCommandTypeName(type: number): string {
  return COMMAND_TYPE_NAMES[type] || `UNKNOWN(${type})`;
}

// ==================== 聊天类型名称映射 ====================

const CHAT_TYPE_NAMES: Record<number, string> = {
  1: "C2C(单聊)",
  2: "C2G(群聊)",
};

/**
 * 获取聊天类型名称
 */
export function getChatTypeName(type: number): string {
  return CHAT_TYPE_NAMES[type] || `UNKNOWN(${type})`;
}
