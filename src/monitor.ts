/**
 * OpenClawWebChat Monitor - 借鉴 Feishu Plugin 最佳实践
 * 
 * 消息监听和 Agent 触发
 */

import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import { resolveOpenClawWebChatAccount, listEnabledOpenClawWebChatAccounts } from "./accounts.js";
import { registerMessageHandler, closeWSConnection, pollOpenClawWebChatMessages } from "./client.js";
import { getOpenClawWebChatChannel } from "./runtime.js";
import { sendMessageOpenClawWebChat } from "./send.js";
import type { ResolvedOpenClawWebChatAccount, OpenClawWebChatMessageEvent } from "./types.js";

export interface MonitorOpenClawWebChatOpts {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
}

async function monitorSingleAccount(
  account: ResolvedOpenClawWebChatAccount,
  opts: MonitorOpenClawWebChatOpts
): Promise<void> {
  const { config, runtime, abortSignal } = opts;
  const log = runtime?.log ?? console.log;
  const { accountId, connectionMode } = account;
  
  log(`[OpenClawWebChat ${accountId}] Starting monitor (mode: ${connectionMode})...`);
  
  const chatHistories = new Map<string, HistoryEntry[]>();
  
  if (connectionMode === "websocket") {
    return monitorWebSocket(account, opts, chatHistories);
  } else {
    return monitorHTTP(account, opts, chatHistories);
  }
}

async function monitorWebSocket(
  account: ResolvedOpenClawWebChatAccount,
  opts: MonitorOpenClawWebChatOpts,
  chatHistories: Map<string, HistoryEntry[]>
): Promise<void> {
  const { config, runtime, abortSignal } = opts;
  const log = runtime?.log ?? console.log;
  const { accountId } = account;
  
  return new Promise((resolve) => {
    const handleMessage = async (event: OpenClawWebChatMessageEvent) => {
      try {
        log(`[OpenClawWebChat ${accountId}] Processing message from ${event.senderName}`);
        
        // 获取 Core Channel API
        const core = getOpenClawWebChatChannel();
        const isGroup = !event.isDirect;
        
        // 解析路由
        const route = core.routing.resolveAgentRoute({
          cfg: config,
          channel: "web-chat",
          peer: { kind: isGroup ? "group" : "dm", id: isGroup ? event.chatId : event.senderId },
        });
        
        log(`[OpenClawWebChat ${accountId}] Routed to agent: ${route.sessionKey}`);
        
        // 创建 deliver 函数 - 发送回复到 Web 聊天室
        const deliver = async (payload: any) => {
          const text = payload.text ?? "";
          if (!text.trim()) return;
          
          log(`[OpenClawWebChat ${accountId}] Delivering: ${text.slice(0, 50)}...`);
          
          try {
            const result = await sendMessageOpenClawWebChat({
              cfg: config!,
              to: `chat:${event.chatId}`,
              text: text,
              replyTo: event.messageId,
            });
            
            if (result.error) {
              log(`[OpenClawWebChat ${accountId}] Send failed: ${result.error}`);
            } else {
              log(`[OpenClawWebChat ${accountId}] Send success: ${result.messageId}`);
            }
          } catch (err) {
            log(`[OpenClawWebChat ${accountId}] Send error: ${err}`);
          }
        };
        
        // 创建回复分发器
        const replyResult = core.reply.createReplyDispatcherWithTyping({
          deliver,
          onError: (err: Error, info: any) => {
            log(`[OpenClawWebChat ${accountId}] deliver error: ${err}`);
          },
          onIdle: () => {
            log(`[OpenClawWebChat ${accountId}] dispatcher idle`);
          },
        });
        
        const { dispatcher, replyOptions, markDispatchIdle } = replyResult;
        
        // 关键修复：确保 replyOptions 包含 reply 属性
        const finalReplyOptions = {
          ...replyOptions,
          reply: dispatcher,
        };
        
        // 构建 envelope
        const envelopeOptions = core.reply.resolveEnvelopeFormatOptions(config);
        const body = core.reply.formatAgentEnvelope({
          channel: "OpenClawWebChat",
          from: isGroup ? `${event.chatId}:${event.senderId}` : event.senderId,
          timestamp: new Date(),
          envelope: envelopeOptions,
          body: `${event.senderName}: ${event.content}`,
        });
        
        // 构建上下文
        const ctxPayload = core.reply.finalizeInboundContext({
          Body: body,
          RawBody: event.content,
          CommandBody: event.content,
          From: event.senderId,
          To: `chat:${event.chatId}`,
          SessionKey: route.sessionKey,
          AccountId: route.accountId,
          ChatType: isGroup ? "group" : "direct",
          GroupSubject: isGroup ? event.chatId : undefined,
          SenderName: event.senderName ?? event.senderId,
          SenderId: event.senderId,
          Provider: "web-chat" as const,
          Surface: "web-chat" as const,
          MessageSid: event.messageId,
          Timestamp: Date.now(),
          WasMentioned: true,
          CommandAuthorized: true,
          OriginatingChannel: "web-chat" as const,
          OriginatingTo: `chat:${event.chatId}`,
        });
        
        log(`[OpenClawWebChat ${accountId}] Dispatching to agent...`);
        
        // 关键：调用 dispatchReplyFromConfig 触发 Agent
        const { queuedFinal, counts } = await core.reply.dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg: config,
          dispatcher,
          replyOptions: finalReplyOptions,
        });
        
        markDispatchIdle();
        
        log(`[OpenClawWebChat ${accountId}] Dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
        
        // 保存历史
        const historyKey = `${accountId}:${event.chatId}`;
        const history = chatHistories.get(historyKey) || [];
        history.push({ role: "user", content: event.content, timestamp: event.timestamp });
        chatHistories.set(historyKey, history);
      } catch (err) {
        log(`[OpenClawWebChat ${accountId}] Error handling message: ${err}`);
      }
    };
    
    // 注册消息处理器
    const cleanup = registerMessageHandler(accountId, account.config, handleMessage);
    
    // 处理终止
    const handleAbort = () => {
      log(`[OpenClawWebChat ${accountId}] Abort signal received, stopping`);
      cleanup();
      closeWSConnection(accountId);
      resolve();
    };
    
    if (abortSignal?.aborted) {
      handleAbort();
      return;
    }
    
    abortSignal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function monitorHTTP(
  account: ResolvedOpenClawWebChatAccount,
  opts: MonitorOpenClawWebChatOpts,
  chatHistories: Map<string, HistoryEntry[]>
): Promise<void> {
  const { runtime } = opts;
  const log = runtime?.log ?? console.log;
  log("[OpenClawWebChat] HTTP polling not fully implemented");
}

export async function monitorOpenClawWebChatProvider(
  opts: MonitorOpenClawWebChatOpts = {}
): Promise<void> {
  const { config, runtime, accountId } = opts;
  const log = runtime?.log ?? console.log;
  
  if (!config) {
    throw new Error("Config is required for OpenClawWebChat monitor");
  }
  
  if (accountId) {
    const account = resolveOpenClawWebChatAccount({ cfg: config, accountId });
    if (!account.enabled || !account.configured) {
      throw new Error(`OpenClawWebChat account "${accountId}" not configured or disabled`);
    }
    return monitorSingleAccount(account, opts);
  }
  
  const accounts = listEnabledOpenClawWebChatAccounts(config);
  if (accounts.length === 0) {
    log("[OpenClawWebChat] No enabled accounts found");
    return;
  }
  
  log(`[OpenClawWebChat] Starting monitor for ${accounts.length} account(s)`);
  
  await Promise.all(
    accounts.map((account) => monitorSingleAccount(account, opts))
  );
}
