import type { ClawdbotConfig, RuntimeEnv, ReplyPayload } from "openclaw/plugin-sdk";
import { getOpenClaw Web ChatRuntime } from "./runtime.js";
import { sendMessageOpenClaw Web Chat } from "./send.js";

export interface OpenClaw Web ChatReplyDispatcherParams {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  senderId: string;
}

export function createOpenClaw Web ChatReplyDispatcher(params: OpenClaw Web ChatReplyDispatcherParams) {
  const { cfg, agentId, runtime, chatId, senderId } = params;
  const log = runtime?.log ?? console.log;
  
  log('[OpenClaw Web Chat Reply] Creating reply dispatcher for chat: ' + chatId);
  
  const core = getOpenClaw Web ChatRuntime();
  
  // 获取文本分片限制
  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: 'web-chat',
    defaultLimit: 2000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, 'web-chat');
  
  // 创建回复分发器
  const replyResult = core.channel.reply.createReplyDispatcherWithTyping({
    responsePrefix: undefined,
    responsePrefixContextProvider: undefined,
    humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
    deliver: async (payload: ReplyPayload) => {
      const text = payload.text ?? '';
      if (!text.trim()) {
        log('[OpenClaw Web Chat Reply] Empty text, skipping');
        return;
      }
      
      log('[OpenClaw Web Chat Reply] Delivering: ' + text.slice(0, 100));
      
      // 分片处理
      const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
      log('[OpenClaw Web Chat Reply] Sending ' + chunks.length + ' chunks');
      
      for (const chunk of chunks) {
        try {
          const result = await sendMessageOpenClaw Web Chat({
            cfg,
            to: 'chat:' + chatId,
            text: chunk,
          });
          
          if (result.error) {
            log('[OpenClaw Web Chat Reply] Failed: ' + result.error);
            throw new Error(result.error);
          }
          
          log('[OpenClaw Web Chat Reply] Success, messageId: ' + result.messageId);
        } catch (err) {
          log('[OpenClaw Web Chat Reply] Error: ' + err);
          throw err;
        }
      }
    },
    onError: (err, info) => {
      log('[OpenClaw Web Chat Reply] ' + info.kind + ' failed: ' + err);
    },
    onIdle: () => {
      log('[OpenClaw Web Chat Reply] Dispatcher idle');
    },
  });
  
  log('[OpenClaw Web Chat Reply] replyResult type: ' + typeof replyResult);
  log('[OpenClaw Web Chat Reply] replyResult keys: ' + Object.keys(replyResult || {}).join(', '));
  
  const { dispatcher, replyOptions, markDispatchIdle } = replyResult || {};
  
  log('[OpenClaw Web Chat Reply] replyOptions keys: ' + Object.keys(replyOptions || {}).join(', '));
  
  // 添加 reply 属性到 replyOptions
  const finalReplyOptions = {
    ...replyOptions,
    reply: dispatcher,
  };
  
  log('[OpenClaw Web Chat Reply] finalReplyOptions keys: ' + Object.keys(finalReplyOptions || {}).join(', '));
  log('[OpenClaw Web Chat Reply] finalReplyOptions.reply: ' + (finalReplyOptions?.reply ? 'exists' : 'missing'));
  
  return {
    dispatcher,
    replyOptions: finalReplyOptions,
    markDispatchIdle,
  };
}
