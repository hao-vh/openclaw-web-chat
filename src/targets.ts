/**
 * OpenClaw Web Chat 目标解析
 */

/**
 * 标准化目标格式
 */
export function normalizeOpenClaw Web ChatTarget(target: string): string {
  // 如果已经是标准格式，直接返回
  if (target.startsWith("user:") || target.startsWith("chat:")) {
    return target;
  }

  // 如果包含 @ 符号，认为是用户ID
  if (target.includes("@")) {
    return `user:${target}`;
  }

  // 默认认为是聊天室ID
  return `chat:${target}`;
}

/**
 * 格式化目标为显示名称
 */
export function formatOpenClaw Web ChatTarget(target: string): string {
  if (target.startsWith("user:")) {
    return target.slice(5);
  }
  if (target.startsWith("chat:")) {
    return target.slice(5);
  }
  return target;
}

/**
 * 判断是否是有效的 OpenClaw Web Chat ID
 */
export function looksLikeOpenClaw Web ChatId(target: string): boolean {
  // OpenClaw Web Chat ID 可以是任何非空字符串
  return typeof target === "string" && target.length > 0;
}

/**
 * 提取 chat ID（去掉前缀）
 */
export function extractChatId(target: string): string {
  return target.replace(/^(chat|user):/, "");
}

/**
 * 提取用户 ID
 */
export function extractUserId(target: string): string | null {
  if (target.startsWith("user:")) {
    return target.slice(5);
  }
  return null;
}

/**
 * 检查是否是私信
 */
export function isDirectMessage(target: string): boolean {
  return target.startsWith("user:");
}
