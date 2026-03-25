/**
 * OpenClawWebChat 账号管理
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { ResolvedOpenClawWebChatAccount, OpenClawWebChatConfig } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

/**
 * 解析 OpenClawWebChat 账号配置
 */
export function resolveOpenClawWebChatAccount({
  cfg,
  accountId = DEFAULT_ACCOUNT_ID,
}: {
  cfg: ClawdbotConfig;
  accountId?: string;
}): ResolvedOpenClawWebChatAccount {
  const channelConfig = cfg.channels?.["web-chat"] as OpenClawWebChatConfig | undefined;
  const accounts = channelConfig?.accounts as
    | Record<string, OpenClawWebChatConfig>
    | undefined;

  // 获取指定账号或默认配置
  const accountConfig =
    accountId === DEFAULT_ACCOUNT_ID
      ? channelConfig
      : accounts?.[accountId];

  const isDefault = accountId === DEFAULT_ACCOUNT_ID;
  
  // 判断是否使用 Ruyuan 适配器
  const adapter = accountConfig?.adapter || 
    (accountConfig?.ruyuan?.userId ? "ruyuan" : "web-chat");

  return {
    accountId,
    enabled: Boolean(
      isDefault
        ? channelConfig?.enabled
        : accounts?.[accountId]?.enabled ?? channelConfig?.enabled
    ),
    configured: Boolean(
      accountConfig?.wsUrl || accountConfig?.apiUrl
    ),
    config: accountConfig || {},
    wsUrl: accountConfig?.wsUrl || "ws://localhost:8080/ws",
    apiUrl: accountConfig?.apiUrl || "http://localhost:8080",
    apiToken: accountConfig?.apiToken,
    connectionMode: accountConfig?.connectionMode || "websocket",
    pollInterval: accountConfig?.pollInterval || 3000,
    autoReconnect: accountConfig?.autoReconnect ?? true,
    adapter: adapter as "web-chat" | "ruyuan",
    ruyuan: accountConfig?.ruyuan,
  };
}

/**
 * 列出所有账号ID
 */
export function listOpenClawWebChatAccountIds(cfg: ClawdbotConfig): string[] {
  const channelConfig = cfg.channels?.["web-chat"] as OpenClawWebChatConfig | undefined;
  const accounts = channelConfig?.accounts as
    | Record<string, OpenClawWebChatConfig>
    | undefined;

  const ids = [DEFAULT_ACCOUNT_ID];
  if (accounts) {
    ids.push(...Object.keys(accounts));
  }
  return ids;
}

/**
 * 获取默认账号ID
 */
export function resolveDefaultOpenClawWebChatAccountId(
  cfg: ClawdbotConfig
): string | undefined {
  const channelConfig = cfg.channels?.["web-chat"] as OpenClawWebChatConfig | undefined;
  if (!channelConfig?.enabled && !channelConfig?.accounts) {
    return undefined;
  }
  return DEFAULT_ACCOUNT_ID;
}

/**
 * 列出启用的账号
 */
export function listEnabledOpenClawWebChatAccounts(
  cfg: ClawdbotConfig
): ResolvedOpenClawWebChatAccount[] {
  const ids = listOpenClawWebChatAccountIds(cfg);
  return ids
    .map((id) => resolveOpenClawWebChatAccount({ cfg, accountId: id }))
    .filter((acc) => acc.enabled && acc.configured);
}
