import type { ClawdbotConfig, RuntimeEnv, ReplyPayload } from "openclaw/plugin-sdk";
import { getOpenClawWebChatRuntime } from "./runtime.js";
import { sendMessageOpenClawWebChat } from "./send.js";

export interface OpenClawWebChatReplyDispatcherParams {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  senderId: string;
}

export function createOpenClawWebChatReplyDispatcher(params: OpenClawWebChatReplyDispatcherParams) {
  const { cfg, agentId, runtime, chatId, senderId } = params;
  const log = runtime?.log ?? console.log;
  
  log('[OpenClawWebChat Reply] Creating reply dispatcher for chat: ' + chatId);
  
  const core = getOpenClawWebChatRuntime();
  
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
        log('[OpenClawWebChat Reply] Empty text, skipping');
        return;
      }
      
      log('[OpenClawWebChat Reply] Delivering: ' + text.slice(0, 100));
      
      // 分片处理
      const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
      log('[OpenClawWebChat Reply] Sending ' + chunks.length + ' chunks');
      
      for (const chunk of chunks) {
        try {
          const result = await sendMessageOpenClawWebChat({
            cfg,
            to: 'chat:' + chatId,
            text: chunk,
          });
          
          if (result.error) {
            log('[OpenClawWebChat Reply] Failed: ' + result.error);
            throw new Error(result.error);
          }
          
          log('[OpenClawWebChat Reply] Success, messageId: ' + result.messageId);
        } catch (err) {
          log('[OpenClawWebChat Reply] Error: ' + err);
          throw err;
        }
      }
    },
    onError: (err, info) => {
      log('[OpenClawWebChat Reply] ' + info.kind + ' failed: ' + err);
    },
    onIdle: () => {
      log('[OpenClawWebChat Reply] Dispatcher idle');
    },
  });
  
  log('[OpenClawWebChat Reply] replyResult type: ' + typeof replyResult);
  log('[OpenClawWebChat Reply] replyResult keys: ' + Object.keys(replyResult || {}).join(', '));
  
  const { dispatcher, replyOptions, markDispatchIdle } = replyResult || {};
  
  log('[OpenClawWebChat Reply] replyOptions keys: ' + Object.keys(replyOptions || {}).join(', '));
  
  // 添加 reply 属性到 replyOptions
  const finalReplyOptions = {
    ...replyOptions,
    reply: dispatcher,
  };
  
  log('[OpenClawWebChat Reply] finalReplyOptions keys: ' + Object.keys(finalReplyOptions || {}).join(', '));
  log('[OpenClawWebChat Reply] finalReplyOptions.reply: ' + (finalReplyOptions?.reply ? 'exists' : 'missing'));
  
  return {
    dispatcher,
    replyOptions: finalReplyOptions,
    markDispatchIdle,
  };
}
