/**
 * XiaoWu Channel 类型定义
 * 
 * 扩展：添加 Ruyuan-IM 协议支持
 */

export type XiaoWuDomain = "local" | "custom";

export interface XiaoWuConfig {
  enabled?: boolean;
  /** WebSocket 连接地址 */
  wsUrl?: string;
  /** HTTP API 基础地址 */
  apiUrl?: string;
  /** 认证 Token */
  apiToken?: string;
  /** 连接模式: websocket | http */
  connectionMode?: "websocket" | "http";
  /** HTTP 轮询间隔 (毫秒) */
  pollInterval?: number;
  /** 是否自动重连 */
  autoReconnect?: boolean;
  /** 消息历史限制 */
  historyLimit?: number;
  /** 
   * 协议适配器类型
   * - "xiaowu": 原生 XiaoWu 协议
   * - "ruyuan": Ruyuan-IM 协议适配
   */
  adapter?: "xiaowu" | "ruyuan";
  /** 
   * Ruyuan-IM 专用配置
   */
  ruyuan?: {
    /** 用户ID (Ruyuan-IM 使用数字ID) */
    userId: number;
    /** 客户端类型: 1=Web, 2=iOS, 3=Android */
    clientType?: number;
    /** Token (用于上线认证) */
    token?: string;
    /** 心跳间隔(毫秒)，默认 30000 */
    heartbeatInterval?: number;
  };
}

export interface ResolvedXiaoWuAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  config: XiaoWuConfig;
  wsUrl: string;
  apiUrl: string;
  apiToken?: string;
  connectionMode: "websocket" | "http";
  pollInterval: number;
  autoReconnect: boolean;
  /** 使用的协议适配器 */
  adapter: "xiaowu" | "ruyuan";
  /** Ruyuan-IM 配置 */
  ruyuan?: XiaoWuConfig["ruyuan"];
}

/** XiaoWu 消息事件 */
export interface XiaoWuMessageEvent {
  /** 消息唯一ID */
  messageId: string;
  /** 聊天室/频道ID */
  chatId: string;
  /** 发送者ID */
  senderId: string;
  /** 发送者昵称 */
  senderName: string;
  /** 消息内容 */
  content: string;
  /** 消息类型: text | image | file */
  messageType: "text" | "image" | "file";
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 是否是私信 */
  isDirect?: boolean;
  /** 回复的消息ID */
  replyTo?: string;
}

/** XiaoWu 用户上线事件 */
export interface XiaoWuUserOnlineEvent {
  userId: string;
  userName: string;
  chatId: string;
  timestamp: number;
}

/** XiaoWu 用户下线事件 */
export interface XiaoWuUserOfflineEvent {
  userId: string;
  chatId: string;
  timestamp: number;
}

/** 发送消息请求 */
export interface XiaoWuSendMessageRequest {
  chatId: string;
  content: string;
  messageType?: "text" | "image" | "file";
  replyTo?: string;
}

/** 发送消息响应 */
export interface XiaoWuSendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ==================== Ruyuan-IM 协议类型定义 ====================

/** Ruyuan-IM 命令类型 */
export enum RuyuanCommandType {
  ERROR = 0,
  REGISTER = 1,
  HEARTBEAT = 2,
  ONLINE = 3,
  OFFLINE = 4,
  MESSAGE_SEND = 5,
  MESSAGE_PUSH = 6,
  MESSAGE_ACK = 7,
  MESSAGE_FETCH = 8,
}

/** Ruyuan-IM 聊天类型 */
export enum RuyuanChatType {
  C2C = 1,  // 单聊
  C2G = 2,  // 群聊
}

/** Ruyuan-IM 消息类型 */
export enum RuyuanMessageType {
  TEXT = 1,  // 文本消息
}

/** Ruyuan-IM JSON 命令格式 */
export interface RuyuanJsonCommand {
  userId: number;
  client: number;
  type: RuyuanCommandType;
  body: any;
}

/** Ruyuan-IM 上线请求体 */
export interface RuyuanOnlineRequest {
  token: string;
}

/** Ruyuan-IM 发送消息请求体 */
export interface RuyuanMessageSendRequest {
  messageId: number;
  chatType: RuyuanChatType;
  fromId: number;
  toId: number;
  chatId: number;
  messageType: RuyuanMessageType;
  content: string;
  sequence: number;
  timestamp: number;
}

/** Ruyuan-IM 消息推送体 */
export interface RuyuanMessagePush {
  chatType: RuyuanChatType;
  fromId: number;
  chatId: number;
  messageId: number;
  messageType: RuyuanMessageType;
  content: string;
  sequence: number;
  timestamp: number;
}

/** Ruyuan-IM 消息确认请求体 */
export interface RuyuanMessageAckRequest {
  chatType: RuyuanChatType;
  clientId: number;
  chatId: number;
  memberId: number;
  messageId: number;
}

/** Ruyuan-IM 获取离线消息请求体 */
export interface RuyuanFetchOfflineRequest {
  chatType: RuyuanChatType;
  memberId: number;
  chatId: number;
  clientId: number;
  lastMessageId: number;
}

/** Ruyuan-IM 连接状态 */
export interface RuyuanConnectionState {
  /** 是否已上线 */
  isOnline: boolean;
  /** 用户ID */
  userId?: number;
  /** 客户端类型 */
  clientType?: number;
  /** Token */
  token?: string;
  /** 心跳定时器 */
  heartbeatTimer?: NodeJS.Timeout;
  /** 消息序列号计数器 */
  sequenceCounter: number;
}
