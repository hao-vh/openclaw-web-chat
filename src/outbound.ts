import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { sendMessageOpenClaw Web Chat } from "./send.js";

export const web-chatOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => {
    // 简单分片：按段落分割
    if (text.length <= limit) return [text];
    const chunks: string[] = [];
    let current = "";
    for (const line of text.split("\n")) {
      if ((current + line).length > limit && current) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? "\n" : "") + line;
      }
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [text.slice(0, limit)];
  },
  chunkerMode: "text",
  textChunkLimit: 2000,
  sendText: async ({ cfg, to, text }) => {
    console.log("[OpenClaw Web Chat Outbound] Sending text to " + to + ": " + text.slice(0, 100));
    const result = await sendMessageOpenClaw Web Chat({ cfg, to, text });
    console.log("[OpenClaw Web Chat Outbound] Result: " + JSON.stringify(result));
    return { channel: "web-chat", ...result };
  },
  sendMedia: async ({ cfg, to, text }) => {
    // 暂时只支持文本
    if (text?.trim()) {
      const result = await sendMessageOpenClaw Web Chat({ cfg, to, text });
      return { channel: "web-chat", ...result };
    }
    return { channel: "web-chat", success: false, error: "No content to send" };
  },
};
