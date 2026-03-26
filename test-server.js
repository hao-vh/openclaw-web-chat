const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = 3456;
const WS_PATH = '/ws';

// 内存存储
const messages = [];
const clients = new Map();
const rooms = new Map();

// ==================== Admin Stats 数据采集 ====================
const adminStats = {
  // 连接事件记录
  connections: new Map(), // accountId -> { status, connectedSince, reconnectCount, lastError, protocol }
  // 消息事件环形缓冲区 (最多 10000 条)
  messageEvents: [],
  maxMessageEvents: 10000,
  // WebSocket 连接历史
  connectionHistory: [], // { timestamp, event, clientId, userName }
  // 服务启动时间
  startedAt: Date.now(),
};

// 默认账户初始化
adminStats.connections.set('default', {
  accountId: 'default',
  status: 'connected',
  connectedSince: Date.now(),
  reconnectCount: 0,
  lastError: null,
  protocol: 'web-chat',
  connectionMode: 'websocket',
  wsUrl: `ws://localhost:${PORT}/ws`,
  apiUrl: `http://localhost:${PORT}`,
  apiToken: null,
  enabled: true,
});

function recordMessageEvent(msg) {
  const event = {
    timestamp: msg.timestamp || Date.now(),
    messageId: msg.messageId,
    chatId: msg.chatId || 'room_1',
    chatType: msg.isDirect ? 'direct' : 'channel',
    senderId: msg.senderId,
    senderName: msg.senderName || msg.senderId,
    messageType: msg.messageType || 'text',
  };
  adminStats.messageEvents.push(event);
  if (adminStats.messageEvents.length > adminStats.maxMessageEvents) {
    adminStats.messageEvents.shift();
  }
  // 推送实时更新给 admin WebSocket 客户端
  broadcastAdminUpdate({ type: 'message_event', data: event });
}

function recordConnectionEvent(event, clientId, userName) {
  adminStats.connectionHistory.push({
    timestamp: Date.now(),
    event,
    clientId,
    userName,
  });
  // 保留最近 500 条
  if (adminStats.connectionHistory.length > 500) {
    adminStats.connectionHistory.shift();
  }
  broadcastAdminUpdate({
    type: 'connection_update',
    data: { event, clientId, userName, onlineCount: clients.size },
  });
}

function getMessageSummary() {
  const now = Date.now();
  const hourMs = 3600000;
  const dayMs = 86400000;

  // 按小时统计 (过去24小时)
  const hourly = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - (i + 1) * hourMs;
    const end = now - i * hourMs;
    const count = adminStats.messageEvents.filter(e => e.timestamp >= start && e.timestamp < end).length;
    const hour = new Date(end).getHours();
    hourly.push({ hour: `${hour}:00`, count });
  }

  // 按天统计 (过去7天)
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const start = now - (i + 1) * dayMs;
    const end = now - i * dayMs;
    const count = adminStats.messageEvents.filter(e => e.timestamp >= start && e.timestamp < end).length;
    const date = new Date(end);
    daily.push({ date: `${date.getMonth() + 1}/${date.getDate()}`, count });
  }

  return {
    total: adminStats.messageEvents.length,
    hourly,
    daily,
    today: adminStats.messageEvents.filter(e => e.timestamp >= now - dayMs).length,
    thisHour: adminStats.messageEvents.filter(e => e.timestamp >= now - hourMs).length,
  };
}

function getActiveUsers(limit = 20) {
  const userMap = new Map();
  for (const e of adminStats.messageEvents) {
    const key = e.senderId;
    if (!userMap.has(key)) {
      userMap.set(key, { senderId: e.senderId, senderName: e.senderName, count: 0, lastActive: 0 });
    }
    const u = userMap.get(key);
    u.count++;
    if (e.timestamp > u.lastActive) u.lastActive = e.timestamp;
  }
  return Array.from(userMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function getMessageDistribution() {
  const chatMap = new Map();
  let directCount = 0;
  let channelCount = 0;
  for (const e of adminStats.messageEvents) {
    if (e.chatType === 'direct') directCount++;
    else channelCount++;
    const key = e.chatId;
    chatMap.set(key, (chatMap.get(key) || 0) + 1);
  }
  const byChat = Array.from(chatMap.entries())
    .map(([chatId, count]) => ({ chatId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 消息类型分布
  const typeMap = new Map();
  for (const e of adminStats.messageEvents) {
    typeMap.set(e.messageType, (typeMap.get(e.messageType) || 0) + 1);
  }
  const byType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { directCount, channelCount, byChat, byType };
}

function getAccountSnapshots() {
  return Array.from(adminStats.connections.values()).map(acc => ({
    ...acc,
    apiToken: acc.apiToken ? maskToken(acc.apiToken) : null,
    onlineClients: clients.size,
    uptime: acc.connectedSince ? Date.now() - acc.connectedSince : 0,
  }));
}

function maskToken(token) {
  if (!token || token.length < 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

// Admin WebSocket 客户端集合
const adminClients = new Set();

function broadcastAdminUpdate(msg) {
  const data = JSON.stringify(msg);
  adminClients.forEach(ws => {
    if (ws.readyState === 1) ws.send(data);
  });
}

// 创建 HTTP 服务器
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/api/messages' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const after = url.searchParams.get('after');
    let result = messages;
    if (after) {
      const afterIndex = messages.findIndex(m => m.messageId === after);
      if (afterIndex !== -1) {
        result = messages.slice(afterIndex + 1);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.slice(-50)));
    return;
  }

  if (req.url === '/api/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const message = {
          messageId: `msg_${uuidv4()}`,
          chatId: data.chatId || 'room_1',
          senderId: data.senderId || 'api_user',
          senderName: data.senderName || 'API User',
          content: data.content,
          messageType: data.messageType || 'text',
          timestamp: Date.now(),
          isDirect: data.isDirect || false,
          replyTo: data.replyTo || null,
        };
        messages.push(message);
        broadcast(message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, messageId: message.messageId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 主页和 embed 都使用深色客服主题
  if (req.url === '/' || req.url === '/embed' || req.url?.startsWith('/embed?')) {
    if (req.url === '/embed' || req.url?.startsWith('/embed?')) {
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getEmbedHtmlPage());
    return;
  }

  // 旧版多房间聊天页面（保留，可通过 /classic 访问）
  if (req.url === '/classic') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHtmlPage());
    return;
  }

  // ==================== Admin Dashboard Routes ====================
  if (req.url === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getAdminHtmlPage());
    return;
  }

  if (req.url === '/admin/api/connections' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        accounts: getAccountSnapshots(),
        onlineClients: clients.size,
        recentEvents: adminStats.connectionHistory.slice(-50),
      },
      timestamp: Date.now(),
    }));
    return;
  }

  if (req.url === '/admin/api/messages/stats' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: getMessageSummary(),
      timestamp: Date.now(),
    }));
    return;
  }

  if (req.url === '/admin/api/messages/active-users' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: getActiveUsers(20),
      timestamp: Date.now(),
    }));
    return;
  }

  if (req.url === '/admin/api/messages/distribution' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: getMessageDistribution(),
      timestamp: Date.now(),
    }));
    return;
  }

  if (req.url === '/admin/api/accounts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: getAccountSnapshots(),
      timestamp: Date.now(),
    }));
    return;
  }

  if (req.url?.startsWith('/admin/api/accounts/') && req.url.endsWith('/toggle') && req.method === 'POST') {
    const accountId = req.url.split('/')[4];
    const acc = adminStats.connections.get(accountId);
    if (acc) {
      acc.enabled = !acc.enabled;
      acc.status = acc.enabled ? 'connected' : 'disconnected';
      if (!acc.enabled) acc.connectedSince = null;
      else acc.connectedSince = Date.now();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { accountId, enabled: acc.enabled } }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Account not found' }));
    }
    return;
  }

  if (req.url === '/admin/api/overview' && req.method === 'GET') {
    const msgSummary = getMessageSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        onlineClients: clients.size,
        totalMessages: msgSummary.total,
        todayMessages: msgSummary.today,
        thisHourMessages: msgSummary.thisHour,
        uptime: Date.now() - adminStats.startedAt,
        accounts: getAccountSnapshots(),
        rooms: Array.from(rooms.entries()).map(([id, members]) => ({ id, memberCount: members.size })),
      },
      timestamp: Date.now(),
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ noServer: true });

// 支持多个 WebSocket 路径 (/ws 和 /ws/admin)
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;
  if (pathname === '/ws' || pathname === '/ws/admin') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  // 检查是否是 admin WebSocket 连接
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (req.url === '/ws/admin') {
    console.log('[TestServer] Admin WebSocket client connected');
    adminClients.add(ws);
    ws.on('close', () => adminClients.delete(ws));
    ws.on('error', () => adminClients.delete(ws));
    // 发送初始状态
    ws.send(JSON.stringify({
      type: 'stats_refresh',
      data: {
        onlineClients: clients.size,
        totalMessages: adminStats.messageEvents.length,
        accounts: getAccountSnapshots(),
      },
    }));
    return;
  }

  console.log('[TestServer] WebSocket client connected');
  const clientInfo = {
    userId: `user_${uuidv4().slice(0, 8)}`,
    userName: `用户${Math.floor(Math.random() * 9000) + 1000}`,
    joinedAt: Date.now(),
  };
  clients.set(ws, clientInfo);
  recordConnectionEvent('connected', clientInfo.userId, clientInfo.userName);

  ws.send(JSON.stringify({
    type: 'system',
    message: `Welcome ${clientInfo.userName}! Connected successfully`,
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWebSocketMessage(ws, msg, clientInfo);
    } catch (err) {
      console.error('[TestServer] Message parse error:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    console.log('[TestServer] WebSocket client disconnected');
    recordConnectionEvent('disconnected', clientInfo.userId, clientInfo.userName);
    clients.delete(ws);
    rooms.forEach((members, roomId) => {
      if (members.has(ws)) members.delete(ws);
    });
  });

  ws.on('error', (err) => {
    console.error('[TestServer] WebSocket error:', err);
    recordConnectionEvent('error', clientInfo.userId, clientInfo.userName);
  });
});

function handleWebSocketMessage(ws, msg, clientInfo) {
  console.log('[TestServer] Received message type:', msg.type || 'raw', 'from:', clientInfo.userName);

  // OpenClaw 插件通过 send_message 发送 AI 回复
  if (msg.type === 'send_message') {
    const message = {
      messageId: `msg_${uuidv4()}`,
      chatId: msg.data?.chatId || 'room_1',
      senderId: 'ai_bot',
      senderName: 'AI Assistant',
      content: msg.data?.content || '',
      messageType: msg.data?.messageType || 'text',
      timestamp: Date.now(),
      isDirect: msg.data?.chatId ? msg.data.chatId.startsWith('user:') : false,
      replyTo: msg.data?.replyTo || null,
      isBot: true,
    };
    messages.push(message);
    // 关键修复：排除发送者（OpenClaw 插件），避免消息回环
    broadcast(message, ws);
    ws.send(JSON.stringify({ requestId: msg.requestId, success: true, messageId: message.messageId }));
    console.log('[TestServer] AI reply broadcast:', message.content.slice(0, 100));
    return;
  }

  // 网站用户直接发送的消息
  if (msg.messageId && msg.content) {
    const message = {
      messageId: msg.messageId,
      chatId: msg.chatId || 'room_1',
      senderId: msg.senderId || clientInfo.userId,
      senderName: msg.senderName || clientInfo.userName,
      content: msg.content,
      messageType: msg.messageType || 'text',
      timestamp: msg.timestamp || Date.now(),
      isDirect: msg.isDirect || false,
      replyTo: msg.replyTo || null,
      isBot: false,
    };
    messages.push(message);
    // 广播给所有客户端（包括 OpenClaw 插件和发送者自己）
    broadcast(message);
    return;
  }
  
  if (msg.type === 'join') {
    const roomId = msg.roomId || 'room_1';
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(ws);
  }
}

function broadcast(message, excludeWs = null) {
  // 记录消息事件到 admin stats
  recordMessageEvent(message);

  const data = JSON.stringify(message);
  console.log('[Broadcast] Sending to', wss.clients.size, 'clients');
  wss.clients.forEach((client, index) => {
    if ((!excludeWs || client !== excludeWs) && client.readyState === 1 && !adminClients.has(client)) {
      client.send(data);
      console.log('[Broadcast] Message sent to client', index);
    }
  });
}

server.listen(PORT, () => {
  console.log('🚀 OpenClaw Web Chat Test Server running on port', PORT);
  console.log('📡 WebSocket: ws://localhost:' + PORT + '/ws');
  console.log('🌐 HTTP API: http://localhost:' + PORT + '/api');
  console.log('📊 Admin Dashboard: http://localhost:' + PORT + '/admin');
});

// 每 5 秒向 admin 客户端推送汇总刷新
setInterval(() => {
  if (adminClients.size > 0) {
    broadcastAdminUpdate({
      type: 'stats_refresh',
      data: {
        onlineClients: clients.size,
        totalMessages: adminStats.messageEvents.length,
        todayMessages: getMessageSummary().today,
        accounts: getAccountSnapshots(),
        rooms: Array.from(rooms.entries()).map(([id, members]) => ({ id, memberCount: members.size })),
      },
    });
  }
}, 5000);

function getEmbedHtmlPage() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AIMason 智能客服</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
  <style>
    :root {
      --bg-primary: #0a0e17;
      --bg-secondary: #111827;
      --bg-card: rgba(20, 30, 48, 0.6);
      --bg-card-solid: #14202f;
      --blue: #3b82f6;
      --cyan: #06b6d4;
      --border: rgba(59, 130, 246, 0.15);
      --border-hover: rgba(59, 130, 246, 0.4);
      --text-primary: #e2e8f0;
      --text-secondary: rgba(148, 163, 184, 0.8);
      --text-muted: rgba(100, 116, 139, 0.7);
      --glow-blue: rgba(59, 130, 246, 0.3);
      --glow-cyan: rgba(6, 182, 212, 0.2);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
    }

    .chat-container {
      display: flex; flex-direction: column; height: 100vh;
      background: radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%);
    }

    /* ===== Header ===== */
    .chat-header {
      padding: 14px 20px;
      background: rgba(10, 14, 23, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    .chat-header-left { display: flex; align-items: center; gap: 12px; }
    .chat-avatar {
      width: 40px; height: 40px; border-radius: 12px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 20px var(--glow-blue);
      position: relative;
    }
    .chat-avatar::after {
      content: ''; position: absolute; inset: -2px; border-radius: 14px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      opacity: 0.3; z-index: -1; filter: blur(6px);
    }
    .chat-header h3 {
      font-size: 15px; font-weight: 600;
      background: linear-gradient(135deg, #e2e8f0, #94a3b8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .chat-header .subtitle { font-size: 11px; color: var(--text-secondary); margin-top: 1px; }
    .status-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #475569; transition: all 0.3s; }
    .status-dot.online { background: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.6); animation: glow-pulse 2s infinite; }
    @keyframes glow-pulse { 0%,100%{ box-shadow: 0 0 8px rgba(34,197,94,0.6) } 50%{ box-shadow: 0 0 16px rgba(34,197,94,0.4) } }

    /* ===== Messages ===== */
    .messages {
      flex: 1; overflow-y: auto; padding: 20px;
      display: flex; flex-direction: column; gap: 16px;
    }
    .messages::-webkit-scrollbar { width: 4px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: rgba(59,130,246,0.2); border-radius: 4px; }
    .messages::-webkit-scrollbar-thumb:hover { background: rgba(59,130,246,0.4); }

    .message { max-width: 82%; display: flex; flex-direction: column; animation: msg-in 0.3s ease-out; }
    @keyframes msg-in { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
    .message.bot { align-self: flex-start; }
    .message.user { align-self: flex-end; }

    .message .bubble {
      padding: 12px 16px; border-radius: 16px;
      font-size: 14px; line-height: 1.7; word-wrap: break-word;
    }
    .message.bot .bubble {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
      color: var(--text-primary);
      backdrop-filter: blur(8px);
    }
    .message.user .bubble {
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      border-bottom-right-radius: 4px;
      color: #fff;
      box-shadow: 0 4px 20px var(--glow-blue);
    }

    /* Markdown 样式 - 深色主题 */
    .message.bot .bubble h1,.message.bot .bubble h2,.message.bot .bubble h3 { margin: 8px 0 4px; font-size: 15px; color: #e2e8f0; }
    .message.bot .bubble p { margin: 4px 0; }
    .message.bot .bubble code {
      background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59,130,246,0.2);
      padding: 1px 6px; border-radius: 4px; font-family: 'Fira Code', monospace; font-size: 13px; color: #7dd3fc;
    }
    .message.bot .bubble pre {
      background: rgba(0,0,0,0.4); border: 1px solid var(--border);
      padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0;
    }
    .message.bot .bubble pre code { background: none; border: none; padding: 0; color: #a5f3fc; }
    .message.bot .bubble ul,.message.bot .bubble ol { padding-left: 18px; margin: 4px 0; }
    .message.bot .bubble li { margin: 2px 0; }
    .message.bot .bubble blockquote {
      border-left: 3px solid var(--blue); padding-left: 12px; margin: 6px 0;
      color: var(--text-secondary); font-style: italic;
    }
    .message.bot .bubble table { border-collapse: collapse; margin: 8px 0; font-size: 13px; width: 100%; }
    .message.bot .bubble th { background: rgba(59,130,246,0.1); padding: 6px 10px; border: 1px solid var(--border); color: #93c5fd; text-align: left; }
    .message.bot .bubble td { padding: 6px 10px; border: 1px solid var(--border); }
    .message.bot .bubble a { color: #60a5fa; text-decoration: none; }
    .message.bot .bubble a:hover { text-decoration: underline; }

    .message .meta { font-size: 11px; color: var(--text-muted); margin-top: 4px; padding: 0 4px; }
    .message.user .meta { text-align: right; }

    /* ===== Welcome ===== */
    .welcome {
      text-align: center; padding: 40px 24px;
      display: flex; flex-direction: column; align-items: center; gap: 16px;
    }
    .welcome-icon {
      width: 64px; height: 64px; border-radius: 20px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      display: flex; align-items: center; justify-content: center;
      font-size: 28px; box-shadow: 0 0 40px var(--glow-blue);
    }
    .welcome h3 {
      font-size: 18px; font-weight: 600;
      background: linear-gradient(135deg, #e2e8f0, #94a3b8);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .welcome p { font-size: 13px; color: var(--text-secondary); max-width: 280px; line-height: 1.6; }
    .quick-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 4px; }
    .quick-action {
      padding: 8px 14px; border-radius: 20px; font-size: 12px;
      background: var(--bg-card); border: 1px solid var(--border);
      color: var(--text-secondary); cursor: pointer;
      transition: all 0.2s;
    }
    .quick-action:hover {
      border-color: var(--border-hover); color: var(--text-primary);
      background: rgba(59,130,246,0.08); box-shadow: 0 0 12px var(--glow-blue);
    }

    /* ===== Typing ===== */
    .typing { display: none; align-self: flex-start; padding: 0 20px 4px; }
    .typing-inner {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; border-radius: 16px; border-bottom-left-radius: 4px;
      background: var(--bg-card); border: 1px solid var(--border);
    }
    .typing .dots { display: flex; gap: 4px; }
    .typing .dots span {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--blue); animation: t-bounce 1.4s infinite;
    }
    .typing .dots span:nth-child(2) { animation-delay: 0.2s; }
    .typing .dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes t-bounce { 0%,80%,100%{transform:translateY(0);opacity:0.4} 40%{transform:translateY(-6px);opacity:1} }
    .typing-label { font-size: 12px; color: var(--text-muted); }

    /* ===== Input ===== */
    .input-area {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      display: flex; gap: 10px; align-items: center;
      background: rgba(10, 14, 23, 0.85);
      backdrop-filter: blur(12px);
      flex-shrink: 0;
    }
    .input-area input {
      flex: 1; padding: 11px 16px;
      border: 1px solid var(--border); border-radius: 12px;
      font-size: 14px; outline: none;
      background: var(--bg-card); color: var(--text-primary);
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: inherit;
    }
    .input-area input::placeholder { color: var(--text-muted); }
    .input-area input:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.1), 0 0 12px var(--glow-blue);
    }
    .input-area input:disabled { opacity: 0.4; }
    .send-btn {
      width: 40px; height: 40px; border-radius: 12px;
      background: linear-gradient(135deg, var(--blue), var(--cyan));
      color: white; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; flex-shrink: 0;
      transition: transform 0.15s, box-shadow 0.2s;
      box-shadow: 0 4px 12px var(--glow-blue);
    }
    .send-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px var(--glow-blue); }
    .send-btn:active { transform: translateY(0) scale(0.95); }
    .send-btn:disabled { opacity: 0.3; cursor: not-allowed; transform: none; box-shadow: none; }

    /* ===== Footer ===== */
    .powered-by {
      text-align: center; padding: 6px;
      font-size: 10px; color: var(--text-muted);
      background: rgba(10, 14, 23, 0.6);
      flex-shrink: 0;
    }
    .powered-by a { color: rgba(59,130,246,0.5); text-decoration: none; }
    .powered-by a:hover { color: var(--blue); }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">
      <div class="chat-header-left">
        <div class="chat-avatar">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M20 21v-2a4 4 0 0 0-3-3.87"/><path d="M4 21v-2a4 4 0 0 1 3-3.87"/><circle cx="12" cy="17" r="1"/><path d="M9 17h6"/></svg>
        </div>
        <div>
          <h3 id="header-title">AIMason 智能助手</h3>
          <div class="subtitle">AI-Powered Smart Assistant</div>
        </div>
      </div>
      <div class="status-indicator">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">连接中...</span>
      </div>
    </div>

    <div class="messages" id="messages">
      <div class="welcome">
        <div class="welcome-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>
        </div>
        <h3>您好，欢迎使用 AIMason 智能助手</h3>
        <p>我是您的 AI 客服，有任何关于产品、服务的问题，都可以随时向我提问。</p>
        <div class="quick-actions">
          <div class="quick-action" onclick="quickSend('介绍一下 AIMason')">了解 AIMason</div>
          <div class="quick-action" onclick="quickSend('你们有哪些产品？')">产品咨询</div>
          <div class="quick-action" onclick="quickSend('如何联系客服？')">联系客服</div>
        </div>
      </div>
    </div>

    <div class="typing" id="typing-indicator">
      <div class="typing-inner">
        <div class="dots"><span></span><span></span><span></span></div>
        <span class="typing-label">AI 正在思考...</span>
      </div>
    </div>

    <div class="input-area">
      <input type="text" id="msg-input" placeholder="输入您的问题..." disabled autocomplete="off">
      <button class="send-btn" id="send-btn" onclick="sendMsg()" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>

    <div class="powered-by">Powered by <a href="https://xiaowu-iot.com" target="_blank">XiaoWu IoT</a> · AIMason</div>
  </div>

  <script>
    let ws = null;
    let visitorNum = Math.floor(Math.random() * 9000) + 1000;
    let userId = 'visitor_' + visitorNum;
    let userName = '用户' + visitorNum;
    let reconnectTimer = null;
    let reconnectCount = 0;

    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('msg-input');
    const sendBtnEl = document.getElementById('send-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const typingEl = document.getElementById('typing-indicator');

    // 从 URL 参数读取配置
    const params = new URLSearchParams(window.location.search);
    const chatId = params.get('chatId') || 'room_1';
    const botName = params.get('botName') || 'AIMason';
    if (params.get('title')) {
      document.getElementById('header-title').textContent = params.get('title');
    }

    function getWsUrl() {
      return (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
    }

    function connect() {
      if (ws && ws.readyState <= 1) return;
      statusText.textContent = '连接中...';
      statusDot.classList.remove('online');

      ws = new WebSocket(getWsUrl());

      ws.onopen = () => {
        statusDot.classList.add('online');
        statusText.textContent = '在线';
        inputEl.disabled = false;
        sendBtnEl.disabled = false;
        reconnectCount = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'system') return;
          if (msg.type === 'error') return;
          if (msg.messageId && msg.content && msg.senderId !== userId) {
            hideTyping();
            addBotMessage(msg.content, msg.senderName || botName, msg.timestamp);
          }
        } catch (e) { console.error('Parse error:', e); }
      };

      ws.onclose = () => {
        statusDot.classList.remove('online');
        statusText.textContent = '已断开';
        inputEl.disabled = true;
        sendBtnEl.disabled = true;
        reconnectCount++;
        const delay = Math.min(3000 * reconnectCount, 15000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {};
    }

    function quickSend(text) {
      inputEl.value = text;
      sendMsg();
    }

    function sendMsg() {
      const content = inputEl.value.trim();
      if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

      const welcome = messagesEl.querySelector('.welcome');
      if (welcome) welcome.remove();

      addUserMessage(content);
      inputEl.value = '';

      ws.send(JSON.stringify({
        messageId: 'msg_' + Date.now(),
        chatId: chatId,
        senderId: userId,
        senderName: userName,
        content: content,
        messageType: 'text',
        timestamp: Date.now(),
      }));

      showTyping();
    }

    function addUserMessage(text) {
      const div = document.createElement('div');
      div.className = 'message user';
      const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      div.innerHTML = \`
        <div class="bubble">\${escapeHtml(text)}</div>
        <div class="meta">\${userName} · \${time}</div>
      \`;
      messagesEl.appendChild(div);
      scrollToBottom();
    }

    function addBotMessage(text, name, timestamp) {
      const welcome = messagesEl.querySelector('.welcome');
      if (welcome) welcome.remove();

      const div = document.createElement('div');
      div.className = 'message bot';
      const parsed = typeof marked !== 'undefined' ? marked.parse(text, { breaks: true }) : escapeHtml(text);
      const time = timestamp ? new Date(timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      div.innerHTML = \`
        <div class="bubble">\${parsed}</div>
        <div class="meta">\${escapeHtml(name || botName)} · \${time}</div>
      \`;
      messagesEl.appendChild(div);
      scrollToBottom();
    }

    function showTyping() { typingEl.style.display = 'flex'; scrollToBottom(); }
    function hideTyping() { typingEl.style.display = 'none'; }

    function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

    function escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = String(text);
      return d.innerHTML;
    }

    inputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMsg(); });

    if (window.parent !== window) {
      window.parent.postMessage({ type: 'openclaw-chat-ready' }, '*');
    }

    connect();
  </script>
</body>
</html>
  `;
}

function getAdminHtmlPage() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Web Chat Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; color: #333; }

    /* Header */
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); color: white; padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
    .header h1 { font-size: 20px; font-weight: 600; }
    .header-right { display: flex; align-items: center; gap: 16px; font-size: 14px; }
    .server-status { display: flex; align-items: center; gap: 6px; }
    .server-status .dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .header a { color: #90caf9; text-decoration: none; font-size: 13px; }
    .header a:hover { color: #fff; }

    /* Overview Cards */
    .overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding: 24px 32px 0; }
    .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card-label { font-size: 13px; color: #888; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 28px; font-weight: 700; color: #1a1a2e; }
    .card-sub { font-size: 12px; color: #999; margin-top: 4px; }

    /* Tabs */
    .tabs { display: flex; gap: 0; padding: 24px 32px 0; }
    .tab { padding: 10px 24px; background: #e0e0e0; border: none; cursor: pointer; font-size: 14px; font-weight: 500; color: #666; border-radius: 8px 8px 0 0; transition: all 0.2s; }
    .tab:hover { background: #d0d0d0; }
    .tab.active { background: white; color: #1a1a2e; box-shadow: 0 -2px 4px rgba(0,0,0,0.05); }

    /* Tab Content */
    .tab-content { background: white; margin: 0 32px; border-radius: 0 12px 12px 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); min-height: 400px; margin-bottom: 32px; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* Connection Cards */
    .conn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .conn-card { border: 1px solid #e8e8e8; border-radius: 10px; padding: 16px; }
    .conn-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .conn-title { font-weight: 600; font-size: 15px; }
    .status-badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .status-connected { background: #e8f5e9; color: #2e7d32; }
    .status-disconnected { background: #ffebee; color: #c62828; }
    .status-error { background: #fff3e0; color: #e65100; }
    .conn-details { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; }
    .conn-details dt { color: #888; }
    .conn-details dd { color: #333; font-weight: 500; text-align: right; }

    /* Connection History */
    .history-table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    .history-table th { text-align: left; padding: 8px 12px; background: #f5f5f5; color: #666; font-weight: 600; border-bottom: 2px solid #e0e0e0; }
    .history-table td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
    .event-connected { color: #2e7d32; }
    .event-disconnected { color: #c62828; }
    .event-error { color: #e65100; }

    /* Charts */
    .chart-section { margin-bottom: 24px; }
    .chart-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: #333; }
    .chart-container { position: relative; width: 100%; height: 220px; background: #fafafa; border-radius: 8px; border: 1px solid #eee; }
    canvas { width: 100% !important; height: 100% !important; }

    /* Stats Grid */
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 900px) { .stats-grid { grid-template-columns: 1fr; } }

    /* Active Users Table */
    .user-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .user-table th { text-align: left; padding: 10px 12px; background: #f5f5f5; color: #666; font-weight: 600; }
    .user-table td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
    .user-table tr:hover { background: #f8f9fa; }
    .rank { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; font-size: 12px; font-weight: 700; }
    .rank-1 { background: #fff3e0; color: #e65100; }
    .rank-2 { background: #f3e5f5; color: #7b1fa2; }
    .rank-3 { background: #e3f2fd; color: #1565c0; }

    /* Distribution */
    .dist-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .dist-label { width: 100px; font-size: 13px; color: #666; text-align: right; flex-shrink: 0; }
    .dist-bar-bg { flex: 1; height: 24px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
    .dist-bar { height: 100%; border-radius: 4px; transition: width 0.5s ease; display: flex; align-items: center; padding-left: 8px; font-size: 11px; color: white; font-weight: 600; min-width: 30px; }
    .pie-container { width: 180px; height: 180px; border-radius: 50%; margin: 0 auto 16px; }
    .pie-legend { display: flex; justify-content: center; gap: 24px; font-size: 13px; }
    .pie-legend-item { display: flex; align-items: center; gap: 6px; }
    .pie-legend-dot { width: 10px; height: 10px; border-radius: 50%; }

    /* Account Table */
    .acc-table-wrapper { overflow-x: auto; }
    .acc-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 800px; }
    .acc-table th { text-align: left; padding: 12px; background: #f5f5f5; color: #666; font-weight: 600; border-bottom: 2px solid #e0e0e0; white-space: nowrap; }
    .acc-table td { padding: 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
    .acc-table tr:hover { background: #f8f9fa; }
    .toggle-btn { padding: 4px 12px; border: 1px solid #ddd; border-radius: 6px; background: white; cursor: pointer; font-size: 12px; transition: all 0.2s; }
    .toggle-btn:hover { background: #f5f5f5; }
    .toggle-btn.enabled { border-color: #4caf50; color: #2e7d32; }
    .toggle-btn.disabled { border-color: #ef5350; color: #c62828; }
    .protocol-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .protocol-web-chat { background: #e3f2fd; color: #1565c0; }
    .protocol-ruyuan { background: #fce4ec; color: #c62828; }

    /* Config Panel */
    .config-panel { margin-top: 8px; background: #f8f9fa; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; display: none; border: 1px solid #e8e8e8; }
    .config-toggle { color: #1976d2; cursor: pointer; font-size: 12px; text-decoration: underline; }

    /* Empty State */
    .empty-state { text-align: center; padding: 40px; color: #999; }
    .empty-state h3 { color: #666; margin-bottom: 8px; }

    /* Refresh indicator */
    .refresh-indicator { font-size: 12px; color: #999; }
    .refresh-indicator.active { color: #4caf50; }
  </style>
</head>
<body>
  <div class="header">
    <h1>OpenClaw Web Chat Admin</h1>
    <div class="header-right">
      <div class="server-status">
        <span class="dot" id="ws-status-dot"></span>
        <span id="ws-status-text">Connecting...</span>
      </div>
      <span class="refresh-indicator" id="refresh-indicator">Auto-refresh: 5s</span>
      <a href="/">Chat UI</a>
    </div>
  </div>

  <!-- Overview Cards -->
  <div class="overview">
    <div class="card">
      <div class="card-label">Online Clients</div>
      <div class="card-value" id="stat-online">0</div>
      <div class="card-sub">WebSocket connections</div>
    </div>
    <div class="card">
      <div class="card-label">Total Messages</div>
      <div class="card-value" id="stat-total-msg">0</div>
      <div class="card-sub" id="stat-today-msg">Today: 0</div>
    </div>
    <div class="card">
      <div class="card-label">This Hour</div>
      <div class="card-value" id="stat-hour-msg">0</div>
      <div class="card-sub">messages</div>
    </div>
    <div class="card">
      <div class="card-label">Uptime</div>
      <div class="card-value" id="stat-uptime">0s</div>
      <div class="card-sub" id="stat-started">Started: --</div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab active" data-tab="connections" onclick="switchTab('connections')">Connections</button>
    <button class="tab" data-tab="messages" onclick="switchTab('messages')">Messages</button>
    <button class="tab" data-tab="accounts" onclick="switchTab('accounts')">Accounts</button>
  </div>

  <!-- Tab Content -->
  <div class="tab-content">
    <!-- Connections Tab -->
    <div class="tab-panel active" id="panel-connections">
      <div class="conn-grid" id="conn-grid"></div>
      <h3 style="margin-top:24px; font-size:15px; color:#333;">Recent Connection Events</h3>
      <table class="history-table">
        <thead><tr><th>Time</th><th>Event</th><th>User</th><th>Client ID</th></tr></thead>
        <tbody id="conn-history"></tbody>
      </table>
    </div>

    <!-- Messages Tab -->
    <div class="tab-panel" id="panel-messages">
      <div class="chart-section">
        <div class="chart-title">Message Volume (Last 24 Hours)</div>
        <div class="chart-container"><canvas id="chart-hourly"></canvas></div>
      </div>
      <div class="stats-grid">
        <div>
          <div class="chart-title">Active Users (Top 20)</div>
          <table class="user-table">
            <thead><tr><th>#</th><th>User</th><th>Messages</th><th>Last Active</th></tr></thead>
            <tbody id="active-users"></tbody>
          </table>
        </div>
        <div>
          <div class="chart-title">Chat Type Distribution</div>
          <div id="pie-chart" style="margin-bottom:24px;"></div>
          <div class="chart-title">Messages by Channel</div>
          <div id="chat-distribution"></div>
          <div class="chart-title" style="margin-top:24px;">Message Types</div>
          <div id="type-distribution"></div>
        </div>
      </div>
    </div>

    <!-- Accounts Tab -->
    <div class="tab-panel" id="panel-accounts">
      <div class="acc-table-wrapper"><table class="acc-table">
        <thead>
          <tr>
            <th>Account ID</th>
            <th>WebSocket URL</th>
            <th>API URL</th>
            <th>Token</th>
            <th>Mode</th>
            <th>Protocol</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="acc-table-body"></tbody>
      </table></div>
    </div>
  </div>

  <script>
    // ==================== State ====================
    let ws = null;
    let currentTab = 'connections';
    let statsCache = {};

    // ==================== WebSocket ====================
    function connectAdminWS() {
      const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/admin';
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        document.getElementById('ws-status-dot').style.background = '#4caf50';
        document.getElementById('ws-status-text').textContent = 'Connected';
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleAdminMessage(msg);
        } catch (e) { console.error('Parse error:', e); }
      };

      ws.onclose = () => {
        document.getElementById('ws-status-dot').style.background = '#ef5350';
        document.getElementById('ws-status-text').textContent = 'Disconnected';
        setTimeout(connectAdminWS, 3000);
      };

      ws.onerror = () => {};
    }

    function handleAdminMessage(msg) {
      if (msg.type === 'stats_refresh') {
        updateOverviewCards(msg.data);
      }
      if (msg.type === 'message_event' || msg.type === 'connection_update') {
        refreshCurrentTab();
      }
    }

    // ==================== API ====================
    async function fetchJSON(url) {
      const res = await fetch(url);
      const data = await res.json();
      return data.ok ? data.data : null;
    }

    // ==================== Tab Switching ====================
    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.tab[data-tab="' + tab + '"]').classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById('panel-' + tab).classList.add('active');
      refreshCurrentTab();
    }

    async function refreshCurrentTab() {
      if (currentTab === 'connections') await refreshConnections();
      else if (currentTab === 'messages') await refreshMessages();
      else if (currentTab === 'accounts') await refreshAccounts();
    }

    // ==================== Overview Cards ====================
    function updateOverviewCards(data) {
      if (data.onlineClients !== undefined) document.getElementById('stat-online').textContent = data.onlineClients;
      if (data.totalMessages !== undefined) document.getElementById('stat-total-msg').textContent = data.totalMessages;
      if (data.todayMessages !== undefined) document.getElementById('stat-today-msg').textContent = 'Today: ' + data.todayMessages;
    }

    async function refreshOverview() {
      const data = await fetchJSON('/admin/api/overview');
      if (!data) return;
      document.getElementById('stat-online').textContent = data.onlineClients;
      document.getElementById('stat-total-msg').textContent = data.totalMessages;
      document.getElementById('stat-today-msg').textContent = 'Today: ' + data.todayMessages;
      document.getElementById('stat-hour-msg').textContent = data.thisHourMessages;
      document.getElementById('stat-uptime').textContent = formatUptime(data.uptime);
    }

    function formatUptime(ms) {
      const s = Math.floor(ms / 1000);
      if (s < 60) return s + 's';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ' + (s % 60) + 's';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ' + (m % 60) + 'm';
      const d = Math.floor(h / 24);
      return d + 'd ' + (h % 24) + 'h';
    }

    // ==================== Connections Tab ====================
    async function refreshConnections() {
      const data = await fetchJSON('/admin/api/connections');
      if (!data) return;

      // Account cards
      const grid = document.getElementById('conn-grid');
      grid.innerHTML = data.accounts.map(acc => {
        const statusClass = acc.status === 'connected' ? 'status-connected' :
                           acc.status === 'error' ? 'status-error' : 'status-disconnected';
        return \`
          <div class="conn-card">
            <div class="conn-header">
              <span class="conn-title">\${esc(acc.accountId)}</span>
              <span class="status-badge \${statusClass}">\${acc.status}</span>
            </div>
            <dl class="conn-details">
              <dt>Mode</dt><dd>\${acc.connectionMode}</dd>
              <dt>Protocol</dt><dd>\${acc.protocol}</dd>
              <dt>Online Clients</dt><dd>\${acc.onlineClients}</dd>
              <dt>Uptime</dt><dd>\${acc.uptime ? formatUptime(acc.uptime) : '--'}</dd>
              <dt>Reconnects</dt><dd>\${acc.reconnectCount}</dd>
              <dt>Last Error</dt><dd>\${acc.lastError || 'None'}</dd>
            </dl>
          </div>
        \`;
      }).join('');

      // Connection history
      const tbody = document.getElementById('conn-history');
      tbody.innerHTML = data.recentEvents.slice().reverse().slice(0, 30).map(e => {
        const evtClass = e.event === 'connected' ? 'event-connected' :
                        e.event === 'error' ? 'event-error' : 'event-disconnected';
        return \`<tr>
          <td>\${new Date(e.timestamp).toLocaleTimeString()}</td>
          <td class="\${evtClass}">\${e.event}</td>
          <td>\${esc(e.userName || '--')}</td>
          <td>\${esc(e.clientId || '--')}</td>
        </tr>\`;
      }).join('');
    }

    // ==================== Messages Tab ====================
    async function refreshMessages() {
      const [stats, users, dist] = await Promise.all([
        fetchJSON('/admin/api/messages/stats'),
        fetchJSON('/admin/api/messages/active-users'),
        fetchJSON('/admin/api/messages/distribution'),
      ]);

      if (stats) {
        document.getElementById('stat-hour-msg').textContent = stats.thisHour;
        drawHourlyChart(stats.hourly);
      }

      if (users) {
        const tbody = document.getElementById('active-users');
        if (users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">No message data yet</td></tr>';
        } else {
          tbody.innerHTML = users.map((u, i) => {
            const rankClass = i < 3 ? 'rank-' + (i + 1) : '';
            return \`<tr>
              <td><span class="rank \${rankClass}">\${i + 1}</span></td>
              <td>\${esc(u.senderName)}</td>
              <td>\${u.count}</td>
              <td>\${new Date(u.lastActive).toLocaleTimeString()}</td>
            </tr>\`;
          }).join('');
        }
      }

      if (dist) {
        renderPieChart(dist.directCount, dist.channelCount);
        renderDistribution('chat-distribution', dist.byChat, 'chatId', '#42a5f5');
        renderDistribution('type-distribution', dist.byType, 'type', '#ab47bc');
      }
    }

    // ==================== Canvas Chart ====================
    function drawHourlyChart(hourly) {
      const canvas = document.getElementById('chart-hourly');
      const ctx = canvas.getContext('2d');
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.scale(2, 2);
      const w = rect.width, h = rect.height;

      ctx.clearRect(0, 0, w, h);
      if (!hourly || hourly.length === 0) return;

      const maxVal = Math.max(...hourly.map(h => h.count), 1);
      const barW = (w - 60) / hourly.length;
      const chartH = h - 40;
      const startX = 45;

      // Grid lines
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = 10 + (chartH / 4) * i;
        ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(w - 10, y); ctx.stroke();
        ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * (4 - i) / 4), startX - 5, y + 3);
      }

      // Bars
      hourly.forEach((item, i) => {
        const barH = (item.count / maxVal) * chartH;
        const x = startX + i * barW + barW * 0.15;
        const bw = barW * 0.7;
        const y = 10 + chartH - barH;

        const gradient = ctx.createLinearGradient(x, y, x, 10 + chartH);
        gradient.addColorStop(0, '#42a5f5');
        gradient.addColorStop(1, '#1976d2');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, barH, [3, 3, 0, 0]);
        ctx.fill();

        // X labels (every 3 hours)
        if (i % 3 === 0) {
          ctx.fillStyle = '#999'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(item.hour, startX + i * barW + barW / 2, h - 5);
        }
      });
    }

    // ==================== Pie Chart (CSS) ====================
    function renderPieChart(direct, channel) {
      const total = direct + channel;
      const container = document.getElementById('pie-chart');
      if (total === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">No data</div>';
        return;
      }
      const directPct = ((direct / total) * 100).toFixed(1);
      const channelPct = ((channel / total) * 100).toFixed(1);
      container.innerHTML = \`
        <div class="pie-container" style="background: conic-gradient(#42a5f5 0% \${channelPct}%, #ef5350 \${channelPct}% 100%);"></div>
        <div class="pie-legend">
          <div class="pie-legend-item"><span class="pie-legend-dot" style="background:#42a5f5"></span> Channel (\${channel})</div>
          <div class="pie-legend-item"><span class="pie-legend-dot" style="background:#ef5350"></span> Direct (\${direct})</div>
        </div>
      \`;
    }

    // ==================== Bar Distribution ====================
    function renderDistribution(containerId, items, labelKey, color) {
      const container = document.getElementById(containerId);
      if (!items || items.length === 0) {
        container.innerHTML = '<div style="color:#999;font-size:13px;">No data</div>';
        return;
      }
      const maxVal = Math.max(...items.map(i => i.count), 1);
      const colors = ['#42a5f5', '#66bb6a', '#ab47bc', '#ef5350', '#ffa726', '#26c6da', '#8d6e63', '#78909c'];
      container.innerHTML = items.map((item, idx) => {
        const pct = (item.count / maxVal * 100).toFixed(0);
        const c = colors[idx % colors.length];
        return \`<div class="dist-row">
          <span class="dist-label">\${esc(item[labelKey])}</span>
          <div class="dist-bar-bg"><div class="dist-bar" style="width:\${pct}%;background:\${c}">\${item.count}</div></div>
        </div>\`;
      }).join('');
    }

    // ==================== Accounts Tab ====================
    async function refreshAccounts() {
      const data = await fetchJSON('/admin/api/accounts');
      if (!data) return;

      const tbody = document.getElementById('acc-table-body');
      tbody.innerHTML = data.map(acc => {
        const statusClass = acc.status === 'connected' ? 'status-connected' :
                           acc.status === 'error' ? 'status-error' : 'status-disconnected';
        const protocolClass = acc.protocol === 'ruyuan' ? 'protocol-ruyuan' : 'protocol-web-chat';
        const toggleClass = acc.enabled ? 'enabled' : 'disabled';
        const toggleText = acc.enabled ? 'Enabled' : 'Disabled';
        return \`<tr>
          <td><strong>\${esc(acc.accountId)}</strong></td>
          <td style="font-family:monospace;font-size:12px;">\${esc(acc.wsUrl || '--')}</td>
          <td style="font-family:monospace;font-size:12px;">\${esc(acc.apiUrl || '--')}</td>
          <td style="font-family:monospace;font-size:12px;">\${acc.apiToken || '--'}</td>
          <td>\${acc.connectionMode}</td>
          <td><span class="protocol-badge \${protocolClass}">\${acc.protocol}</span></td>
          <td><span class="status-badge \${statusClass}">\${acc.status}</span></td>
          <td>
            <button class="toggle-btn \${toggleClass}" onclick="toggleAccount('\${acc.accountId}')">\${toggleText}</button>
            <span class="config-toggle" onclick="toggleConfig(this)">Config</span>
            <div class="config-panel">\${JSON.stringify(acc, null, 2)}</div>
          </td>
        </tr>\`;
      }).join('');
    }

    async function toggleAccount(accountId) {
      await fetch('/admin/api/accounts/' + encodeURIComponent(accountId) + '/toggle', { method: 'POST' });
      refreshAccounts();
    }

    function toggleConfig(el) {
      const panel = el.nextElementSibling;
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    }

    // ==================== Utility ====================
    function esc(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    }

    // ==================== Uptime Timer ====================
    const serverStartedAt = Date.now(); // approximate
    setInterval(() => {
      const uptime = Date.now() - serverStartedAt;
      document.getElementById('stat-uptime').textContent = formatUptime(uptime);
    }, 1000);

    // ==================== Init ====================
    connectAdminWS();
    refreshOverview();
    refreshCurrentTab();

    // Periodic refresh
    setInterval(() => {
      refreshOverview();
      refreshCurrentTab();
    }, 5000);
  </script>
</body>
</html>
  `;
}

function getHtmlPage() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Web Chat</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; display: flex; height: 100vh; }
    .sidebar { width: 260px; background: #fff; border-right: 1px solid #e0e0e0; display: flex; flex-direction: column; }
    .sidebar-header { padding: 20px; border-bottom: 1px solid #e0e0e0; }
    .sidebar-header h2 { font-size: 18px; color: #333; }
    .room-list { flex: 1; overflow-y: auto; padding: 10px; }
    .room-item { padding: 12px 16px; margin: 4px 0; border-radius: 8px; cursor: pointer; transition: background 0.2s; }
    .room-item:hover { background: #f0f0f0; }
    .room-item.active { background: #e3f2fd; color: #1976d2; }
    .main { flex: 1; display: flex; flex-direction: column; background: #fff; }
    .header { padding: 16px 24px; border-bottom: 1px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; }
    .header h3 { font-size: 16px; color: #333; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; }
    .status-dot.connected { background: #4caf50; }
    .messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .message { max-width: 80%; padding: 12px 16px; border-radius: 12px; position: relative; }
    .message.own { align-self: flex-end; background: #e3f2fd; }
    .message.other { align-self: flex-start; background: #f5f5f5; }
    .message.system { align-self: center; background: #fff3e0; color: #e65100; font-size: 14px; }
    .message .sender { font-weight: 600; font-size: 13px; color: #666; margin-bottom: 4px; }
    .message .content { font-size: 15px; line-height: 1.5; word-wrap: break-word; }
    .message .content h1, .message .content h2, .message .content h3 { margin: 8px 0; }
    .message .content p { margin: 8px 0; }
    .message .content code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .message .content pre { background: #f5f5f5; padding: 12px; border-radius: 8px; overflow-x: auto; }
    .message .content pre code { background: none; padding: 0; }
    .message .content ul, .message .content ol { margin: 8px 0; padding-left: 20px; }
    .message .content blockquote { border-left: 4px solid #ddd; padding-left: 12px; margin: 8px 0; color: #666; }
    .message .content table { border-collapse: collapse; margin: 8px 0; }
    .message .content th, .message .content td { border: 1px solid #ddd; padding: 8px 12px; }
    .message .content th { background: #f5f5f5; }
    .message .time { font-size: 11px; color: #999; margin-top: 4px; text-align: right; }
    .input-area { padding: 16px 24px; border-top: 1px solid #e0e0e0; display: flex; gap: 12px; }
    .input-area input { flex: 1; padding: 12px 16px; border: 1px solid #ddd; border-radius: 8px; font-size: 15px; }
    .input-area button { padding: 12px 24px; background: #1976d2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 15px; }
    .input-area button:hover { background: #1565c0; }
    .input-area button:disabled { background: #ccc; cursor: not-allowed; }
    .welcome-message { text-align: center; padding: 40px; color: #666; }
    .welcome-message h3 { margin-bottom: 12px; color: #333; }
  </style>
</head>
<body>
  <div class="container">
    <div class="sidebar">
      <div class="sidebar-header">
        <h2>💬 OpenClaw Web Chat</h2>
      </div>
      <div class="room-list" id="room-list">
        <div class="room-item active" data-room="room_1">🌐 General</div>
        <div class="room-item" data-room="room_2">💻 Tech</div>
        <div class="room-item" data-room="room_3">🎮 Gaming</div>
      </div>
    </div>
    <div class="main">
      <div class="header">
        <h3 id="room-name">General Chat</h3>
        <div class="status">
          <span class="status-dot" id="status-dot"></span>
          <span id="status-text">Disconnected</span>
        </div>
      </div>
      <div class="messages" id="messages">
        <div class="welcome-message">
          <h3>Welcome to OpenClaw Web Chat! 👋</h3>
          <p>Connect to start chatting with AI</p>
        </div>
      </div>
      <div class="input-area">
        <input type="text" id="message-input" placeholder="Type a message..." disabled>
        <button id="send-btn" onclick="sendChatMessage()" disabled>Send</button>
      </div>
    </div>
  </div>

  <script>
    let ws = null;
    let userId = 'user_' + Math.random().toString(36).slice(2, 8);
    let userName = 'User_' + Math.floor(Math.random() * 1000);
    let currentRoom = 'room_1';
    let reconnectTimer = null;

    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    function connect() {
      const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
      console.log('Connecting to', wsUrl);
      
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('Connected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
        inputEl.disabled = false;
        sendBtn.disabled = false;
        messagesEl.innerHTML = '';
        addSystemMessage('Connected to chat server');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          console.log('Received:', msg);
          
          if (msg.type === 'system') {
            addSystemMessage(msg.message);
          } else if (msg.messageId && msg.content) {
            addMessage(msg);
          }
        } catch (err) {
          console.error('Parse error:', err);
        }
      };

      ws.onclose = () => {
        console.log('Disconnected');
        statusDot.classList.remove('connected');
        statusText.textContent = 'Disconnected';
        inputEl.disabled = true;
        sendBtn.disabled = true;
        
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    }

    function addMessage(msg) {
      const div = document.createElement('div');
      const isOwn = msg.senderId === userId;
      div.className = 'message ' + (isOwn ? 'own' : 'other');
      
      const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
      
      // Parse Markdown content
      const parsedContent = marked.parse(msg.content || '', { breaks: true });
      
      div.innerHTML = \`
        <div class="sender">\${escapeHtml(msg.senderName || msg.senderId)}</div>
        <div class="content">\${parsedContent}</div>
        <div class="time">\${time}</div>
      \`;
      
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addSystemMessage(text) {
      const div = document.createElement('div');
      div.className = 'message system';
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function sendChatMessage() {
      const content = inputEl.value.trim();
      if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

      const msg = {
        messageId: 'msg_' + Date.now(),
        chatId: currentRoom,
        senderId: userId,
        senderName: userName,
        content: content,
        messageType: 'text',
        timestamp: Date.now(),
      };

      ws.send(JSON.stringify(msg));
      inputEl.value = '';
    }

    inputEl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    document.querySelectorAll('.room-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.room-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        currentRoom = item.dataset.room;
        document.getElementById('room-name').textContent = item.textContent;
        messagesEl.innerHTML = '';
        addSystemMessage('Switched to: ' + item.textContent);
      });
    });

    connect();
  </script>
</body>
</html>
  `;
}
