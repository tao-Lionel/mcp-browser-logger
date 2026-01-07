# MCP Browser Logger

一个 MCP（Model Context Protocol）服务器，用于通过 Chrome DevTools Protocol 收集浏览器控制台日志和网络请求。

## 功能

- 📡 **实时日志捕获**：捕获浏览器控制台的所有日志（console.log、error、warn、info、debug）
- 🌐 **网络请求监控**：记录所有网络请求和响应，包括状态码、请求头、响应时间等
- 🐛 **异常捕获**：自动捕获 JavaScript 异常和堆栈跟踪
- 💻 **远程代码执行**：在浏览器上下文中执行 JavaScript 代码
- 🔍 **灵活过滤**：支持按日志级别、请求方法等条件过滤

## 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/mcp-browser-logger.git
cd mcp-browser-logger

# 安装依赖
npm install

# 构建
npm run build
```

## 配置

### 方法 1：项目级配置（推荐）

在你的项目根目录创建 `.mcp.json` 文件：

```json
{
  "mcpServers": {
    "browser-logger": {
      "command": "node",
      "args": [
        "E:/Github/mcp-browser-logger/dist/index.js"
      ]
    }
  }
}
```

**注意**：将 `E:/Github/mcp-browser-logger/dist/index.js` 替换为实际的路径。

### 方法 2：全局配置

在你的 Claude Code 设置目录中创建配置文件：

- **Windows**: `%APPDATA%\Claude\settings.json`
- **macOS/Linux**: `~/.claude/settings.json`

在 `allowedMcpServers` 中添加：

```json
{
  "allowedMcpServers": [
    {
      "serverName": "browser-logger",
      "serverCommand": ["node", "E:/Github/mcp-browser-logger/dist/index.js"]
    }
  ]
}
```

## 使用方法

### 1. 启动带调试端口的浏览器

**Windows:**
```powershell
# Chrome
chrome.exe --remote-debugging-port=9222

# Edge
msedge.exe --remote-debugging-port=9222
```

**macOS:**
```bash
# Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Edge
/Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge --remote-debugging-port=9222
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222
```

### 2. 在 Claude Code 中使用

重启 Claude Code，然后就可以使用以下工具：

#### 连接到浏览器
```
请使用 browser-logger 连接到浏览器
```

#### 获取控制台日志
```
请获取最近 50 条控制台日志
```
或指定级别：
```
请获取所有 error 级别的日志
```

#### 获取网络请求
```
请获取最近 50 条网络请求
```
或过滤特定方法：
```
请获取所有 POST 请求
```

#### 执行 JavaScript
```
请在浏览器中执行：document.title
```

#### 获取浏览器信息
```
请获取浏览器信息
```

#### 清空日志
```
请清空所有日志记录
```

## 可用工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `connect_browser` | 连接到浏览器的 DevTools Protocol | `host`（默认：localhost）、`port`（默认：9222） |
| `disconnect_browser` | 断开与浏览器的连接 | - |
| `get_console_logs` | 获取浏览器控制台日志 | `level`（log/error/warning/info/debug/all）、`limit`（默认：50）、`clear`（默认：false） |
| `get_network_requests` | 获取浏览器网络请求记录 | `method`（GET/POST/PUT/DELETE 等）、`limit`（默认：50）、`clear`（默认：false） |
| `clear_logs` | 清空所有缓存的日志和网络请求记录 | - |
| `evaluate_javascript` | 在浏览器中执行 JavaScript 代码 | `code`（必需）、`context`（console/page/留空） |
| `get_browser_info` | 获取浏览器信息（User Agent、版本等） | - |

## 开发

```bash
# 监听模式开发
npm run watch

# 运行
npm start

# 开发模式（构建后运行）
npm run dev
```

## 注意事项

1. **安全性**：`--remote-debugging-port` 会暴露浏览器的调试接口，请仅在开发环境使用，不要在生产环境启用
2. **端口冲突**：如果 9222 端口被占用，可以指定其他端口（如 9223）
3. **单实例**：同一个端口只能有一个浏览器实例连接
4. **日志限制**：默认最多保存 1000 条日志和 1000 条网络请求，超过会自动删除旧的

## 故障排除

### 无法连接到浏览器

**问题**：`无法连接到浏览器调试端口 9222`

**解决方案**：
1. 确认浏览器使用 `--remote-debugging-port=9222` 启动
2. 访问 `http://localhost:9222/json` 查看是否有响应
3. 检查是否有防火墙阻止连接

### 日志为空

**问题**：连接成功但没有日志

**解决方案**：
1. 确认浏览器中有页面打开
2. 在页面中执行 `console.log('test')` 测试
3. 刷新页面重新加载

### TypeScript 编译错误

**问题**：运行 `npm run build` 失败

**解决方案**：
```bash
# 重新安装依赖
rm -rf node_modules package-lock.json
npm install

# 重新构建
npm run build
```

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！
