/**
 * Agent Executor
 * AI-powered execution engine that selects and executes MCP tools
 * Implements @a2a-js/sdk AgentExecutor interface
 */

import OpenAI from 'openai';
import type { AgentExecutor as IAgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import type { Message } from '@a2a-js/sdk';
import type { MCPServer } from '../mcp/mcp-server.js';
import type { MCPTool } from '../types/index.js';

// ==================== Mock Data Catalog ====================
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

// ==================== Intent Detection ====================
const intentPatterns: Record<string, RegExp[]> = {
  listProducts: [/产品|广告位|广告产品|有什么广告|可选|available|product|inventory|有什么/i],
  mobile: [/手机|移动|app|mobile|wap/i],
  video: [/视频|广告片|video/i],
  display: [/横幅|banner|展示|display|网页广告/i],
  search: [/搜索|关键词|竞价|search|keyword/i],
  social: [/微信|社交|social|公众号/i],
  ecommerce: [/电商|淘宝|京东|ecommerce|购物/i],
  campaign: [/套餐|campaign|bundle|组合|推荐/i],
  price: [/价格|多少钱|费用|cost|price|budget|报价/i],
  advertiser: [/广告主|客户|advertiser|谁在投/i],
  createOrder: [/下单|创建|投放|create|order|campaign|我要投/i],
  phoneAd: [/手机广告|打手机|phone.*广告|mobile.*ad|推销手机/i],
  hello: [/你好|hello|hi|hey|在吗|help|帮助/i]
};

function detectIntent(message: string): string {
  for (const [intent, patterns] of Object.entries(intentPatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) return intent;
    }
  }
  return 'unknown';
}

function handleIntent(message: string): { type: string; message: string; data: any; recommendation?: string } {
  const intent = detectIntent(message);
  switch (intent) {
    case 'hello':
      return { type: 'greeting', message: '你好！我是广告投放助手\n\n我可以帮你：\n- 查看可用广告位\n- 推荐广告套餐\n- 查询价格和预算\n- 创建投放订单\n\n请问有什么可以帮你的？', data: null };
    case 'listProducts':
      return { type: 'product_list', message: `我们目前有 ${productCatalog.length} 个广告位可投放：`, data: productCatalog };
    case 'phoneAd':
    case 'mobile': {
      const mobileProducts = productCatalog.filter(p => p.category === 'mobile' || p.type === 'splash' || p.description.includes('App'));
      return { type: 'product_list', message: '为你推荐移动端广告位：', data: mobileProducts, recommendation: '手机广告推荐：App开屏广告 曝光量大，适合品牌推广' };
    }
    case 'video': {
      const videoProducts = productCatalog.filter(p => p.category === 'video');
      return { type: 'product_list', message: '视频类广告位：', data: videoProducts };
    }
    case 'display': {
      const displayProducts = productCatalog.filter(p => p.category === 'display');
      return { type: 'product_list', message: '展示类广告位：', data: displayProducts };
    }
    case 'search': {
      const searchProducts = productCatalog.filter(p => p.category === 'search');
      return { type: 'product_list', message: '搜索类广告位：', data: searchProducts };
    }
    case 'social': {
      const socialProducts = productCatalog.filter(p => p.category === 'social');
      return { type: 'product_list', message: '社交类广告位：', data: socialProducts };
    }
    case 'ecommerce': {
      const ecommerceProducts = productCatalog.filter(p => p.category === 'ecommerce');
      return { type: 'product_list', message: '电商类广告位：', data: ecommerceProducts };
    }
    case 'campaign':
      return { type: 'campaign_list', message: '推荐广告套餐：', data: campaignTemplates.map(t => ({ ...t, products: t.products.map((pid: string) => { const p = productCatalog.find(x => x.id === pid); return p ? { id: p.id, name: p.name, rate: p.rate } : null; }).filter(Boolean) })) };
    case 'price':
      return { type: 'price_info', message: '价格说明：\n\n- 展示类（CPM）：¥25-150 / 千次曝光\n- 点击类（CPC）：¥5 / 次点击\n- 按条计费：短信 ¥0.1/条\n- 包段计费：微信推文 ¥200/篇\n\n批量投放可享受套餐折扣（85-90折）', data: { priceRange: { min: 0.1, max: 200, currency: 'CNY' }, billingModels: ['CPM', 'CPC', 'per_post', 'per_sms'] } };
    case 'advertiser':
      return { type: 'advertiser_list', message: '正在投放的广告主：', data: advertisers };
    case 'createOrder':
      return { type: 'create_order', message: '创建投放订单\n\n请提供以下信息：\n1. 选择广告位 ID（如 prod_001）\n2. 投放预算（元）\n3. 投放开始日期\n4. 投放结束日期\n\n例如：我要投 prod_001，预算 5000 元，4月15日到4月30日', data: { requiredFields: ['productId', 'budget', 'startDate', 'endDate'] } };
    default:
      return { type: 'fallback', message: '抱歉，我没有理解你的意图\n\n你可以试试：\n- "有什么广告位？" - 查看所有可用广告\n- "我想打手机广告" - 推荐移动端广告位\n- "有什么套餐？" - 查看推荐套餐\n- "价格多少？" - 查询报价\n- "我要下单" - 创建投放订单', data: null };
  }
}

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
   * Check if message matches a mock intent and return mock response
   */
  private checkMockIntent(userText: string): { type: string; message: string; data: any } | null {
    const intent = detectIntent(userText);
    if (intent !== 'unknown') {
      return handleIntent(userText);
    }
    return null;
  }

  /**
   * Execute user request (SDK AgentExecutor interface)
   */
  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { userMessage, taskId, contextId } = requestContext;
    const userText = this.extractTextFromMessage(userMessage);

    console.log(`🤖 Agent Executor (${this.role}): Processing request`);
    console.log(`📝 User message: ${userText}`);

    // Mark task as active
    this.activeTasks.add(taskId);

    try {
      // Check if this matches a known mock intent
      const mockResponse = this.checkMockIntent(userText);
      if (mockResponse) {
        console.log(`🎯 Mock intent matched: ${mockResponse.type}`);
        const finalMessage = this.createAgentMessage(
          mockResponse.message,
          mockResponse.data,
          contextId,
          taskId
        );
        eventBus.publish(finalMessage);
        eventBus.finished();
        this.activeTasks.delete(taskId);
        return;
      }

      // Step 1: Select appropriate tools using AI
      const planResponse = await this.selectToolWithAI(userText);

      // Check if multi-step or single-step
      const steps = planResponse.steps || [{ toolName: planResponse.toolName, toolParams: planResponse.toolParams }];

      console.log(`📊 Execution plan: ${steps.length} step(s)`);

      const results: any[] = [];
      let previousResult: any = null;

      // Execute each step sequentially
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        console.log(`\n🔧 Step ${i + 1}/${steps.length}: ${step.toolName}`);

        // Replace placeholders with actual results from previous steps
        let params = { ...step.toolParams };
        if (previousResult && previousResult.id) {
          // Replace "__PREVIOUS_RESULT_ID__" placeholder with actual ID
          for (const key in params) {
            if (params[key] === '__PREVIOUS_RESULT_ID__') {
              params[key] = previousResult.id;
              console.log(`🔗 Linked ${key} to previous result ID: ${previousResult.id}`);
            }
          }
        }

        console.log(`📋 Parameters:`, JSON.stringify(params, null, 2));

        // Execute the tool
        const result = await this.executeTool(step.toolName, params);
        results.push({ tool: step.toolName, result });
        previousResult = result;

        console.log(`✅ Step ${i + 1} completed`);

        // Publish intermediate result for multi-step
        if (steps.length > 1) {
          const stepMessage = this.createAgentMessage(
            `Step ${i + 1}/${steps.length}: Successfully executed ${step.toolName}`,
            result,
            contextId,
            taskId
          );
          eventBus.publish(stepMessage);
        }
      }

      console.log(`\n✅ All ${steps.length} step(s) completed successfully`);

      // Step 3: Publish final summary
      const summary = steps.length > 1
        ? `Successfully completed ${steps.length} steps:\n${steps.map((s: any, i: number) => `${i + 1}. ${s.toolName}`).join('\n')}`
        : `Successfully executed ${steps[0].toolName}`;

      const finalMessage = this.createAgentMessage(
        summary,
        steps.length === 1 ? results[0].result : results,
        contextId,
        taskId
      );

      eventBus.publish(finalMessage);
      eventBus.finished();

    } catch (error) {
      console.error(`❌ Execution failed:`, error);

      // Publish error message
      const errorMessage = this.createAgentMessage(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        null,
        contextId,
        taskId
      );

      eventBus.publish(errorMessage);
      eventBus.finished();
    } finally {
      // Remove from active tasks
      this.activeTasks.delete(taskId);
    }
  }

  /**
   * Cancel a running task (SDK AgentExecutor interface)
   */
  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`🚫 Canceling task: ${taskId}`);

    if (!this.activeTasks.has(taskId)) {
      console.warn(`Task ${taskId} not found in active tasks`);
      return;
    }

    // Remove from active tasks
    this.activeTasks.delete(taskId);

    // Publish cancellation event
    const cancelMessage = this.createAgentMessage(
      'Task has been canceled',
      null,
      '', // contextId will be set by SDK
      taskId
    );

    eventBus.publish(cancelMessage);
    eventBus.finished();
  }

  /**
   * Select tool using OpenAI
   */
  private async selectToolWithAI(userMessage: string): Promise<{ toolName: string; toolParams: any; steps?: Array<{ toolName: string; toolParams: any }> }> {
    const toolsWithSchemas = this.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema.properties || {}
    }));

    const systemPrompt = `You are an AI assistant for the OpenDirect ${this.role} agent.
Your job is to analyze user requests and determine which tools to execute.

Available tools with their exact parameter names:
${toolsWithSchemas.map(t => `
- ${t.name}: ${t.description}
  Parameters: ${JSON.stringify(t.parameters, null, 2)}
`).join('\n')}

IMPORTANT RULES:
1. Use the EXACT parameter names from the tool schemas above
2. Use entity names EXACTLY as provided by the user (do NOT add suffixes like "Account" or "Order")
3. For multi-step workflows that need results from previous steps, use the special placeholder: "__PREVIOUS_RESULT_ID__"
4. You must respond with a valid JSON object

Example for "create account for Nike and create order for Nike with budget 500":
{
  "steps": [
    {
      "toolName": "create_account",
      "toolParams": { "name": "Nike", "type": "advertiser" }
    },
    {
      "toolName": "create_order",
      "toolParams": { "accountId": "__PREVIOUS_RESULT_ID__", "name": "Nike", "budget": 500 }
    }
  ]
}

If the request requires only ONE tool, respond with this JSON format:
{
  "toolName": "the_tool_to_use",
  "toolParams": { "paramName": "value" }
}

Always return valid JSON.`;

    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    return JSON.parse(content);
  }

  /**
   * Execute a tool using MCP protocol
   */
  private async executeTool(toolName: string, params: any): Promise<any> {
    console.log(`🔌 Calling MCP tool via protocol: ${toolName}`);

    try {
      // Execute through MCP server using protocol-compliant call
      const response = await this.mcpServer.callTool(toolName, params);

      // Extract result from MCP response
      if (response.content && response.content.length > 0) {
        const textContent = response.content[0];
        if (textContent.type === 'text') {
          // Try to parse JSON response
          try {
            return JSON.parse(textContent.text);
          } catch {
            return textContent.text;
          }
        }
      }

      return response;
    } catch (error) {
      console.error(`❌ MCP tool execution failed:`, error);
      throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract text from message (SDK Message type)
   */
  private extractTextFromMessage(message: Message): string {
    const textParts = message.parts.filter((p: any) => p.kind === 'text');
    return textParts.map((p: any) => p.text).join(' ');
  }

  /**
   * Create agent message (SDK Message type)
   */
  private createAgentMessage(
    text: string,
    data: any,
    contextId: string,
    taskId: string
  ): Message {
    const parts: any[] = [
      { kind: 'text', text }
    ];

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
