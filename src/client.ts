/**
 * XiaoWu WebSocket/HTTP 客户端 (连接复用版 + Ruyuan-IM 支持)
 */

import WebSocket from "ws";
import type {
  XiaoWuConfig,
  XiaoWuMessageEvent,
  XiaoWuSendMessageRequest,
  XiaoWuSendMessageResponse,
  RuyuanConnectionState,
  RuyuanJsonCommand,
} from "./types.js";
import {
  convertFromRuyuanPush,
  convertToRuyuanSend,
  createRuyuanOnlineCommand,
  createRuyuanHeartbeatCommand,
  initRuyuanConnectionState,
  getNextSequence,
  isRuyuanMessage,
  getCommandTypeName,
} from "./ruyuan-adapter.js";

/**
 * 连接状态
 */
interface WSConnectionState {
  ws: WebSocket;
  config: XiaoWuConfig;
  isReady: boolean;
  messageQueue: Array<{
    message: XiaoWuSendMessageRequest;
    resolve: (result: XiaoWuSendMessageResponse) => void;
  }>;
  pendingRequests: Map<string, {
    resolve: (result: XiaoWuSendMessageResponse) => void;
    timeout: NodeJS.Timeout;
  }>;
  handlers: Set<(event: XiaoWuMessageEvent) => void>;
  reconnectTimer?: NodeJS.Timeout;
  isClosed: boolean;
  // Ruyuan-IM 专用状态
  ruyuanState?: RuyuanConnectionState;
}

// 连接池：accountId -> connection state
const connectionPool = new Map<string, WSConnectionState>();

/**
 * 判断是否为 Ruyuan-IM 适配模式
 */
function isRuyuanAdapter(config: XiaoWuConfig): boolean {
  return config.adapter === "ruyuan" || !!config.ruyuan?.userId;
}

/**
 * 获取或创建 WebSocket 连接
 * 这是关键：所有模块共享同一个连接
 */
export function getOrCreateWSConnection(
  accountId: string,
  config: XiaoWuConfig,
  messageHandler?: (event: XiaoWuMessageEvent) => void
): WSConnectionState {
  const existing = connectionPool.get(accountId);
  
  // 如果连接存在且有效，复用它
  if (existing && !existing.isClosed) {
    // 注册新的消息处理器
    if (messageHandler) {
      existing.handlers.add(messageHandler);
    }
    return existing;
  }

  // 创建新连接
  return createWSConnection(accountId, config, messageHandler);
}

/**
 * 创建新的 WebSocket 连接
 */
function createWSConnection(
  accountId: string,
  config: XiaoWuConfig,
  messageHandler?: (event: XiaoWuMessageEvent) => void
): WSConnectionState {
  const { wsUrl, apiToken, autoReconnect = true } = config;
  const isRuyuan = isRuyuanAdapter(config);

  const state: WSConnectionState = {
    ws: null as unknown as WebSocket,
    config,
    isReady: false,
    messageQueue: [],
    pendingRequests: new Map(),
    handlers: new Set(messageHandler ? [messageHandler] : []),
    isClosed: false,
  };

  // Ruyuan-IM 模式：初始化专用状态
  if (isRuyuan) {
    state.ruyuanState = initRuyuanConnectionState(
      config.ruyuan?.userId,
      config.ruyuan?.clientType || 1,
      config.ruyuan?.token
    );
  }

  const connect = () => {
    const headers: Record<string, string> = {};
    if (apiToken) {
      headers["Authorization"] = `Bearer ${apiToken}`;
    }

    const ws = new WebSocket(wsUrl!, { headers });
    state.ws = ws;

    ws.on("open", () => {
      console.log(`[XiaoWu ${accountId}] WebSocket connected`);
      
      // Ruyuan-IM 模式：连接成功后发送上线请求
      if (isRuyuan && state.ruyuanState) {
        sendRuyuanOnline(state);
      } else {
        // XiaoWu 原生模式：直接就绪
        state.isReady = true;
        processMessageQueue(state);
      }
    });

    ws.on("message", (rawData) => {
      console.log('[XiaoWu Debug] Raw message received:', rawData.toString().slice(0, 100));
      try {
        const data = JSON.parse(rawData.toString());
        
        // 根据适配器类型处理消息
        if (isRuyuan) {
          handleRuyuanMessage(data, state, accountId);
        } else {
          handleXiaoWuMessage(data, state);
        }
      } catch (err) {
        console.error(`[XiaoWu ${accountId}] Failed to parse message:`, err);
      }
    });

    ws.on("close", () => {
      console.log(`[XiaoWu ${accountId}] WebSocket disconnected`);
      state.isReady = false;

      // 清理 Ruyuan-IM 心跳定时器
      if (state.ruyuanState?.heartbeatTimer) {
        clearInterval(state.ruyuanState.heartbeatTimer);
        state.ruyuanState.heartbeatTimer = undefined;
      }

      if (autoReconnect && !state.isClosed) {
        console.log(`[XiaoWu ${accountId}] Reconnecting in 5s...`);
        state.reconnectTimer = setTimeout(connect, 5000);
      }
    });

    ws.on("error", (err) => {
      console.error(`[XiaoWu ${accountId}] WebSocket error:`, err);
    });
  };

  connectionPool.set(accountId, state);
  connect();
  return state;
}

/**
 * 处理 Ruyuan-IM 消息
 */
function handleRuyuanMessage(
  data: any,
  state: WSConnectionState,
  accountId: string
): void {
  const cmd = data as RuyuanJsonCommand;
  const cmdType = getCommandTypeName(cmd.type);
  
  console.log(`[XiaoWu ${accountId}] Ruyuan ${cmdType}:`, cmd.body);

  switch (cmd.type) {
    case 3: // ONLINE - 上线响应
      if (state.ruyuanState) {
        state.ruyuanState.isOnline = true;
        state.isReady = true;
        console.log(`[XiaoWu ${accountId}] Ruyuan online success`);
        
        // 启动心跳
        startRuyuanHeartbeat(state, accountId);
        
        // 处理队列中的消息
        processMessageQueue(state);
      }
      break;

    case 6: // MESSAGE_PUSH - 收到消息推送
      const event = convertFromRuyuanPush(cmd);
      state.handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (err) {
          console.error(`[XiaoWu ${accountId}] Handler error:`, err);
        }
      });
      break;

    case 4: // OFFLINE - 被踢下线
      console.log(`[XiaoWu ${accountId}] Received offline notification`);
      if (state.ruyuanState) {
        state.ruyuanState.isOnline = false;
      }
      state.isReady = false;
      break;

    case 2: // HEARTBEAT - 心跳响应
      // 无需处理，保持连接即可
      break;

    default:
      console.log(`[XiaoWu ${accountId}] Unhandled Ruyuan command: ${cmdType}`);
  }
}

/**
 * 处理 XiaoWu 原生消息
 */
function handleXiaoWuMessage(data: any, state: WSConnectionState): void {
  console.log('[XiaoWu Debug] Received message:', JSON.stringify(data).slice(0, 200));
  console.log('[XiaoWu Debug] Handlers count:', state.handlers.size);
  
  // 检查是否是发送请求的响应
  if (data.requestId && state.pendingRequests.has(data.requestId)) {
    const request = state.pendingRequests.get(data.requestId)!;
    state.pendingRequests.delete(data.requestId);
    clearTimeout(request.timeout);
    request.resolve({
      success: data.success,
      messageId: data.messageId,
      error: data.error,
    });
    return;
  }

  // 普通消息事件，分发给所有处理器
  if (data.messageId) {
    const event = data as XiaoWuMessageEvent;
    state.handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        console.error(`[XiaoWu] Handler error:`, err);
      }
    });
  }
}

/**
 * 发送 Ruyuan-IM 上线请求
 */
function sendRuyuanOnline(state: WSConnectionState): void {
  if (!state.ruyuanState?.token || !state.ruyuanState?.userId) {
    console.error("[XiaoWu] Ruyuan config missing token or userId");
    return;
  }

  const onlineCmd = createRuyuanOnlineCommand(
    state.ruyuanState.userId,
    state.ruyuanState.clientType || 1,
    state.ruyuanState.token
  );

  state.ws.send(JSON.stringify(onlineCmd));
  console.log(`[XiaoWu] Sending Ruyuan ONLINE request`);
}

/**
 * 启动 Ruyuan-IM 心跳
 */
function startRuyuanHeartbeat(state: WSConnectionState, accountId: string): void {
  if (!state.ruyuanState) return;
  
  const interval = state.config.ruyuan?.heartbeatInterval || 30000; // 默认30秒
  
  state.ruyuanState.heartbeatTimer = setInterval(() => {
    if (state.ws.readyState === WebSocket.OPEN && state.ruyuanState) {
      const heartbeatCmd = createRuyuanHeartbeatCommand(
        state.ruyuanState.userId!,
        state.ruyuanState.clientType || 1
      );
      state.ws.send(JSON.stringify(heartbeatCmd));
      console.log(`[XiaoWu ${accountId}] Ruyuan heartbeat sent`);
    }
  }, interval);

  console.log(`[XiaoWu ${accountId}] Ruyuan heartbeat started (${interval}ms)`);
}

/**
 * 处理消息队列
 */
function processMessageQueue(state: WSConnectionState): void {
  while (state.messageQueue.length > 0 && state.isReady) {
    const item = state.messageQueue.shift()!;
    sendInternal(state, item.message, item.resolve);
  }
}

/**
 * 内部发送方法
 */
function sendInternal(
  state: WSConnectionState,
  message: XiaoWuSendMessageRequest,
  resolve: (result: XiaoWuSendMessageResponse) => void
): void {
  // Ruyuan-IM 模式
  if (isRuyuanAdapter(state.config) && state.ruyuanState) {
    const sequence = getNextSequence(state.ruyuanState);
    const ruyuanMsg = convertToRuyuanSend(
      message,
      state.ruyuanState.userId!,
      state.ruyuanState.clientType || 1,
      sequence
    );

    state.ws.send(JSON.stringify(ruyuanMsg));
    
    // Ruyuan-IM 没有发送确认机制，直接返回成功
    resolve({ success: true, messageId: String(ruyuanMsg.body.messageId) });
    return;
  }

  // XiaoWu 原生模式
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  const payload = {
    type: "send_message",
    requestId,
    data: message,
  };

  // 设置超时
  const timeout = setTimeout(() => {
    if (state.pendingRequests.has(requestId)) {
      state.pendingRequests.delete(requestId);
      resolve({ success: false, error: "Request timeout" });
    }
  }, 10000);

  state.pendingRequests.set(requestId, { resolve, timeout });
  state.ws.send(JSON.stringify(payload));
}

/**
 * 发送消息（复用连接）
 */
export async function sendWithSharedConnection(
  accountId: string,
  config: XiaoWuConfig,
  message: XiaoWuSendMessageRequest
): Promise<XiaoWuSendMessageResponse> {
  const state = getOrCreateWSConnection(accountId, config);

  return new Promise((resolve) => {
    if (!state.isReady) {
      // 连接未就绪，加入队列等待
      console.log(`[XiaoWu ${accountId}] Connection not ready, queuing message`);
      state.messageQueue.push({ message, resolve });
    } else {
      sendInternal(state, message, resolve);
    }
  });
}

/**
 * 注册消息处理器
 */
export function registerMessageHandler(
  accountId: string,
  config: XiaoWuConfig,
  handler: (event: XiaoWuMessageEvent) => void
): () => void {
  const state = getOrCreateWSConnection(accountId, config, handler);
  state.handlers.add(handler);

  // 返回注销函数
  return () => {
    state.handlers.delete(handler);
  };
}

/**
 * 关闭连接
 */
export function closeWSConnection(accountId: string): void {
  const state = connectionPool.get(accountId);
  if (state) {
    state.isClosed = true;
    
    // 清理心跳定时器
    if (state.ruyuanState?.heartbeatTimer) {
      clearInterval(state.ruyuanState.heartbeatTimer);
    }
    
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }
    
    state.ws.close();
    connectionPool.delete(accountId);
    console.log(`[XiaoWu ${accountId}] Connection closed`);
  }
}

/**
 * 获取连接状态
 */
export function getConnectionStatus(accountId: string): {
  connected: boolean;
  isReady: boolean;
  pendingMessages: number;
  pendingRequests: number;
  isRuyuan: boolean;
  isOnline?: boolean; // Ruyuan-IM 专用
} {
  const state = connectionPool.get(accountId);
  if (!state) {
    return { 
      connected: false, 
      isReady: false, 
      pendingMessages: 0, 
      pendingRequests: 0,
      isRuyuan: false,
    };
  }
  
  return {
    connected: state.ws.readyState === WebSocket.OPEN,
    isReady: state.isReady,
    pendingMessages: state.messageQueue.length,
    pendingRequests: state.pendingRequests.size,
    isRuyuan: isRuyuanAdapter(state.config),
    isOnline: state.ruyuanState?.isOnline,
  };
}

// ============ 以下保持向后兼容 ============

export interface XiaoWuClient {
  send: (message: XiaoWuSendMessageRequest) => Promise<XiaoWuSendMessageResponse>;
  close: () => void;
}

/**
 * 创建 WebSocket 客户端（向后兼容）
 */
export function createXiaoWuWSClient(
  config: XiaoWuConfig,
  handlers: {
    onMessage: (event: XiaoWuMessageEvent) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Error) => void;
  }
): XiaoWuClient {
  const accountId = config.wsUrl || "default";
  
  const state = getOrCreateWSConnection(accountId, config, handlers.onMessage);

  // 包装成旧接口
  return {
    send: (message) => sendWithSharedConnection(accountId, config, message),
    close: () => {
      // 不再真正关闭，只是减少引用
    },
  };
}

/**
 * 创建 HTTP API 客户端
 */
export function createXiaoWuHTTPClient(
  config: XiaoWuConfig
): XiaoWuClient {
  const { apiUrl, apiToken } = config;

  return {
    send: async (message) => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiToken) {
          headers["Authorization"] = `Bearer ${apiToken}`;
        }

        const response = await fetch(`${apiUrl}/api/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify(message),
        });

        if (!response.ok) {
          return {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        const result = await response.json();
        return {
          success: true,
          messageId: result.messageId,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    close: () => {
      // HTTP 无状态，无需关闭
    },
  };
}

/**
 * HTTP 轮询获取消息
 */
export async function* pollXiaoWuMessages(
  config: XiaoWuConfig,
  signal?: AbortSignal
): AsyncGenerator<XiaoWuMessageEvent> {
  const { apiUrl, apiToken, pollInterval = 3000 } = config;
  let lastMessageId: string | null = null;

  while (!signal?.aborted) {
    try {
      const headers: Record<string, string> = {};
      if (apiToken) {
        headers["Authorization"] = `Bearer ${apiToken}`;
      }

      const url = new URL(`${apiUrl}/api/messages`);
      if (lastMessageId) {
        url.searchParams.set("after", lastMessageId);
      }

      const response = await fetch(url.toString(), { headers, signal });
      
      if (!response.ok) {
        console.error(`[XiaoWu] Poll failed: ${response.status}`);
        await sleep(pollInterval);
        continue;
      }

      const messages = (await response.json()) as XiaoWuMessageEvent[];
      
      for (const message of messages) {
        yield message;
        lastMessageId = message.messageId;
      }
    } catch (err) {
      if (signal?.aborted) break;
      console.error("[XiaoWu] Poll error:", err);
    }

    await sleep(pollInterval);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
