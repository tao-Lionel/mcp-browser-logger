#!/usr/bin/env node

/**
 * MCP Browser Logger
 *
 * 一个 MCP 服务器，用于通过 Chrome DevTools Protocol 收集浏览器控制台日志和网络请求
 *
 * 使用方法：
 * 1. 启动 Chrome/Edge 时添加调试端口：chrome.exe --remote-debugging-port=9222
 * 2. 运行此 MCP 服务器
 * 3. Claude Code 可以通过 MCP 工具查询浏览器日志
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';
import { URL } from 'url';

// 浏览器日志存储
interface ConsoleMessage {
  level: 'log' | 'error' | 'warning' | 'info' | 'debug';
  source: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  stackTrace?: string;
  args?: Array<unknown>;
}

interface NetworkRequest {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  type?: string;
  mimeType?: string;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;
  timing?: {
    requestTime: number;
    responseTime: number;
    duration: number;
  };
}

interface BrowserConnection {
  ws: WebSocket | null;
  connected: boolean;
  messages: ConsoleMessage[];
  networkRequests: NetworkRequest[];
  nextMessageId: number;
  maxMessages: number;
}

const browser: BrowserConnection = {
  ws: null,
  connected: false,
  messages: [],
  networkRequests: [],
  nextMessageId: 1,
  maxMessages: 1000, // 最多保存 1000 条消息
};

// 工具定义
const TOOLS: Tool[] = [
  {
    name: 'connect_browser',
    description: '连接到浏览器的 DevTools Protocol（需要先用 --remote-debugging-port=9222 启动浏览器）',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: '浏览器调试主机地址',
          default: 'localhost',
        },
        port: {
          type: 'number',
          description: '浏览器调试端口',
          default: 9222,
        },
      },
    },
  },
  {
    name: 'disconnect_browser',
    description: '断开与浏览器的连接',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_console_logs',
    description: '获取浏览器控制台日志',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          description: '过滤日志级别 (log, error, warning, info, debug)，留空获取所有',
          enum: ['log', 'error', 'warning', 'info', 'debug', 'all'],
          default: 'all',
        },
        limit: {
          type: 'number',
          description: '返回的日志数量限制',
          default: 50,
        },
        clear: {
          type: 'boolean',
          description: '获取后是否清空日志',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_network_requests',
    description: '获取浏览器网络请求记录',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: '过滤请求方法 (GET, POST, PUT, DELETE 等)，留空获取所有',
          default: '',
        },
        limit: {
          type: 'number',
          description: '返回的请求数量限制',
          default: 50,
        },
        clear: {
          type: 'boolean',
          description: '获取后是否清空记录',
          default: false,
        },
      },
    },
  },
  {
    name: 'clear_logs',
    description: '清空所有缓存的日志和网络请求记录',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'evaluate_javascript',
    description: '在浏览器中执行 JavaScript 代码并返回结果',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要执行的 JavaScript 代码',
        },
        context: {
          type: 'string',
          description: '执行上下文 (console, page, 留空表示默认)',
          default: '',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_browser_info',
    description: '获取浏览器信息（User Agent、版本等）',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// 连接到浏览器
async function connectToBrowser(host: string, port: number): Promise<string> {
  if (browser.connected && browser.ws) {
    return '已经连接到浏览器';
  }

  try {
    // 1. 获取浏览器 WebSocket URL
    const response = await fetch(`http://${host}:${port}/json`);
    if (!response.ok) {
      throw new Error(`无法连接到浏览器调试端口 ${port}，请确保使用 --remote-debugging-port=${port} 启动浏览器`);
    }

    const tabs = await response.json();
    if (!tabs || tabs.length === 0) {
      throw new Error('浏览器中没有打开的标签页');
    }

    // 使用第一个标签页（通常是激活的）
    const wsUrl = tabs[0].webSocketDebuggerUrl;
    if (!wsUrl) {
      throw new Error('无法获取 WebSocket 调试 URL');
    }

    // 2. 连接 WebSocket
    return new Promise((resolve, reject) => {
      browser.ws = new WebSocket(wsUrl);

      browser.ws.on('open', async () => {
        browser.connected = true;

        // 启用必要的域
        await sendCommand('Runtime.enable');
        await sendCommand('Log.enable');
        await sendCommand('Network.enable');
        await sendCommand('Console.enable');

        resolve(`已连接到浏览器 (${tabs[0].title} - ${tabs[0].url})`);
      });

      browser.ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          // 处理控制台消息
          if (message.method === 'Runtime.consoleAPICalled') {
            handleConsoleAPICalled(message.params);
          }
          // 处理日志消息
          else if (message.method === 'Log.entryAdded') {
            handleLogEntryAdded(message.params);
          }
          // 处理网络请求
          else if (message.method === 'Network.requestWillBeSent') {
            handleNetworkRequest(message.params);
          }
          else if (message.method === 'Network.responseReceived') {
            handleNetworkResponse(message.params);
          }
          // 处理 JavaScript 异常
          else if (message.method === 'Runtime.exceptionThrown') {
            handleExceptionThrown(message.params);
          }
        } catch (error) {
          console.error('[MCP] 处理消息失败:', error);
        }
      });

      browser.ws.on('error', (error) => {
        browser.connected = false;
        reject(new Error(`WebSocket 连接错误: ${error}`));
      });

      browser.ws.on('close', () => {
        browser.connected = false;
        browser.ws = null;
      });
    });
  } catch (error) {
    browser.connected = false;
    browser.ws = null;
    throw error;
  }
}

// 发送 CDP 命令
function sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!browser.ws || !browser.connected) {
      reject(new Error('浏览器未连接'));
      return;
    }

    const id = browser.nextMessageId++;
    const message = { id, method, params };

    browser.ws.once('message', (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.id === id) {
          if (response.error) {
            reject(new Error(`CDP 错误: ${response.error.message}`));
          } else {
            resolve(response.result);
          }
        }
      } catch (error) {
        reject(error);
      }
    });

    browser.ws.send(JSON.stringify(message));
  });
}

// 处理控制台 API 调用
function handleConsoleAPICalled(params: { type: string; args: Array<{ type: string; value: string }> }) {
  const level = params.type as ConsoleMessage['level'];
  const args = params.args.map((arg) => {
    if (arg.type === 'string' || arg.type === 'number' || arg.type === 'boolean') {
      return arg.value;
    }
    return JSON.stringify(arg);
  });

  const message: ConsoleMessage = {
    level,
    source: 'console-api',
    text: args.join(' '),
    timestamp: Date.now(),
    args: params.args,
  };

  addMessage(message);
}

// 处理日志条目
function handleLogEntryAdded(params: { entry: { level: string; url?: string; lineNumber?: number; text: string } }) {
  const entry = params.entry;

  const message: ConsoleMessage = {
    level: entry.level as ConsoleMessage['level'],
    source: 'browser-log',
    text: entry.text,
    timestamp: Date.now(),
    url: entry.url,
    lineNumber: entry.lineNumber,
  };

  addMessage(message);
}

// 处理网络请求
function handleNetworkRequest(params: { requestId: string; request: { method: string; url: string; headers?: Record<string, string>; postData?: string }; timestamp: number; type?: string }) {
  const request: NetworkRequest = {
    requestId: params.requestId,
    method: params.request.method,
    url: params.request.url,
    type: params.type,
    timestamp: params.timestamp || Date.now(),
    requestHeaders: params.request.headers,
    postData: params.request.postData,
  };

  addNetworkRequest(request);
}

// 处理网络响应
function handleNetworkResponse(params: { requestId: string; response: { status: number; mimeType: string; headers: Record<string, string> }; timestamp: number }) {
  const existingRequest = browser.networkRequests.find((r) => r.requestId === params.requestId);
  if (existingRequest) {
    existingRequest.status = params.response.status;
    existingRequest.mimeType = params.response.mimeType;
    existingRequest.responseHeaders = params.response.headers;
    existingRequest.timing = {
      requestTime: existingRequest.timing?.requestTime || existingRequest.timestamp,
      responseTime: params.timestamp,
      duration: params.timestamp - existingRequest.timestamp,
    };
  }
}

// 处理 JavaScript 异常
function handleExceptionThrown(params: { exceptionDetails: { exception?: { description?: string }; url?: string; lineNumber?: number; columnNumber?: number; stackTrace?: string } }) {
  const details = params.exceptionDetails;

  const message: ConsoleMessage = {
    level: 'error',
    source: 'javascript-exception',
    text: details.exception?.description || '未捕获的异常',
    timestamp: Date.now(),
    url: details.url,
    lineNumber: details.lineNumber,
    columnNumber: details.columnNumber,
    stackTrace: details.stackTrace,
  };

  addMessage(message);
}

// 添加消息到缓存
function addMessage(message: ConsoleMessage) {
  browser.messages.push(message);

  // 限制缓存大小
  if (browser.messages.length > browser.maxMessages) {
    browser.messages.shift();
  }
}

// 添加网络请求到缓存
function addNetworkRequest(request: NetworkRequest) {
  browser.networkRequests.push(request);

  // 限制缓存大小
  if (browser.networkRequests.length > browser.maxMessages) {
    browser.networkRequests.shift();
  }
}

// 格式化日志消息
function formatMessage(message: ConsoleMessage): string {
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN');
  const level = message.level.toUpperCase().padEnd(5);
  const source = message.source.padEnd(20);

  let text = `[${time}] [${level}] [${source}] ${message.text}`;

  if (message.url) {
    text += `\n    位置: ${message.url}`;
    if (message.lineNumber !== undefined) {
      text += `:${message.lineNumber}`;
      if (message.columnNumber !== undefined) {
        text += `:${message.columnNumber}`;
      }
    }
  }

  if (message.stackTrace) {
    text += `\n    堆栈: ${message.stackTrace}`;
  }

  return text;
}

// 格式化网络请求
function formatNetworkRequest(request: NetworkRequest): string {
  const time = new Date(request.timestamp).toLocaleTimeString('zh-CN');
  const status = request.status ? String(request.status).padEnd(3) : 'PND';
  const method = request.method.padEnd(6);

  let text = `[${time}] [${status}] [${method}] ${request.url}`;

  if (request.type) {
    text += ` (${request.type})`;
  }

  if (request.timing?.duration) {
    text += ` - ${request.timing.duration.toFixed(0)}ms`;
  }

  return text;
}

// 主函数
async function main() {
  const server = new Server(
    {
      name: 'mcp-browser-logger',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 列出可用工具
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // 处理工具调用
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'connect_browser': {
          const host = (args?.host as string) || 'localhost';
          const port = (args?.port as number) || 9222;
          const result = await connectToBrowser(host, port);
          return {
            content: [{ type: 'text', text: result }],
          };
        }

        case 'disconnect_browser': {
          if (browser.ws) {
            browser.ws.close();
            browser.ws = null;
          }
          browser.connected = false;
          return {
            content: [{ type: 'text', text: '已断开浏览器连接' }],
          };
        }

        case 'get_console_logs': {
          const level = (args?.level as string) || 'all';
          const limit = (args?.limit as number) || 50;
          const clear = (args?.clear as boolean) || false;

          let messages = browser.messages;

          if (level !== 'all') {
            messages = messages.filter((m) => m.level === level);
          }

          const limited = messages.slice(-limit);

          if (clear) {
            browser.messages = [];
          }

          if (limited.length === 0) {
            return {
              content: [{ type: 'text', text: '暂无控制台日志' }],
            };
          }

          const text = limited.map(formatMessage).join('\n\n');
          return {
            content: [{ type: 'text', text: `共 ${limited.length} 条日志:\n\n${text}` }],
          };
        }

        case 'get_network_requests': {
          const method = (args?.method as string) || '';
          const limit = (args?.limit as number) || 50;
          const clear = (args?.clear as boolean) || false;

          let requests = browser.networkRequests;

          if (method) {
            requests = requests.filter((r) => r.method.toUpperCase() === method.toUpperCase());
          }

          const limited = requests.slice(-limit);

          if (clear) {
            browser.networkRequests = [];
          }

          if (limited.length === 0) {
            return {
              content: [{ type: 'text', text: '暂无网络请求记录' }],
            };
          }

          const text = limited.map(formatNetworkRequest).join('\n');
          return {
            content: [{ type: 'text', text: `共 ${limited.length} 条网络请求:\n\n${text}` }],
          };
        }

        case 'clear_logs': {
          browser.messages = [];
          browser.networkRequests = [];
          return {
            content: [{ type: 'text', text: '已清空所有日志和网络请求记录' }],
          };
        }

        case 'evaluate_javascript': {
          const code = args?.code as string;
          const context = (args?.context as string) || '';

          let result;
          if (context === 'console') {
            result = await sendCommand('Runtime.evaluate', {
              expression: code,
              objectGroup: 'console',
              includeCommandLineAPI: true,
            });
          } else {
            result = await sendCommand('Runtime.evaluate', {
              expression: code,
              returnByValue: true,
            });
          }

          const output = JSON.stringify(result, null, 2);
          return {
            content: [{ type: 'text', text: `执行结果:\n${output}` }],
          };
        }

        case 'get_browser_info': {
          const result = await sendCommand('Runtime.evaluate', {
            expression: 'navigator.userAgent',
            returnByValue: true,
          });

          return {
            content: [{ type: 'text', text: `浏览器信息:\n${JSON.stringify(result, null, 2)}` }],
          };
        }

        default:
          throw new Error(`未知工具: ${name}`);
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  // 启动服务器
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Browser Logger 服务器已启动');
}

main().catch((error) => {
  console.error('服务器启动失败:', error);
  process.exit(1);
});
