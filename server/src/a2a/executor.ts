/**
 * Agent Executor - LLM Driven Intent Recognition + MCP Tool Execution
 *
 * Architecture:
 * 1. LLM analyzes user message + conversation context
 * 2. LLM determines which MCP tool(s) to call + extracts parameters
 * 3. Execute MCP tool(s) and return results
 * 4. LLM summarizes tool results into a natural language response
 */

import OpenAI from 'openai';
import type { AgentExecutor as IAgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import type { Message } from '@a2a-js/sdk';
import type { MCPServer } from '../mcp/mcp-server.js';
import type { MCPTool } from '../types/index.js';

// ==================== Mock Data Catalog (for product queries) ====================
const productCatalog = [
  { id: 'prod_001', name: '首页横幅广告位', type: 'banner', category: 'display', description: '网站首页顶部横幅广告，尺寸 1200x300', rate: 50, currency: 'CNY', unit: 'CPM', available: true, formats: ['image', 'html5'], size: '1200x300', placement: 'homepage_top', impressions: 500000 },
  { id: 'prod_002', name: 'App开屏广告', type: 'splash', category: 'mobile', description: '移动 App 启动时全屏展示，3-5秒', rate: 80, currency: 'CNY', unit: 'CPM', available: true, formats: ['image', 'gif'], size: '1080x1920', placement: 'app_splash', impressions: 2000000 },
  { id: 'prod_003', name: '信息流原生广告', type: 'native', category: 'feed', description: '嵌入内容信息流中的原生广告', rate: 35, currency: 'CNY', unit: 'CPM', available: true, formats: ['text', 'image'], size: '600x400', placement: 'content_feed', impressions: 1500000 },
  { id: 'prod_004', name: '视频前贴片广告', type: 'video_preroll', category: 'video', description: '视频播放前15秒不可跳过广告', rate: 120, currency: 'CNY', unit: 'CPM', available: true, formats: ['mp4'], size: '1920x1080', placement: 'video_preroll', impressions: 800000, duration: 15 },
  { id: 'prod_005', name: '搜索关键词竞价', type: 'search_keyword', category: 'search', description: '搜索结果页顶部置顶广告，按点击付费', rate: 5, currency: 'CNY', unit: 'CPC', available: true, formats: ['text'], placement: 'search_top', dailyClicks: 10000 },
  { id: 'prod_006', name: '侧边栏展示广告', type: 'sidebar_display', category: 'display', description: '网页侧边栏固定展示位', rate: 25, currency: 'CNY', unit: 'CPM', available: true, formats: ['image', 'html5'], size: '300x250', placement: 'sidebar_right', impressions: 300000 },
  { id: 'prod_007', name: '短视频信息流广告', type: 'short_video_feed', category: 'video', description: '短视频平台信息流广告，15-30秒', rate: 60, currency: 'CNY', unit: 'CPM', available: true, formats: ['mp4'], size: '1080x1920', placement: 'short_video_feed', impressions: 3000000, duration: 30 },
  { id: 'prod_008', name: '微信公众号推文广告', type: 'wechat_article', category: 'social', description: '微信公众号推文内嵌广告', rate: 200, currency: 'CNY', unit: 'per_post', available: true, formats: ['text', 'image', 'link'], placement: 'wechat_article', followers: 500000 },
  { id: 'prod_009', name: '电商首页焦点图', type: 'ecommerce_hero', category: 'ecommerce', description: '电商平台首页轮播焦点图', rate: 150, currency: 'CNY', unit: 'CPM', available: true, formats: ['image'], size: '800x600', placement: 'ecommerce_homepage_hero', impressions: 1000000 },
  { id: 'prod_010', name: '短信推广', type: 'sms_campaign', category: 'direct', description: '精准定向用户群发送推广短信', rate: 0.1, currency: 'CNY', unit: 'per_sms', available: true, formats: ['text'], placement: 'sms_direct', maxRecipients: 1000000 }
];

const campaignTemplates = [
  { id: 'tmpl_001', name: '品牌曝光套餐', description: '首页横幅 + App开屏 + 视频前贴', products: ['prod_001', 'prod_002', 'prod_004'], totalPrice: 250, discount: 0.9 },
  { id: 'tmpl_002', name: '效果转化套餐', description: '搜索关键词 + 信息流原生 + 侧边栏', products: ['prod_005', 'prod_003', 'prod_006'], totalPrice: 65, discount: 0.85 },
  { id: 'tmpl_003', name: '社交媒体套餐', description: '微信公众号 + 短视频 + 短信推广', products: ['prod_008', 'prod_007', 'prod_010'], totalPrice: 260.1, discount: 0.88 }
];

const advertisers = [
  { id: 'adv_001', name: '某知名品牌手机', industry: 'electronics' },
  { id: 'adv_002', name: '某电商平台', industry: 'ecommerce' },
  { id: 'adv_003', name: '某在线教育平台', industry: 'education' },
  { id: 'adv_004', name: '某金融App', industry: 'finance' },
  { id: 'adv_005', name: '某游戏公司', industry: 'gaming' }
];

// ==================== Context History ====================
interface ConversationEntry {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

const contextHistoryMap = new Map<string, ConversationEntry[]>();

function getContextHistory(contextId: string): string {
  const entries = contextHistoryMap.get(contextId) || [];
  return entries.slice(-10).map(e => `${e.role === 'user' ? '用户' : 'Agent'}: ${e.text}`).join('\n');
}

function addContextEntry(contextId: string, entry: ConversationEntry) {
  const entries = contextHistoryMap.get(contextId) || [];
  entries.push(entry);
  if (entries.length > 20) entries.splice(0, entries.length - 20);
  contextHistoryMap.set(contextId, entries);
}

// ==================== LLM Intent + Tool Planning ====================
interface ToolPlan {
  action: string;        // What to do in natural language
  toolCalls: Array<{     // MCP tools to call
    toolName: string;
    toolParams: Record<string, any>;
  }>;
  needMockResponse?: boolean;  // If true, use mock data instead of MCP tools
  mockResponseType?: string;   // Type of mock response to generate
}

async function planToolCalls(
  userText: string,
  contextHistory: string,
  tools: MCPTool[],
  openai: OpenAI
): Promise<ToolPlan> {
  const toolSchema = tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema.properties || {}
  }));

  const toolListStr = toolSchema.map(t => `- ${t.name}: ${t.description}`).join('\n');

  const systemPrompt = `你是一个广告平台的 AI 助手。你的工作是分析用户的请求，并决定如何响应。

你有两种响应方式：

### 方式 1：调用 MCP 工具
可用的 MCP 工具列表：
${toolListStr}

当用户要执行具体操作（如创建订单、查询订单、创建账户、列出账户等）时，调用对应的 MCP 工具。

### 方式 2：使用 Mock 数据直接回答
当用户询问广告位信息、广告类型、套餐、价格、广告主列表等时，不需要调用 MCP 工具，直接返回 mockResponseType。
支持的 mockResponseType：
- "listProducts": 用户询问有哪些广告位
- "category": 用户询问广告位类型分类
- "mobile": 用户查询移动端广告
- "video": 用户查询视频类广告
- "display": 用户查询展示类广告
- "search": 用户查询搜索类广告
- "social": 用户查询社交类广告
- "ecommerce": 用户查询电商类广告
- "campaign": 用户询问广告套餐
- "price": 用户询问价格
- "advertiser": 用户询问广告主
- "hello": 用户打招呼
- "createOrderPrompt": 用户想下单但参数不全，需要引导
- "fallback": 完全不理解用户意图

### 返回格式
只返回 JSON 对象，格式如下：

如果调用 MCP 工具：
{
  "action": "简要描述要做什么",
  "toolCalls": [{"toolName": "工具名", "toolParams": {"参数": "值"}}],
  "needMockResponse": false
}

如果使用 Mock 数据：
{
  "action": "简要描述要做什么",
  "toolCalls": [],
  "needMockResponse": true,
  "mockResponseType": "类型名"
}

如果完全无法理解，返回：
{
  "action": "无法理解用户意图",
  "toolCalls": [],
  "needMockResponse": true,
  "mockResponseType": "fallback"
}

注意：
1. 从用户的消息中提取具体参数（如产品ID、预算、日期等）
2. 如果用户在之前的对话中已经提供了某些信息，可以从上下文中推断
3. 使用工具时，参数名必须与工具 schema 中的完全一致`;

  try {
    const contextInfo = contextHistory ? `之前的对话历史：\n${contextHistory}\n\n` : '';

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${contextInfo}用户当前消息：${userText}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 512
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from LLM');

    const plan: ToolPlan = JSON.parse(content);
    console.log(`🧠 LLM Plan: ${plan.action}`);
    if (plan.needMockResponse) {
      console.log(`  → Mock response: ${plan.mockResponseType}`);
    } else {
      console.log(`  → Tools: ${plan.toolCalls.map(t => t.toolName).join(', ')}`);
    }

    return plan;
  } catch (error) {
    console.error('LLM planning failed:', error);
    // Fallback to mock fallback response
    return {
      action: 'LLM planning failed, fallback to default',
      toolCalls: [],
      needMockResponse: true,
      mockResponseType: 'fallback'
    };
  }
}

// ==================== Mock Response Generator ====================
function generateMockResponse(
  responseType: string,
  role: 'buyer' | 'seller'
): { message: string; data: any } {
  const roleLabel = role === 'buyer' ? '买家' : '卖家';

  switch (responseType) {
    case 'hello': {
      const buyerGreeting = '你好！我是广告投放助手（买家端）\n\n我可以帮你：\n- 查看可购买的广告位\n- 推荐广告套餐\n- 查询价格和预算\n- 创建投放订单\n\n请问有什么可以帮你的？';
      const sellerGreeting = '你好！我是广告库存助手（卖家端）\n\n我可以帮你：\n- 查看可售卖的广告位库存\n- 管理广告位定价\n- 查看广告主需求\n- 确认订单排期\n\n请问有什么可以帮你的？';
      return { message: role === 'buyer' ? buyerGreeting : sellerGreeting, data: null };
    }
    case 'listProducts':
      return { message: `【${roleLabel}视角】我们目前有 ${productCatalog.length} 个广告位可投放：`, data: productCatalog };
    case 'category': {
      const categories = [
        { type: '展示', count: productCatalog.filter(p => p.category === 'display').length, products: productCatalog.filter(p => p.category === 'display').map(p => p.name).join('、') },
        { type: '移动', count: productCatalog.filter(p => p.category === 'mobile').length, products: productCatalog.filter(p => p.category === 'mobile').map(p => p.name).join('、') },
        { type: '视频', count: productCatalog.filter(p => p.category === 'video').length, products: productCatalog.filter(p => p.category === 'video').map(p => p.name).join('、') },
        { type: '信息流', count: productCatalog.filter(p => p.category === 'feed').length, products: productCatalog.filter(p => p.category === 'feed').map(p => p.name).join('、') },
        { type: '搜索', count: productCatalog.filter(p => p.category === 'search').length, products: productCatalog.filter(p => p.category === 'search').map(p => p.name).join('、') },
        { type: '社交', count: productCatalog.filter(p => p.category === 'social').length, products: productCatalog.filter(p => p.category === 'social').map(p => p.name).join('、') },
        { type: '电商', count: productCatalog.filter(p => p.category === 'ecommerce').length, products: productCatalog.filter(p => p.category === 'ecommerce').map(p => p.name).join('、') },
        { type: '直投', count: productCatalog.filter(p => p.category === 'direct').length, products: productCatalog.filter(p => p.category === 'direct').map(p => p.name).join('、') }
      ].filter(c => c.count > 0);
      const categoryText = categories.map(c => `${c.type}（${c.count}个）：${c.products}`).join('\n');
      return { message: `【${roleLabel}视角】广告位类型分类：\n\n${categoryText}`, data: categories };
    }
    case 'mobile': {
      const mobileProducts = productCatalog.filter(p => p.category === 'mobile' || p.type === 'splash' || p.description.includes('App'));
      return { message: `【${roleLabel}视角】为你推荐移动端广告位：`, data: mobileProducts };
    }
    case 'video': {
      const videoProducts = productCatalog.filter(p => p.category === 'video');
      return { message: `【${roleLabel}视角】视频类广告位：`, data: videoProducts };
    }
    case 'display': {
      const displayProducts = productCatalog.filter(p => p.category === 'display');
      return { message: `【${roleLabel}视角】展示类广告位：`, data: displayProducts };
    }
    case 'search': {
      const searchProducts = productCatalog.filter(p => p.category === 'search');
      return { message: `【${roleLabel}视角】搜索类广告位：`, data: searchProducts };
    }
    case 'social': {
      const socialProducts = productCatalog.filter(p => p.category === 'social');
      return { message: `【${roleLabel}视角】社交类广告位：`, data: socialProducts };
    }
    case 'ecommerce': {
      const ecommerceProducts = productCatalog.filter(p => p.category === 'ecommerce');
      return { message: `【${roleLabel}视角】电商类广告位：`, data: ecommerceProducts };
    }
    case 'campaign':
      return { message: `【${roleLabel}视角】推荐广告套餐：`, data: campaignTemplates.map(t => ({ ...t, products: t.products.map((pid: string) => { const p = productCatalog.find(x => x.id === pid); return p ? { id: p.id, name: p.name, rate: p.rate } : null; }).filter(Boolean) })) };
    case 'price': {
      const buyerPrice = '【买家视角】价格说明：\n\n- 展示类（CPM）：¥25-150 / 千次曝光\n- 点击类（CPC）：¥5 / 次点击\n- 按条计费：短信 ¥0.1/条\n- 包段计费：微信推文 ¥200/篇\n\n批量投放可享受套餐折扣（85-90折）';
      const sellerPrice = '【卖家视角】广告位定价说明：\n\n- 展示类（CPM）：报价 ¥25-150 / 千次曝光\n- 点击类（CPC）：报价 ¥5 / 次点击\n- 按条计费：短信 ¥0.1/条\n- 包段计费：微信推文 ¥200/篇\n\n批量订单可申请专属折扣';
      return { message: role === 'buyer' ? buyerPrice : sellerPrice, data: null };
    }
    case 'advertiser':
      return { message: `【${roleLabel}视角】正在投放的广告主：`, data: advertisers };
    case 'createOrderPrompt': {
      const buyerOrder = '【买家】创建投放订单\n\n请提供以下信息：\n1. 选择广告位 ID（如 prod_001）\n2. 投放预算（元）\n3. 投放开始日期\n4. 投放结束日期\n\n例如：我要投 prod_001，预算 5000 元，4月15日到4月30日';
      const sellerOrder = '【卖家】确认订单排期\n\n请提供以下信息：\n1. 客户订单号\n2. 广告位 ID（如 prod_001）\n3. 确认排期开始日期\n4. 确认排期结束日期\n\n例如：确认订单 prod_001，4月15日到4月30日';
      return { message: role === 'buyer' ? buyerOrder : sellerOrder, data: null };
    }
    case 'fallback':
    default:
      return { message: '抱歉，我没有理解你的意图\n\n你可以试试：\n- "有什么广告位？" - 查看所有可用广告\n- "我想打手机广告" - 推荐移动端广告位\n- "有什么套餐？" - 查看推荐套餐\n- "价格多少？" - 查询报价\n- "我要下单" - 创建投放订单', data: null };
  }
}

// ==================== LLM Response Summarizer ====================
async function summarizeToolResult(
  userText: string,
  toolResults: Array<{ toolName: string; result: any }>,
  role: 'buyer' | 'seller',
  openai: OpenAI
): Promise<string> {
  const roleLabel = role === 'buyer' ? '买家' : '卖家';

  const resultsStr = toolResults.map(t =>
    `工具 ${t.toolName} 返回结果：\n${typeof t.result === 'string' ? t.result : JSON.stringify(t.result, null, 2)}`
  ).join('\n\n');

  const systemPrompt = `你是一个广告平台的 AI 助手。你刚刚帮用户执行了一些操作，现在需要用自然语言向用户说明结果。

角色：${roleLabel}端助手
要求：
1. 用中文回复
2. 简洁明了，重点突出
3. 如果操作成功，明确告知成功并列出关键信息
4. 如果有 ID 等关键信息，务必展示出来
5. 如果用户接下来可以做什么，给出提示`;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `用户请求：${userText}\n\n工具执行结果：\n${resultsStr}` }
      ],
      temperature: 0.3,
      max_tokens: 512
    });

    return response.choices[0]?.message?.content || '操作已完成。';
  } catch (error) {
    console.error('LLM summarization failed:', error);
    // Fallback: return raw tool results
    return toolResults.map(t =>
      `${t.toolName}:\n${typeof t.result === 'string' ? t.result : JSON.stringify(t.result, null, 2)}`
    ).join('\n\n');
  }
}

// ==================== Agent Executor ====================
export class AgentExecutor implements IAgentExecutor {
  private openai: OpenAI;
  private mcpServer: MCPServer;
  private tools: MCPTool[];
  private role: 'buyer' | 'seller';
  private activeTasks: Set<string> = new Set();

  constructor(
    role: 'buyer' | 'seller',
    mcpServer: MCPServer,
    tools: MCPTool[],
    openaiApiKey: string
  ) {
    this.role = role;
    this.mcpServer = mcpServer;
    this.tools = tools;
    this.openai = new OpenAI({ apiKey: openaiApiKey });
  }

  /**
   * Execute user request (SDK AgentExecutor interface)
   */
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { userMessage, taskId, contextId } = requestContext;
    const userText = this.extractTextFromMessage(userMessage);

    console.log(`🤖 Agent Executor (${this.role}): Processing request`);
    console.log(`📝 User message: ${userText}`);
    console.log(`📋 Context ID: ${contextId}`);

    this.activeTasks.add(taskId);

    try {
      // Step 1: LLM plans what to do (which tools to call, or mock response)
      const contextHistory = getContextHistory(contextId);
      const plan = await planToolCalls(userText, contextHistory, this.tools, this.openai);

      // Step 2a: Mock response path (for informational queries)
      if (plan.needMockResponse && plan.mockResponseType) {
        const mockResult = generateMockResponse(plan.mockResponseType, this.role);
        console.log(`✅ Mock response generated: ${plan.mockResponseType}`);

        addContextEntry(contextId, { role: 'user', text: userText, timestamp: Date.now() });
        addContextEntry(contextId, { role: 'agent', text: mockResult.message, timestamp: Date.now() });

        const finalMessage = this.createAgentMessage(
          mockResult.message,
          mockResult.data,
          contextId,
          taskId
        );
        eventBus.publish(finalMessage);
        eventBus.finished();
        this.activeTasks.delete(taskId);
        return;
      }

      // Step 2b: MCP Tool execution path
      if (plan.toolCalls.length === 0) {
        // No tools to call, no mock response — fallback
        const fallbackResult = generateMockResponse('fallback', this.role);
        const finalMessage = this.createAgentMessage(fallbackResult.message, null, contextId, taskId);
        eventBus.publish(finalMessage);
        eventBus.finished();
        this.activeTasks.delete(taskId);
        return;
      }

      // Execute tools sequentially
      const toolResults: Array<{ toolName: string; result: any }> = [];

      for (const toolCall of plan.toolCalls) {
        console.log(`🔧 Executing tool: ${toolCall.toolName}`);
        console.log(`📋 Params: ${JSON.stringify(toolCall.toolParams)}`);

        try {
          const mcpResponse = await this.mcpServer.callTool(toolCall.toolName, toolCall.toolParams);

          // Extract text content from MCP response
          let result: any = mcpResponse;
          if (mcpResponse.content && mcpResponse.content.length > 0) {
            const textContent = mcpResponse.content[0];
            if (textContent.type === 'text') {
              try {
                result = JSON.parse(textContent.text);
              } catch {
                result = textContent.text;
              }
            }
          }

          toolResults.push({ toolName: toolCall.toolName, result });
          console.log(`✅ Tool ${toolCall.toolName} completed`);
        } catch (error) {
          console.error(`❌ Tool ${toolCall.toolName} failed:`, error);
          toolResults.push({
            toolName: toolCall.toolName,
            result: `执行失败: ${error instanceof Error ? error.message : String(error)}`
          });
        }
      }

      // Step 3: LLM summarizes tool results into natural language
      const summary = await summarizeToolResult(userText, toolResults, this.role, this.openai);
      console.log(`📝 Summary: ${summary}`);

      addContextEntry(contextId, { role: 'user', text: userText, timestamp: Date.now() });
      addContextEntry(contextId, { role: 'agent', text: summary, timestamp: Date.now() });

      const finalMessage = this.createAgentMessage(
        summary,
        toolResults.length === 1 ? toolResults[0].result : toolResults,
        contextId,
        taskId
      );

      eventBus.publish(finalMessage);
      eventBus.finished();

    } catch (error) {
      console.error(`❌ Execution failed:`, error);

      const errorMessage = this.createAgentMessage(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        null,
        contextId,
        taskId
      );
      eventBus.publish(errorMessage);
      eventBus.finished();
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`🚫 Canceling task: ${taskId}`);
    this.activeTasks.delete(taskId);

    const cancelMessage = this.createAgentMessage('Task has been canceled', null, '', taskId);
    eventBus.publish(cancelMessage);
    eventBus.finished();
  }

  /**
   * Extract text from message
   */
  private extractTextFromMessage(message: Message): string {
    const textParts = message.parts.filter((p: any) => p.kind === 'text');
    return textParts.map((p: any) => p.text).join(' ');
  }

  /**
   * Create agent message
   */
  private createAgentMessage(
    text: string,
    data: any,
    contextId: string,
    taskId: string
  ): Message {
    const parts: any[] = [{ kind: 'text', text }];
    if (data) {
      parts.push({ kind: 'data', data });
    }

    return {
      kind: 'message',
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      role: 'agent',
      parts,
      contextId,
      taskId
    } as Message;
  }
}
