# agentic-direct 第三轮测试打包说明（适合 Zeabur 公网部署）

> 本文档聚焦第三轮扩展测试结论，并补充公网部署时的最小安全要求。


## 一、手动操作前说明

### 1. 这个项目是什么
`agentic-direct` 是 IAB Tech Lab 做的一个 **A2A + MCP + OpenDirect** 参考实现。

它更像是：
- A2A 协议层 demo
- MCP 工具调用样板
- OpenDirect schema 驱动执行参考实现

它 **不是** 一个完整的广告交易业务系统，
更偏向验证：

- agent card
- buyer / seller 双 agent
- JSON-RPC 消息接口
- MCP tools
- 自然语言 → 工具调用 → 结果返回

---

### 2. 它的核心功能
- **Buyer Agent**
  - 更偏账户、订单、创意、产品发现
- **Seller Agent**
  - 更偏产品搜索、库存管理、订单处理、创意审批
- **Agent Card**
  - 支持 buyer / seller agent discovery
- **MCP Tools**
  - 从 `opendirect.json` 自动生成工具（当前 33 个）
- **A2A JSON-RPC**
  - 通过 `/a2a/buyer/jsonrpc` 和 `/a2a/seller/jsonrpc` 接收消息
- **Web Client**
  - 自带前端测试面板

---

### 3. 它和 AAMP 的关系
这个项目最主要体现了 AAMP 里的这些部分：

| 功能 | 对应 AAMP |
|---|---|
| buyer / seller 双 agent | 双边 agent 协作模型 |
| agent card | Agent Discovery |
| JSON-RPC 消息接口 | Conversational A2A |
| MCP tools | Structured Tool Calls |
| OpenDirect schema 驱动 | Schema-driven agent execution |
| AI Executor | 自然语言 → 工具规划 → 执行 |

---

### 4. 你测试它时应该带着什么预期
**应该验证的：**
- Server 能不能起来
- buyer / seller agent card 能不能发现
- MCP tool 能不能加载
- buyer / seller 发消息后能不能真正执行 tool

**不要期待的：**
- 完整广告交易闭环（quote / deal / order / CR）
- 完整 seller 状态机
- 完整 buyer/seller 业务系统

那是前面 `buyer-agent` / `seller-agent` 更擅长的部分。

---

## 二、手动操作简单版指南

## 0. 目标
用最少步骤验证：
1. A2A Agent Discovery
2. MCP Tools 是否可用
3. buyer / seller 是否能执行消息
4. OpenDirect schema 驱动的工具调用是否跑通

---

## 1. 启动 server

```bash
cd server
npm install
npm run dev
```

如果端口被占用（例如 3001）：
```bash
lsof -ti :3001 | xargs kill -9
npm run dev
```

### `.env` 最小示例
```env
PORT=3001
OPENAI_API_KEY=你的key
OPENAI_BASE_URL=你的兼容接口
OPENAI_MODEL=gpt-5.4
```

---

## 2. 启动 client

```bash
cd ../client
npm install
npm run build
python3 -m http.server 8080 --directory .
```

打开：
- `http://127.0.0.1:8080/`

---

## 3. 测试基础服务

### health
```bash
curl http://127.0.0.1:3001/health
```

### buyer agent card
```bash
curl http://127.0.0.1:3001/a2a/buyer/.well-known/agent-card.json
```

### seller agent card
```bash
curl http://127.0.0.1:3001/a2a/seller/.well-known/agent-card.json
```

### MCP info
```bash
curl http://127.0.0.1:3001/mcp/info
```

#### 通过标准
- 都返回 200
- `/mcp/info` 里能看到 `tools`
- 当前应看到 **33 个 tools**

---

## 4. 测试 Buyer Agent

### list products
```bash
curl -X POST http://127.0.0.1:3001/a2a/buyer/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"message/send",
    "params":{
      "message":{
        "messageId":"msg-1",
        "role":"user",
        "parts":[{"kind":"text","text":"list products"}],
        "kind":"message"
      }
    },
    "id":1
  }'
```

### create account
```bash
curl -X POST http://127.0.0.1:3001/a2a/buyer/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"message/send",
    "params":{
      "message":{
        "messageId":"msg-2",
        "role":"user",
        "parts":[{"kind":"text","text":"create account for Nike"}],
        "kind":"message"
      }
    },
    "id":2
  }'
```

### 多步请求（进阶）
```bash
curl -X POST http://127.0.0.1:3001/a2a/buyer/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"message/send",
    "params":{
      "message":{
        "messageId":"msg-3",
        "role":"user",
        "parts":[{"kind":"text","text":"create account for Nike and create order for Nike with budget 500"}],
        "kind":"message"
      }
    },
    "id":3
  }'
```

#### 通过标准
- 至少能看到 `create_account` 成功执行
- 最好还能看到多步结果返回

---

## 5. 测试 Seller Agent

### list available products
```bash
curl -X POST http://127.0.0.1:3001/a2a/seller/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"message/send",
    "params":{
      "message":{
        "messageId":"msg-4",
        "role":"user",
        "parts":[{"kind":"text","text":"list available products"}],
        "kind":"message"
      }
    },
    "id":4
  }'
```

### process order
```bash
curl -X POST http://127.0.0.1:3001/a2a/seller/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"message/send",
    "params":{
      "message":{
        "messageId":"msg-5",
        "role":"user",
        "parts":[{"kind":"text","text":"process order for account ABC"}],
        "kind":"message"
      }
    },
    "id":5
  }'
```

### approve creative
```bash
curl -X POST http://127.0.0.1:3001/a2a/seller/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"message/send",
    "params":{
      "message":{
        "messageId":"msg-6",
        "role":"user",
        "parts":[{"kind":"text","text":"approve creative submission"}],
        "kind":"message"
      }
    },
    "id":6
  }'
```

#### 通过标准
- 都能返回 structured message
- 至少说明 seller agent 可执行消息
- 即使语义偏保守，也算单步链路通过

---

## 6. 用网页 client 测

打开：
- `http://127.0.0.1:8080/`

### 操作步骤
1. Server URL 填：
   - `http://127.0.0.1:3001`
2. 选 agent：
   - buyer 或 seller
3. 点 Connect
4. 发消息：
   - `list products`
   - `create account for Nike`
   - `list available products`

#### 通过标准
- 能连接 agent
- 能显示返回消息
- Debug log 有内容

---

## 7. 常见问题

### 端口占用
```bash
lsof -ti :3001 | xargs kill -9
lsof -ti :8080 | xargs kill -9
```

### 方法名错
不要用：
- `sendMessage`
- `getTask`

要用：
- `message/send`
- （如果继续深测 task 再看 SDK 路径）

### 模型超时
检查：
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

### 页面打不开
确认 client 目录下已经执行：
```bash
npm run build
python3 -m http.server 8080 --directory .
```

---

## 8. 第三轮扩展测试结论（打包版）

### Buyer
1. `create account for Nike`
   - PASS
   - 正确执行 `create_account`
2. `search products`
   - PASS
   - 实际执行 `list_products`
3. `create account for Nike and create order for Nike with budget 500`
   - PARTIAL
   - 能识别为多步计划
   - 至少执行到 `create_account`
   - 最终聚合返回未完全收口

### Seller
1. `list available products`
   - PASS
   - 实际执行 `list_products`
2. `process order for account ABC`
   - PASS（弱语义）
   - 实际更偏向 `list_orders`
3. `approve creative submission`
   - PASS（弱语义）
   - 实际更偏向 `list_creatives`

### 打包后的最终判断
- 单步自然语言 → 模型规划 → MCP tool → structured response：**PASS**
- 多步 workflow：**PARTIAL**
- seller 语义理解：**偏保守**
- 项目定位：**更适合展示 A2A / MCP / OpenDirect 协议层，不适合直接当完整广告交易业务系统**

---

## 9. Zeabur 公网部署建议

### 必要环境变量
```env
PORT=3001
OPENAI_API_KEY=你的兼容接口 key
OPENAI_BASE_URL=https://codex.privetm.com/v1
OPENAI_MODEL=gpt-5.4
```

### 强烈建议增加的安全项
```env
PUBLIC_API_KEY=请自定义一串高强度随机 key
```

### 为什么必须加 `PUBLIC_API_KEY`
如果直接公网暴露 buyer / seller 的 JSON-RPC 接口，任何人都可能调用你的模型后端，等于拿你的 token 白嫖，最后烧的是你的额度。

本次已在服务端补了一个简单的公网保护：
- 当 `PUBLIC_API_KEY` 存在时：
  - `/health`
  - `/`
  仍可公开访问
  - 其余接口（包括 A2A JSON-RPC / agent card / MCP）需要认证
- 认证方式支持：
  - `Authorization: Bearer <PUBLIC_API_KEY>`
  - 或 `X-API-Key: <PUBLIC_API_KEY>`

### 调用示例
```bash
curl -X POST https://your-zeabur-domain/a2a/buyer/jsonrpc \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_PUBLIC_API_KEY' \
  -d '{"jsonrpc":"2.0","method":"message/send","params":{"message":{"messageId":"msg-1","role":"user","parts":[{"kind":"text","text":"list products"}],"kind":"message"}},"id":1}'
```

## 10. 一句话结论
这份打包文档的重点不是验证完整广告业务，而是验证：

**agentic-direct 的 A2A + MCP + OpenDirect 协议主链是活的，并且公网部署时必须加一层 key 保护，防止别人偷刷你的 token。**
