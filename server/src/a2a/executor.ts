/**
 * Agent Executor - LLM Driven Intent Recognition with Context Awareness
 * 
 * Architecture:
 * 1. LLM analyzes user message + conversation context
 * 2. LLM determines intent from known intents
 * 3. LLM extracts parameters (product IDs, dates, budgets, etc.)
 * 4. System executes the corresponding mock intent handler
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

// ==================== Intent Definitions ====================
const intentDefinitions = [
  {
    key: 'hello',
    description: '用户打招呼、问候、寻求帮助的意图',
    examples: ['你好', 'hello', 'hi', '在吗', '帮助', 'help', '哈喽']
  },
  {
    key: 'listProducts',
    description: '用户询问有哪些广告位、广告产品、可用库存的意图',
    examples: ['有什么广告位？', '有哪些产品？', '全部广告位', '看看都有什么广告', '列出所有广告位']
  },
  {
    key: 'category',
    description: '用户询问广告位有哪些类型分类、类型分布的意图',
    examples: ['都是什么类型的？', '有哪些广告类型？', '按类型分都有哪些？', '这些广告位分几类？', '分类一下']
  },
  {
    key: 'mobile',
    description: '用户查询移动端广告、App广告、手机广告的意图',
    examples: ['手机广告', '移动广告', 'App广告', '我想投手机广告', '有没有App相关的广告位']
  },
  {
    key: 'video',
    description: '用户查询视频类广告、视频前贴片、短视频广告的意图',
    examples: ['视频广告', '视频前贴', '短视频广告', '我想投视频类的']
  },
  {
    key: 'display',
    description: '用户查询展示类广告、横幅广告、banner广告的意图',
    examples: ['横幅广告', '展示广告', 'banner', '网页展示广告']
  },
  {
    key: 'search',
    description: '用户查询搜索类广告、关键词竞价广告的意图',
    examples: ['搜索广告', '关键词竞价', '搜索关键词广告', '按点击付费的广告']
  },
  {
    key: 'social',
    description: '用户查询社交类广告、微信广告、公众号广告的意图',
    examples: ['微信广告', '社交广告', '公众号广告', '社交媒体广告']
  },
  {
    key: 'ecommerce',
    description: '用户查询电商类广告、淘宝广告、京东广告的意图',
    examples: ['电商广告', '淘宝广告', '京东广告', '购物相关广告']
  },
  {
    key: 'campaign',
    description: '用户询问广告套餐、组合套餐、推荐套餐的意图',
    examples: ['有什么套餐？', '推荐套餐', '组合套餐', '有没有打包优惠']
  },
  {
    key: 'price',
    description: '用户询问价格、费用、报价、预算的意图',
    examples: ['价格多少？', '报价', '费用', '预算', '多少钱', '贵不贵']
  },
  {
    key: 'advertiser',
    description: '用户询问有哪些广告主、谁在投广告的意图',
    examples: ['广告主有哪些？', '谁在投？', '客户列表', '有哪些广告主在投放']
  },
  {
    key: 'createOrder',
    description: '用户想要下单、创建订单、投放广告的意图',
    examples: ['我要下单', '创建订单', '我要投放', '帮我创建一个投放订单']
  }
];

// ==================== Regex Fallback Patterns (for speed) ====================
const intentPatterns: Record<string, RegExp[]> = {
  hello: [/你好|hello|hi|hey|在吗|help|帮助|哈喽/i],
  listProducts: [/产品|广告位|广告产品|有什么广告|可选|available|product|inventory|有什么/i],
  category: [/什么类型|哪些类型|什么种类|广告类型|广告种类|分类|type|category/i],
  mobile: [/手机|移动|app|mobile|wap/i],
  video: [/视频|广告片|video/i],
  display: [/横幅|banner|展示|display|网页广告/i],
  search: [/搜索|关键词|竞价|search|keyword/i],
  social: [/微信|社交|social|公众号/i],
  ecommerce: [/电商|淘宝|京东|ecommerce|购物/i],
  campaign: [/套餐|campaign|bundle|组合|推荐/i],
  price: [/价格|多少钱|费用|cost|price|budget|报价/i],
  advertiser: [/广告主|客户|advertiser|谁在投/i],
  createOrder: [/下单|创建|投放|create|order|campaign|我要投/i]
};

function detectIntentByRegex(message: string): string {
  for (const [intent, patterns] of Object.entries(intentPatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) return intent;
    }
  }
  return 'unknown';
}

// ==================== LLM Intent Classification ====================
function buildIntentPrompt(): string {
  const intentList = intentDefinitions.map(d => {
    return `  - ${d.key}: ${d.description}\n    示例: ${d.examples.join('、')}`;
  }).join('\n');

  return `你是一个广告平台的意图分类助手。用户的消息是关于广告投放的咨询。
请根据用户的话，判断他们想要做什么，并从以下意图列表中选择最匹配的一个。

意图列表：
${intentList}

注意：
1. 如果用户的消息可以对应到多个意图，选择最匹配的那个。
2. 如果用户的消息与广告投放完全无关（如问天气、聊政治、技术问题、数学题等），请返回 "unknown"。
3. 你只能返回意图列表中的一个 key，或 "unknown"，不要返回任何其他内容。`;
}

async function classifyIntentWithLLM(
  message: string,
  contextHistory: string,
  openai: OpenAI
): Promise<string> {
  try {
    const contextInfo = contextHistory
      ? `之前的对话历史（帮助理解上下文）：\n${contextHistory}\n\n`
      : '';

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildIntentPrompt() },
        { role: 'user', content: `${contextInfo}用户当前消息：${message}` }
      ],
      temperature: 0.1,
      max_tokens: 32
    });

    const result = response.choices[0]?.message?.content?.trim().toLowerCase() || 'unknown';

    const knownKeys = intentDefinitions.map(d => d.key);
    if (knownKeys.includes(result)) {
      return result;
    }

    return 'unknown';
  } catch (error) {
    console.error('LLM intent classification failed:', error);
    return 'unknown';
  }
}

// ==================== Parameter Extraction ====================
interface OrderParams {
  productId?: string;
  budget?: number;
  startDate?: string;
  endDate?: string;
}

async function extractOrderParams(userText: string, contextHistory: string, openai: OpenAI): Promise<OrderParams> {
  try {
    const contextInfo = contextHistory
      ? `之前的对话历史：\n${contextHistory}\n\n`
      : '';

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `你是一个广告平台的参数提取助手。从用户的消息中提取下单所需的参数。

需要提取的参数：
- productId: 广告位 ID，格式为 prod_XXX（如 prod_001, prod_002 等）。如果用户说的是广告名称，请匹配到对应的 ID。
- budget: 投放预算金额，数字类型（元）
- startDate: 投放开始日期，字符串（如 "2026-04-15" 或 "4月15日"）
- endDate: 投放结束日期，字符串（如 "2026-04-30" 或 "4月30日"）

如果用户没有提供某个参数，该字段返回 null。
只返回 JSON 对象，不要返回任何其他内容。

广告位参考列表：
prod_001: 首页横幅广告位
prod_002: App开屏广告
prod_003: 信息流原生广告
prod_004: 视频前贴片广告
prod_005: 搜索关键词竞价
prod_006: 侧边栏展示广告
prod_007: 短视频信息流广告
prod_008: 微信公众号推文广告
prod_009: 电商首页焦点图
prod_010: 短信推广`
        },
        { role: 'user', content: `${contextInfo}用户消息：${userText}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 128
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return {};

    const parsed = JSON.parse(content);
    const params: OrderParams = {};

    if (parsed.productId) params.productId = parsed.productId;
    if (parsed.budget) params.budget = typeof parsed.budget === 'number' ? parsed.budget : parseFloat(parsed.budget);
    if (parsed.startDate) params.startDate = parsed.startDate;
    if (parsed.endDate) params.endDate = parsed.endDate;

    return params;
  } catch (error) {
    console.error('LLM parameter extraction failed:', error);
    return {};
  }
}

// ==================== Intent Handler ====================
function handleIntent(
  intent: string,
  message: string,
  role: 'buyer' | 'seller',
  params: Record<string, any> = {}
): { type: string; message: string; data: any; recommendation?: string } {
  const roleLabel = role === 'buyer' ? '买家' : '卖家';

  switch (intent) {
    case 'hello': {
      const buyerGreeting = '你好！我是广告投放助手（买家端）\n\n我可以帮你：\n- 查看可购买的广告位\n- 推荐广告套餐\n- 查询价格和预算\n- 创建投放订单\n\n请问有什么可以帮你的？';
      const sellerGreeting = '你好！我是广告库存助手（卖家端）\n\n我可以帮你：\n- 查看可售卖的广告位库存\n- 管理广告位定价\n- 查看广告主需求\n- 确认订单排期\n\n请问有什么可以帮你的？';
      return { type: 'greeting', message: role === 'buyer' ? buyerGreeting : sellerGreeting, data: null };
    }
    case 'listProducts':
      return { type: 'product_list', message: `【${roleLabel}视角】我们目前有 ${productCatalog.length} 个广告位可投放：`, data: productCatalog };
    case 'category': {
      const categories = [
        { type: '展示', label: 'display', count: productCatalog.filter(p => p.category === 'display').length, products: productCatalog.filter(p => p.category === 'display').map(p => p.name).join('、') },
        { type: '移动', label: 'mobile', count: productCatalog.filter(p => p.category === 'mobile').length, products: productCatalog.filter(p => p.category === 'mobile').map(p => p.name).join('、') },
        { type: '视频', label: 'video', count: productCatalog.filter(p => p.category === 'video').length, products: productCatalog.filter(p => p.category === 'video').map(p => p.name).join('、') },
        { type: '信息流', label: 'feed', count: productCatalog.filter(p => p.category === 'feed').length, products: productCatalog.filter(p => p.category === 'feed').map(p => p.name).join('、') },
        { type: '搜索', label: 'search', count: productCatalog.filter(p => p.category === 'search').length, products: productCatalog.filter(p => p.category === 'search').map(p => p.name).join('、') },
        { type: '社交', label: 'social', count: productCatalog.filter(p => p.category === 'social').length, products: productCatalog.filter(p => p.category === 'social').map(p => p.name).join('、') },
        { type: '电商', label: 'ecommerce', count: productCatalog.filter(p => p.category === 'ecommerce').length, products: productCatalog.filter(p => p.category === 'ecommerce').map(p => p.name).join('、') },
        { type: '直投', label: 'direct', count: productCatalog.filter(p => p.category === 'direct').length, products: productCatalog.filter(p => p.category === 'direct').map(p => p.name).join('、') }
      ];
      const categoryText = categories.filter(c => c.count > 0).map(c => `${c.type}（${c.count}个）：${c.products}`).join('\n');
      return { type: 'category_list', message: `【${roleLabel}视角】广告位类型分类：\n\n${categoryText}`, data: categories.filter(c => c.count > 0) };
    }
    case 'phoneAd':
    case 'mobile': {
      const mobileProducts = productCatalog.filter(p => p.category === 'mobile' || p.type === 'splash' || p.description.includes('App'));
      return { type: 'product_list', message: `【${roleLabel}视角】为你推荐移动端广告位：`, data: mobileProducts, recommendation: '手机广告推荐：App开屏广告 曝光量大，适合品牌推广' };
    }
    case 'video': {
      const videoProducts = productCatalog.filter(p => p.category === 'video');
      return { type: 'product_list', message: `【${roleLabel}视角】视频类广告位：`, data: videoProducts };
    }
    case 'display': {
      const displayProducts = productCatalog.filter(p => p.category === 'display');
      return { type: 'product_list', message: `【${roleLabel}视角】展示类广告位：`, data: displayProducts };
    }
    case 'search': {
      const searchProducts = productCatalog.filter(p => p.category === 'search');
      return { type: 'product_list', message: `【${roleLabel}视角】搜索类广告位：`, data: searchProducts };
    }
    case 'social': {
      const socialProducts = productCatalog.filter(p => p.category === 'social');
      return { type: 'product_list', message: `【${roleLabel}视角】社交类广告位：`, data: socialProducts };
    }
    case 'ecommerce': {
      const ecommerceProducts = productCatalog.filter(p => p.category === 'ecommerce');
      return { type: 'product_list', message: `【${roleLabel}视角】电商类广告位：`, data: ecommerceProducts };
    }
    case 'campaign':
      return { type: 'campaign_list', message: `【${roleLabel}视角】推荐广告套餐：`, data: campaignTemplates.map(t => ({ ...t, products: t.products.map((pid: string) => { const p = productCatalog.find(x => x.id === pid); return p ? { id: p.id, name: p.name, rate: p.rate } : null; }).filter(Boolean) })) };
    case 'price': {
      const buyerPrice = '【买家视角】价格说明：\n\n- 展示类（CPM）：¥25-150 / 千次曝光\n- 点击类（CPC）：¥5 / 次点击\n- 按条计费：短信 ¥0.1/条\n- 包段计费：微信推文 ¥200/篇\n\n批量投放可享受套餐折扣（85-90折）';
      const sellerPrice = '【卖家视角】广告位定价说明：\n\n- 展示类（CPM）：报价 ¥25-150 / 千次曝光\n- 点击类（CPC）：报价 ¥5 / 次点击\n- 按条计费：短信 ¥0.1/条\n- 包段计费：微信推文 ¥200/篇\n\n批量订单可申请专属折扣';
      return { type: 'price_info', message: role === 'buyer' ? buyerPrice : sellerPrice, data: { priceRange: { min: 0.1, max: 200, currency: 'CNY' }, billingModels: ['CPM', 'CPC', 'per_post', 'per_sms'] } };
    }
    case 'advertiser':
      return { type: 'advertiser_list', message: `【${roleLabel}视角】正在投放的广告主：`, data: advertisers };
    case 'createOrder': {
      const missingFields: string[] = [];
      if (!params.productId) missingFields.push('广告位 ID（如 prod_001）');
      if (!params.budget) missingFields.push('投放预算（元）');
      if (!params.startDate) missingFields.push('投放开始日期');
      if (!params.endDate) missingFields.push('投放结束日期');

      if (missingFields.length === 0) {
        // All params provided, simulate order creation
        const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;
        const product = productCatalog.find(p => p.id === params.productId);
        const productName = product ? product.name : params.productId;
        const estimatedImpressions = product && product.unit === 'CPM'
          ? Math.round((params.budget / product.rate) * 1000).toLocaleString()
          : params.budget;

        const buyerConfirm = `✅ 【买家】订单创建成功！

订单号：${orderId}
广告位：${productName}（${params.productId}）
预算：¥${params.budget.toLocaleString()}
投放日期：${params.startDate} 至 ${params.endDate}

${product ? `预估曝光量：${estimatedImpressions} 次` : ''}

订单已提交，正在处理中...`;

        const sellerConfirm = `✅ 【卖家】订单排期已确认

订单号：${orderId}
广告位：${productName}（${params.productId}）
预算：¥${params.budget.toLocaleString()}
排期日期：${params.startDate} 至 ${params.endDate}

排期已确认，等待广告素材...`;

        return {
          type: 'order_created',
          message: role === 'buyer' ? buyerConfirm : sellerConfirm,
          data: { orderId, productId: params.productId, budget: params.budget, startDate: params.startDate, endDate: params.endDate }
        };
      }

      // Missing fields, ask user to provide
      const buyerOrder = '【买家】创建投放订单\n\n请提供以下信息：\n1. 选择广告位 ID（如 prod_001）\n2. 投放预算（元）\n3. 投放开始日期\n4. 投放结束日期\n\n例如：我要投 prod_001，预算 5000 元，4月15日到4月30日';
      const sellerOrder = '【卖家】确认订单排期\n\n请提供以下信息：\n1. 客户订单号\n2. 广告位 ID（如 prod_001）\n3. 确认排期开始日期\n4. 确认排期结束日期\n\n例如：确认订单 prod_001，4月15日到4月30日';
      return { type: 'create_order', message: role === 'buyer' ? buyerOrder : sellerOrder, data: { requiredFields: missingFields } };
    }
    default:
      return { type: 'fallback', message: '抱歉，我没有理解你的意图\n\n你可以试试：\n- "有什么广告位？" - 查看所有可用广告\n- "我想打手机广告" - 推荐移动端广告位\n- "有什么套餐？" - 查看推荐套餐\n- "价格多少？" - 查询报价\n- "我要下单" - 创建投放订单', data: null };
  }
}

// ==================== Context History Manager ====================
interface ConversationEntry {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

const contextHistory = new Map<string, ConversationEntry[]>();

function getContextHistory(contextId: string): string {
  const entries = contextHistory.get(contextId) || [];
  return entries
    .slice(-10) // Keep last 10 messages
    .map(e => `${e.role === 'user' ? '用户' : 'Agent'}: ${e.text}`)
    .join('\n');
}

function addContextEntry(contextId: string, entry: ConversationEntry) {
  const entries = contextHistory.get(contextId) || [];
  entries.push(entry);
  // Keep max 20 entries to avoid growing too large
  if (entries.length > 20) entries.splice(0, entries.length - 20);
  contextHistory.set(contextId, entries);
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
   * Detect intent: regex first (fast), then LLM with context (smart)
   */
  private async detectIntent(
    userText: string,
    contextId: string
  ): Promise<string> {
    // Step 1: Regex detection (fast, no API call)
    const regexIntent = detectIntentByRegex(userText);
    if (regexIntent !== 'unknown') {
      console.log(`🎯 Regex matched: "${userText}" -> ${regexIntent}`);
      return regexIntent;
    }

    // Step 2: LLM detection with context awareness
    const contextHistory = getContextHistory(contextId);
    const llmIntent = await classifyIntentWithLLM(userText, contextHistory, this.openai);
    if (llmIntent !== 'unknown') {
      console.log(`🧠 LLM matched: "${userText}" -> ${llmIntent}`);
    } else {
      console.log(`❌ No intent matched: "${userText}"`);
    }
    return llmIntent;
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

    // Mark task as active
    this.activeTasks.add(taskId);

    try {
      // Step 1: Detect intent (regex → LLM with context)
      const intent = await this.detectIntent(userText, contextId);

      // Step 2: If intent is unknown, return friendly fallback
      if (intent === 'unknown') {
        const fallbackMessage = '抱歉，我没有理解你的意图\n\n你可以试试：\n- "有什么广告位？" - 查看所有可用广告\n- "我想打手机广告" - 推荐移动端广告位\n- "有什么套餐？" - 查看推荐套餐\n- "价格多少？" - 查询报价\n- "我要下单" - 创建投放订单';
        const finalMessage = this.createAgentMessage(fallbackMessage, null, contextId, taskId);
        eventBus.publish(finalMessage);
        eventBus.finished();
        this.activeTasks.delete(taskId);
        return;
      }

      // Step 3: For intents that need parameter extraction (like createOrder), extract params first
      let params: Record<string, any> = {};
      if (intent === 'createOrder') {
        const contextHist = getContextHistory(contextId);
        params = await extractOrderParams(userText, contextHist, this.openai);
        console.log(`📦 Extracted params:`, JSON.stringify(params));
      }

      // Step 4: Execute the matched intent with extracted params
      const result = handleIntent(intent, userText, this.role, params);
      console.log(`✅ Intent executed: ${result.type}`);

      // Save to context history
      addContextEntry(contextId, { role: 'user', text: userText, timestamp: Date.now() });
      addContextEntry(contextId, { role: 'agent', text: result.message, timestamp: Date.now() });

      // Step 4: Publish response
      const finalMessage = this.createAgentMessage(
        result.message,
        result.data,
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
   * Cancel a running task (SDK AgentExecutor interface)
   */
  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    console.log(`🚫 Canceling task: ${taskId}`);

    if (!this.activeTasks.has(taskId)) {
      console.warn(`Task ${taskId} not found in active tasks`);
      return;
    }

    this.activeTasks.delete(taskId);

    const cancelMessage = this.createAgentMessage(
      'Task has been canceled',
      null,
      '',
      taskId
    );

    eventBus.publish(cancelMessage);
    eventBus.finished();
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
