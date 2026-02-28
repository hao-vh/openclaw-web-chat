#!/bin/bash
#
# XiaoWu Plugin 一键安装脚本
# 在任何 OpenClaw 环境中快速安装 XiaoWu Web Chat 插件
#
# 使用方法:
#   curl -fsSL https://raw.githubusercontent.com/your-repo/xiaowu-plugin/main/install.sh | bash
#   或
#   bash install-xiaowu.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
PLUGIN_NAME="xiaowu"
PLUGIN_VERSION="1.3.0"
INSTALL_DIR="${HOME}/.openclaw/extensions/xiaowu"
BACKUP_DIR="${HOME}/.openclaw/backups/xiaowu-$(date +%Y%m%d-%H%M%S)"

# 日志函数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查 OpenClaw
check_openclaw() {
    log_info "检查 OpenClaw 安装状态..."
    
    if ! command -v openclaw &> /dev/null; then
        if [ -f "${HOME}/.npm-global/bin/openclaw" ]; then
            export PATH="${HOME}/.npm-global/bin:$PATH"
        else
            log_error "OpenClaw 未安装！请先安装 OpenClaw"
            echo "安装指南: https://docs.openclaw.ai/getting-started"
            exit 1
        fi
    fi
    
    log_success "OpenClaw 已安装"
}

# 检查 Node.js
check_nodejs() {
    log_info "检查 Node.js..."
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装！"
        exit 1
    fi
    log_success "Node.js 版本: $(node --version)"
}

# 备份现有安装
backup_existing() {
    if [ -d "$INSTALL_DIR" ]; then
        log_warn "发现现有安装，备份到: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
        cp -r "$INSTALL_DIR"/* "$BACKUP_DIR/" 2>/dev/null || true
    fi
}

# 安装插件
install_plugin() {
    log_info "安装 XiaoWu 插件..."
    
    # 创建安装目录
    mkdir -p "$INSTALL_DIR"
    
    # 复制当前目录下的插件文件
    cp -r ./* "$INSTALL_DIR/"
    
    # 安装依赖
    cd "$INSTALL_DIR"
    npm install --production
    
    log_success "插件安装完成"
}

# 配置 OpenClaw
configure_openclaw() {
    log_info "配置 OpenClaw..."
    
    node << 'EOF'
const fs = require('fs');
const path = require('path');
const home = process.env.HOME;
const configPath = path.join(home, '.openclaw/openclaw.json');

let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 添加插件配置
config.plugins = config.plugins || { entries: {}, installs: {} };
config.plugins.entries.xiaowu = { enabled: true };
config.plugins.installs.xiaowu = {
    source: "local",
    sourcePath: path.join(home, ".openclaw/extensions/xiaowu"),
    version: "1.3.0",
    installedAt: new Date().toISOString()
};

// 添加频道配置
config.channels = config.channels || {};
config.channels.xiaowu = {
    enabled: true,
    wsUrl: "ws://localhost:3456/ws",
    apiUrl: "http://localhost:3456",
    connectionMode: "websocket",
    autoReconnect: true,
    dmPolicy: "open",
    groupPolicy: "open"
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('配置完成');
EOF
}

# 重启 Gateway
restart_gateway() {
    log_info "重启 OpenClaw Gateway..."
    openclaw gateway restart 2>/dev/null || {
        log_warn "Gateway 重启失败，请手动重启"
    }
}

# 打印使用说明
print_usage() {
    cat << 'EOF'

========================================
  🎉 XiaoWu 插件安装完成！
========================================

📁 安装目录: ~/.openclaw/extensions/xiaowu

🚀 快速开始:

1. 启动测试服务器:
   cd ~/.openclaw/extensions/xiaowu
   node example-server.js

2. 打开浏览器访问:
   http://localhost:3456

3. 在聊天室发送消息，AI 将自动回复

📖 查看文档:
   cat ~/.openclaw/extensions/xiaowu/README.md

🔧 配置说明:
   配置文件: ~/.openclaw/openclaw.json
   
   修改 xiaowu 配置:
   {
     "channels": {
       "xiaowu": {
         "enabled": true,
         "wsUrl": "ws://localhost:3456/ws",
         "apiUrl": "http://localhost:3456"
       }
     }
   }

📊 查看日志:
   tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep xiaowu

========================================
EOF
}

# 主函数
main() {
    echo "========================================"
    echo "  XiaoWu Plugin 安装程序 v1.3.0"
    echo "========================================"
    echo ""
    
    check_openclaw
    check_nodejs
    backup_existing
    install_plugin
    configure_openclaw
    restart_gateway
    
    print_usage
}

main "$@"
