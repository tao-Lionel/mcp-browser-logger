# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

**重要规则：请优先使用中文回复用户。**

## 项目概述

这是一个 **MCP (Model Context Protocol) 服务器**，通过 Chrome DevTools Protocol (CDP) 连接到浏览器，用于收集控制台日志和网络请求。服务器暴露了 MCP 工具，允许 Claude Code 实时检查浏览器活动。

## 开发命令

```bash
# 构建项目
npm run build

# 开发模式（监听文件变化）
npm run watch

# 构建并立即运行
npm run dev

# 运行已构建的服务器
npm start
```

## 架构设计

整个 MCP 服务器在单个文件 [src/index.ts](src/index.ts) 中实现。架构流程如下：

### 连接流程
**Chrome/Edge:**
1. 用户使用 `--remote-debugging-port=9222` 启动 Chrome/Edge
2. MCP 服务器从 `http://localhost:9222/json` 获取可用标签页
3. 通过 WebSocket 连接到指定标签页的 WebSocket 调试 URL
4. 启用 CDP 域：`Runtime`、`Log`、`Network`、`Console`

**Firefox:**
1. 用户使用 `--start-debugger-server 6000` 启动 Firefox
2. MCP 服务器从 `http://localhost:6000/json/list` 获取可用标签页
3. 通过 WebSocket 连接到指定标签页的 actor
4. 订阅 `consoleAPICall` 和 `pageError` 事件

### 数据收集

**Chrome/Edge:**
- **控制台消息**：通过 `Runtime.consoleAPICalled` 和 `Log.entryAdded` 事件捕获
- **网络请求**：由 `Network.requestWillBeSent` 发起，`Network.responseReceived` 完成
- **JavaScript 异常**：通过 `Runtime.exceptionThrown` 捕获

**Firefox:**
- **控制台消息**：通过 `consoleAPICall` 事件捕获
- **JavaScript 异常**：通过 `pageError` 事件捕获
- **网络请求**：暂不支持（Firefox 调试协议不直接提供网络事件）

### 内存存储
- `browser.messages[]`：控制台消息（最多 1000 条）
- `browser.networkRequests[]`：网络请求（最多 1000 条）
- 当超过容量时，两个数组都实现 FIFO 队列

### 暴露的 MCP 工具

- `connect_browser` - 建立与浏览器的 WebSocket 连接（支持 Chrome 和 Firefox）
- `get_browser_tabs` - 列出浏览器中所有可用的标签页
- `disconnect_browser` - 关闭 WebSocket 连接
- `get_console_logs` - 获取控制台日志，支持按级别过滤
- `get_network_requests` - 获取网络请求，支持按方法过滤
- `clear_logs` - 清空所有缓存的日志和请求
- `evaluate_javascript` - 在浏览器上下文中执行 JavaScript 代码
- `get_browser_info` - 获取浏览器 User Agent 和版本信息

### CDP 命令模式

**Chrome/Edge:**
`sendCommand()` 函数实现了基于 Promise 的 CDP 命令包装器，使用 `nextMessageId` 进行请求-响应关联。每个命令发送 JSON 消息并等待匹配 ID 的响应。

**Firefox:**
`sendFirefoxCommand()` 函数发送 Firefox 调试协议命令。Firefox 协议是单向的，不等待响应。

## 重要实现细节

- **语言**：TypeScript，目标 ES2022，Node16 模块
- **WebSocket 客户端**：使用 `ws` 库进行 CDP 连接
- **传输方式**：MCP stdio 传输（通过 stdin/stdout 通信）
- **错误处理**：所有 MCP 工具错误返回带 `isError: true` 的格式化文本
- **消息关联**：使用递增的 `nextMessageId` 匹配 CDP 命令响应
- **语言环境**：日志时间戳使用中文语言环境（`zh-CN`）格式化
- **浏览器支持**：同时支持 Chrome/Edge 和 Firefox 浏览器
- **标签页选择**：使用 `get_browser_tabs` 查看所有标签页，然后用 `tabIndex` 参数选择要连接的标签页
