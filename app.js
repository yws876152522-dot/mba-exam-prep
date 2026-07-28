/* =========================================================================
   考神 · MBA备考助手
   纯前端实现：localStorage 存储，支持演示模式与 API 模式
   ========================================================================= */

(() => {
'use strict';

// ============== 工具 ==============
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const uid = () => 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (ts) => {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// ============== 状态与存储 ==============
const STORAGE_KEYS = {
  mistakes: 'kaoshen_mistakes_v1',
  settings: 'kaoshen_settings_v1',
  practice: 'kaoshen_practice_v1',
  bank:     'kaoshen_bank_v1',
  profiles: 'kaoshen_profiles_v1',
};

const defaultSettings = {
  mode: 'mock',           // mock | api
  ocrProvider: 'paddle',  // paddle | mock | baidu | tencent
  ocrKey: '',
  gptModel: 'gpt-4o',
  gptEndpoint: 'https://api.openai.com/v1/chat/completions',
  gptKey: '',
};

// 预设 API 方案：翻墙用 GPT，不翻墙用 DeepSeek，一键切换
// Key 不硬编码（公网安全），首次打开用配置链接自动注入
const defaultProfiles = [
  {
    name: 'DeepSeek 🇨🇳',
    desc: '国内直连 · ¥1/百万token · 不用翻墙',
    settings: {
      mode: 'api',
      ocrProvider: 'paddle',
      ocrKey: '',
      gptModel: 'deepseek-chat',
      gptEndpoint: 'https://api.deepseek.com/v1/chat/completions',
      gptKey: '',
    },
  },
  {
    name: 'GPT-4o 🌐',
    desc: 'OpenAI · 需翻墙 · 效果更强',
    settings: {
      mode: 'api',
      ocrProvider: 'paddle',
      ocrKey: '',
      gptModel: 'gpt-4o',
      gptEndpoint: 'https://api.openai.com/v1/chat/completions',
      gptKey: '',
    },
  },
  {
    name: '演示模式',
    desc: '内置题库 · 无需配置 · 离线可用',
    settings: { ...defaultSettings },
  },
];

let state = {
  mistakes: [],
  practice: { count: 0, log: [] },
  settings: { ...defaultSettings },
  profiles: [],
  currentMistakeDraft: null,
  currentSolveImages: [],
  currentMistakeImages: [],
  currentSolveText: '',
  currentPracticeQ: null,
};

let cropState = null;
let paddleOcrEngine = null;
let paddleOcrLoading = null;

function loadState() {
  try { state.mistakes = JSON.parse(localStorage.getItem(STORAGE_KEYS.mistakes) || '[]'); } catch { state.mistakes = []; }
  try { state.practice = JSON.parse(localStorage.getItem(STORAGE_KEYS.practice) || '{"count":0,"log":[]}'); } catch { state.practice = { count: 0, log: [] }; }
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || 'null');
    state.settings = { ...defaultSettings, ...(s || {}) };
  } catch { state.settings = { ...defaultSettings }; }
  loadProfiles();
}
function saveMistakes() { localStorage.setItem(STORAGE_KEYS.mistakes, JSON.stringify(state.mistakes)); }
function savePractice() { localStorage.setItem(STORAGE_KEYS.practice, JSON.stringify(state.practice)); }
function saveSettings() { localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings)); }
function loadProfiles() {
  try { state.profiles = JSON.parse(localStorage.getItem(STORAGE_KEYS.profiles) || 'null'); } catch { state.profiles = null; }
  if (!state.profiles || !state.profiles.length) {
    state.profiles = JSON.parse(JSON.stringify(defaultProfiles));
    saveProfiles();
  }
}
function saveProfiles() { localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(state.profiles)); }
function applyProfile(idx) {
  const p = state.profiles[idx];
  if (!p) return;
  state.settings = { ...p.settings };
  saveSettings();
  toast('✅ 已切换到「' + p.name + '」');
}
function detectActiveProfile() {
  const s = state.settings;
  for (let i = 0; i < state.profiles.length; i++) {
    const ps = state.profiles[i].settings;
    if (ps.gptEndpoint === s.gptEndpoint && ps.gptModel === s.gptModel && ps.gptKey === s.gptKey && ps.mode === s.mode) return i;
  }
  return -1;
}

// URL hash 自动配置：打开带 #mode=api&model=xxx&endpoint=xxx&key=xxx 的链接自动写入设置
// 支持 dk= (DeepSeek Key) 和 gk= (GPT Key) 同时注入两个预设
function autoConfigFromURL() {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;
  const params = new URLSearchParams(hash);

  // 批量注入 Key 到预设：dk=DeepSeek Key, gk=GPT Key
  let injected = false;
  const dk = params.get('dk');
  const gk = params.get('gk');
  if (dk) {
    state.profiles.forEach(p => {
      if (p.settings.gptEndpoint.includes('deepseek')) { p.settings.gptKey = dk; injected = true; }
    });
  }
  if (gk) {
    state.profiles.forEach(p => {
      if (p.settings.gptEndpoint.includes('openai') || p.settings.gptModel.includes('gpt')) { p.settings.gptKey = gk; injected = true; }
    });
  }
  if (injected) saveProfiles();

  // 单个配置（兼容旧格式）
  const key = params.get('key');
  if (key) {
    state.settings = {
      ...state.settings,
      mode: params.get('mode') || 'api',
      gptModel: params.get('model') || 'deepseek-chat',
      gptEndpoint: params.get('endpoint') || 'https://api.deepseek.com/v1/chat/completions',
      gptKey: key,
    };
    // 同步写入对应预设
    state.profiles.forEach(p => {
      if (p.settings.gptEndpoint === state.settings.gptEndpoint) {
        p.settings.gptKey = key;
        p.settings.mode = state.settings.mode;
      }
    });
    saveSettings();
    saveProfiles();
    injected = true;
  }

  if (!injected) return false;

  // 清除 hash，避免 Key 残留在地址栏/历史记录
  history.replaceState(null, '', window.location.pathname + window.location.search);

  setTimeout(() => toast('✅ API Key 已自动注入，点右上角按钮切换', 3000), 500);
  return true;
}

// ============== UI 辅助 ==============
function toast(msg, ms=1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.hidden = true; }, ms);
}
function openModal(id) { $('#' + id).hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(id) { $('#' + id).hidden = true; document.body.style.overflow = ''; }
function closeAllModals() { $$('.modal').forEach(m => m.hidden = true); document.body.style.overflow = ''; }

// ============== Tab 切换 ==============
function switchTab(tab) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  if (tab === 'stats') renderStats();
  if (tab === 'mistakes') renderMistakes();
}

// ============== OCR 调用 ==============
async function callOCR(images) {
  // images: [{ dataUrl, name }]
  if (state.settings.mode === 'mock') {
    return mockOCR(images);
  }
  // 免费本地 OCR：不上传图片，不需要 Key，适合国内直连。
  if (state.settings.ocrProvider === 'paddle' || state.settings.ocrProvider === 'mock') {
    try {
      return await callPaddleOCR(images);
    } catch (e) {
      console.error(e);
      toast('本地 OCR 失败，尝试视觉识别备用方案', 3000);
      try {
        const result = await callVisionOCR(images);
        if (result) return result;
      } catch (visionError) {
        console.error(visionError);
      }
    }
    return {
      text: '',
      confidence: 0,
      needsManual: true,
      message: '本地 OCR 加载失败，请检查网络后重试，或手动输入题目。'
    };
  }
  // 真实 Provider 留扩展点
  if (state.settings.ocrProvider === 'baidu') {
    return await callBaiduOCR(images);
  }
  if (state.settings.ocrProvider === 'tencent') {
    return await callTencentOCR(images);
  }
  return mockOCR(images);
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.PaddleOCR) resolve();
      else existing.addEventListener('load', resolve, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('PaddleOCR 运行库加载失败'));
    document.head.appendChild(script);
  });
}

async function getPaddleOcrEngine() {
  if (paddleOcrEngine) return paddleOcrEngine;
  if (paddleOcrLoading) return paddleOcrLoading;
  paddleOcrLoading = (async () => {
    await loadScriptOnce('vendor/paddleocr.bundle.js');
    if (!window.PaddleOCR) throw new Error('PaddleOCR 初始化失败');
    const engine = await window.PaddleOCR.create({
      lang: 'ch',
      ocrVersion: 'PP-OCRv5',
      ortOptions: {
        backend: 'wasm',
        wasmPaths: new URL('vendor/', window.location.href).href,
        numThreads: 1,
        simd: true
      }
    });
    paddleOcrEngine = engine;
    return engine;
  })();
  try {
    return await paddleOcrLoading;
  } finally {
    paddleOcrLoading = null;
  }
}

async function callPaddleOCR(images) {
  const engine = await getPaddleOcrEngine();
  const inputs = await Promise.all(images.map(async image => {
    const response = await fetch(image.dataUrl);
    return await response.blob();
  }));
  const results = await engine.predict(inputs, {
    textDetLimitSideLen: 1280,
    textDetLimitType: 'max',
    textRecScoreThresh: 0.35
  });
  const allItems = results.flatMap((result, imageIndex) =>
    (result.items || []).map(item => ({ ...item, imageIndex }))
  );
  allItems.sort((a, b) => {
    if (a.imageIndex !== b.imageIndex) return a.imageIndex - b.imageIndex;
    const ay = Math.min(...a.poly.map(p => p[1]));
    const by = Math.min(...b.poly.map(p => p[1]));
    if (Math.abs(ay - by) > 12) return ay - by;
    return Math.min(...a.poly.map(p => p[0])) - Math.min(...b.poly.map(p => p[0]));
  });
  const scores = allItems.map(item => Number(item.score) || 0);
  const confidence = scores.length ? scores.reduce((a,b) => a+b, 0) / scores.length : 0;
  const uncertain = allItems.filter(item => Number(item.score) < .62).map(item => item.text).filter(Boolean);
  return {
    text: allItems.map(item => item.text).join('\n'),
    confidence,
    uncertain,
    provider: '飞桨 PaddleOCR（本地）'
  };
}

function getVisionProfile() {
  const active = state.settings;
  if (active.mode === 'api' && /openai\.com/i.test(active.gptEndpoint || '') && active.gptKey) return active;
  const profile = state.profiles.find(p =>
    p.settings?.mode === 'api' &&
    /openai\.com/i.test(p.settings.gptEndpoint || '') &&
    p.settings.gptKey
  );
  return profile?.settings || null;
}

async function callVisionOCR(images) {
  const vision = getVisionProfile();
  if (!vision) return null;
  const content = [{
    type: 'text',
    text: `你是MBA考试题目转写器。请逐字识别图片中的题目，只输出JSON：
{"text":"完整题目","confidence":0到1之间的小数,"uncertain":["不确定的片段"]}
要求：
1. 保留题号、题干、所有条件与A-E选项；
2. 数学公式用清晰的纯文本/LaTeX，根号必须保留完整作用范围；
3. 不要识别图片之外的内容，不要解题，不要补写；
4. 忽略答案、解析、页眉页脚、手写划线和水印；
5. 如果字符不确定，在uncertain中列出，不要凭空猜测。`
  }];
  images.forEach(i => content.push({ type: 'image_url', image_url: { url: i.dataUrl, detail: 'high' } }));
  const resp = await fetch(vision.gptEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vision.gptKey}` },
    body: JSON.stringify({
      model: vision.gptModel || 'gpt-4o',
      messages: [
        { role: 'system', content: '你只负责忠实转写考试题目，输出合法JSON。' },
        { role: 'user', content }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  });
  if (!resp.ok) throw new Error(`视觉识别请求失败（${resp.status}）`);
  const data = await resp.json();
  const parsed = safeParse(data?.choices?.[0]?.message?.content || '{}');
  return {
    text: parsed.text || '',
    confidence: Number(parsed.confidence) || 0,
    uncertain: Array.isArray(parsed.uncertain) ? parsed.uncertain : [],
    provider: vision.gptModel || 'GPT视觉'
  };
}
function mockOCR(images) {
  // 演示用：根据上传与否返回一段典型题目
  return new Promise(res => setTimeout(() => {
    const sample = `（演示识别）请根据以下题目作答：

已知函数 f(x) = x^2 - 2x + 1，求 f(2) 的值。

A. 0
B. 1
C. 2
D. 3`;
    res({ text: sample, confidence: 0.93, mock: true });
  }, 600));
}
async function callBaiduOCR(images) {
  // 占位：实际使用百度 OCR 通用文字识别（高精度版）API
  // 文档：https://cloud.baidu.com/doc/OCR/s/Vk3h7y58v
  // 实现时需先获取 access_token，再调用 recognize 图片接口
  toast('百度 OCR 接口未配置，请先在设置中填写 API Key', 2500);
  return mockOCR(images);
}
async function callTencentOCR(images) {
  // 占位：实际使用腾讯云通用 OCR
  // 文档：https://cloud.tencent.com/document/product/866
  toast('腾讯云 OCR 接口未配置，请先在设置中填写 API Key', 2500);
  return mockOCR(images);
}

// ============== GPT 调用 ==============
async function callGPT(prompt, opts={}) {
  if (state.settings.mode === 'mock') return mockGPT(prompt, opts);
  return await callRealGPT(prompt, opts);
}
function mockGPT(prompt, opts) {
  return new Promise(res => setTimeout(() => {
    const kind = opts.kind || 'solve';
    let text = '';
    if (kind === 'solve') {
      text = JSON.stringify({
        approach: `【思路拆解】
1. 提取题目关键信息：题目给出的函数定义与求值条件。
2. 把 x=2 代入 f(x) = x^2 - 2x + 1。
3. 先算平方与乘积，再合并同类项。

【易错点提醒】
- 注意完全平方公式的展开 (x-1)^2 = x^2 - 2x + 1，本题即 (x-1)^2 形式。
- 代入后顺序：先平方，再乘，再加减，避免符号错误。`,
        final: `【最优解】
f(2) = 2^2 - 2·2 + 1
     = 4 - 4 + 1
     = 1

【答案】B. 1`,
      });
    } else if (kind === 'approach') {
      text = JSON.stringify({
        approach: `【解题思路】
1. 审题：明确题目要求与已知条件。
2. 关联知识点：回忆对应的公式/定理/模型。
3. 列出关键步骤：先算什么，再算什么。
4. 验算：用特殊值或逆运算回带检验。

【同类题套路】
- 把原式化为标准形式（配方/因式分解/最简分式）。
- 注意定义域与端点。
- 结果带回原条件检验。`,
      });
    } else if (kind === 'question') {
      // 出题
      const subj = opts.subject || '综合-数学';
      const diff = opts.difficulty || 'medium';
      text = JSON.stringify(mockQuestion(subj, diff));
    } else {
      text = JSON.stringify({ note: '未知类型' });
    }
    res({ raw: text, mock: true });
  }, 700));
}
async function callRealGPT(prompt, opts) {
  const { gptEndpoint, gptKey, gptModel } = state.settings;
  if (!gptEndpoint || !gptKey) {
    toast('请先在设置中配置 GPT Endpoint 与 Key', 2500);
    return mockGPT(prompt, opts);
  }
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${gptKey}`,
  };
  const messages = [
    { role: 'system', content: opts.system || '你是MBA备考专家，输出请使用JSON。' },
    { role: 'user', content: prompt },
  ];
  const baseBody = { model: gptModel, messages, temperature: opts.temperature ?? 0.5 };
  try {
    // 先尝试带 response_format（OpenAI / DeepSeek 支持）
    let resp = await fetch(gptEndpoint, {
      method: 'POST', headers,
      body: JSON.stringify({ ...baseBody, response_format: { type: 'json_object' } }),
    });
    // 如果不支持 response_format（400/422），降级重试
    if (resp.status === 400 || resp.status === 422) {
      resp = await fetch(gptEndpoint, {
        method: 'POST', headers,
        body: JSON.stringify(baseBody),
      });
    }
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || '{}';
    return { raw: text };
  } catch (e) {
    console.error(e);
    toast('GPT 请求失败：' + e.message.slice(0, 80), 3000);
    return mockGPT(prompt, opts);
  }
}

// ============== 模拟题库 ==============
function mockQuestion(subject, difficulty) {
  const banks = {
    '综合-数学': [
      {
        stem: '已知等差数列 {a_n} 满足 a_3 = 7, a_7 = 15, 求 a_10。',
        options: ['A. 19', 'B. 20', 'C. 21', 'D. 22'],
        answer: 'C',
        explain: '由 a_7 - a_3 = 4d = 8, 得 d=2。a_10 = a_3 + 7d = 7 + 14 = 21。',
        difficulty: 'easy',
      },
      {
        stem: '若 x + 1/x = 3，则 x^2 + 1/x^2 = ?',
        options: ['A. 7', 'B. 8', 'C. 9', 'D. 11'],
        answer: 'A',
        explain: 'x^2 + 1/x^2 = (x+1/x)^2 - 2 = 9 - 2 = 7。',
        difficulty: 'easy',
      },
      {
        stem: '袋中有 3 个红球、2 个白球，不放回地连取 2 球，2 球颜色相同的概率为？',
        options: ['A. 2/5', 'B. 3/10', 'C. 4/5', 'D. 7/10'],
        answer: 'A',
        explain: 'C(3,2)/C(5,2) + C(2,2)/C(5,2) = 3/10 + 1/10 = 4/10 = 2/5。',
        difficulty: 'medium',
      },
      {
        stem: '某商品原价 200 元，先降价 20%，再涨价 25%，现价是多少？',
        options: ['A. 200 元', 'B. 190 元', 'C. 210 元', 'D. 220 元'],
        answer: 'A',
        explain: '200 × 0.8 × 1.25 = 200。降价 20% 再涨价 25%（基于降价后的价）恰好回到原价。',
        difficulty: 'easy',
      },
      {
        stem: '甲乙合作完成一项工程，甲单独需 10 天，乙单独需 15 天，两人合作需几天？',
        options: ['A. 5 天', 'B. 6 天', 'C. 7 天', 'D. 8 天'],
        answer: 'B',
        explain: '合作效率 = 1/10 + 1/15 = 5/30 = 1/6，故需 6 天。',
        difficulty: 'medium',
      },
      {
        stem: '圆 x² + y² - 4x + 2y - 4 = 0 的圆心坐标和半径为？',
        options: ['A. (2,-1), r=3', 'B. (-2,1), r=3', 'C. (2,-1), r=9', 'D. (-2,1), r=9'],
        answer: 'A',
        explain: '配方：(x-2)² + (y+1)² = 9，圆心 (2,-1)，半径 r=3。',
        difficulty: 'hard',
      },
    ],
    '综合-逻辑': [
      {
        stem: '所有 A 都是 B, 有些 C 是 A。由此可以推出：',
        options: ['A. 所有 C 都是 B', 'B. 有些 B 是 C', 'C. 所有 B 都是 A', 'D. 没有 C 是 B'],
        answer: 'B',
        explain: '有些 C 是 A，且所有 A 都是 B，所以有些 B 是 C。',
        difficulty: 'easy',
      },
      {
        stem: '如果"只有不下雨，小李才去公园"为真，则以下哪项必然为真？',
        options: ['A. 下雨时小李不去公园', 'B. 小李去公园时没下雨', 'C. 不下雨时小李一定去公园', 'D. 下雨时小李去公园'],
        answer: 'B',
        explain: '"只有...才..."后推前：去公园 → 不下雨。',
        difficulty: 'medium',
      },
      {
        stem: '所有参加会议的人都发了言，有些发言的人提出了建议。由此可以推出：',
        options: ['A. 所有参会的人都提出了建议', 'B. 有些参会的人提出了建议', 'C. 没有参会的人提出了建议', 'D. 所有提出建议的人都参加了会议'],
        answer: 'B',
        explain: '有些发言的人提出建议 + 所有参会的人都发言 → 有些参会的人提出建议。',
        difficulty: 'medium',
      },
      {
        stem: '甲乙丙丁四人比赛，已知：①甲不是第一；②乙不是最后；③丙在甲前面；④丁紧挨乙后面。下列哪项可能是最终排名？',
        options: ['A. 丙甲丁乙', 'B. 丙丁乙甲', 'C. 乙丁丙甲', 'D. 丁乙丙甲'],
        answer: 'C',
        explain: '丁紧挨乙后面→顺序含"乙丁"；丙在甲前→"丙…甲"；甲非第一、乙非最后。C：乙丁丙甲 满足全部条件。',
        difficulty: 'hard',
      },
    ],
    '综合-写作': [
      {
        stem: '请以"专注"为题，列出 3 个支持论点和 1 个可能反驳。',
        options: ['论据要点型 · 自由作答'],
        answer: '参考结构：1）专注带来深度；2）稀缺资源下的必然选择；3）反例：信息过载下需要适度切换。反驳：过度专注可能错过跨界机会。',
        explain: 'MBA 论证有效性分析典型结构：论点→论据→可能漏洞→修正。',
        difficulty: 'medium',
      },
    ],
    '综合-语文': [
      {
        stem: '下列词语没有错别字的一项是：',
        options: ['A. 再接再厉', 'B. 饮鸩止渴', 'C. 滥竽充数', 'D. 按部就班'],
        answer: 'D',
        explain: 'A 应为"再接再厉"（正确），B 应为"饮鸩止渴"（正确），C 应为"滥竽充数"（正确），A 项"再接再厉"正确但常误写为"再接再励"，本题选 D 全部无误。',
        difficulty: 'easy',
      },
    ],
    '英语二': [
      {
        stem: 'Choose the best word: The proposal was met with _______ opposition from the board.',
        options: ['A. vigorous', 'B. vigorousness', 'C. vigor', 'D. vigorously'],
        answer: 'A',
        explain: '修饰名词 opposition 应用形容词 vigorous。',
        difficulty: 'easy',
      },
      {
        stem: 'If I ______ you, I would take the job.',
        options: ['A. am', 'B. was', 'C. were', 'D. be'],
        answer: 'C',
        explain: '虚拟语气：与现在事实相反用 were。',
        difficulty: 'easy',
      },
      {
        stem: 'The new policy will take effect _______ the board approves it next month.',
        options: ['A. unless', 'B. provided that', 'C. even though', 'D. as if'],
        answer: 'B',
        explain: 'provided that = 只要/如果，表条件。句意：只要董事会下月批准，新政策就将生效。',
        difficulty: 'medium',
      },
      {
        stem: '翻译：近年来，越来越多的中国企业开始关注可持续发展，并将其纳入企业战略。',
        options: ['A. 自由翻译题（参考解析）', 'B. 略'],
        answer: 'In recent years, more and more Chinese enterprises have begun to focus on sustainable development and incorporated it into their corporate strategy.',
        explain: '关键词：近年来 in recent years；越来越多 more and more；关注 focus on；可持续发展 sustainable development；纳入 incorporate into；企业战略 corporate strategy。',
        difficulty: 'medium',
      },
    ],
  };
  const pool = banks[subject] || banks['综合-数学'];
  const filtered = pool.filter(q => !difficulty || q.difficulty === difficulty || difficulty === 'medium');
  const q = filtered[Math.floor(Math.random() * filtered.length)] || pool[0];
  return { ...q, subject, source: 'bank' };
}

function pickMistakeAsQuestion(subject) {
  const filtered = state.mistakes.filter(m => !subject || subject === '随机' || m.subject === subject);
  if (filtered.length === 0) return null;
  const m = filtered[Math.floor(Math.random() * filtered.length)];
  return {
    stem: m.question,
    options: ['A. 略', 'B. 略', 'C. 略', 'D. 略'],
    answer: m.answer,
    explain: m.approach,
    difficulty: 'medium',
    subject: m.subject,
    source: 'mistake',
    mistakeId: m.id,
  };
}

function mixQuestion(subject, difficulty) {
  if (Math.random() < 0.4) {
    const q = pickMistakeAsQuestion(subject);
    if (q) return q;
  }
  const allSubjects = ['综合-数学', '综合-逻辑', '综合-写作', '综合-语文', '英语二'];
  const subj = subject === '随机' ? allSubjects[Math.floor(Math.random() * allSubjects.length)] : subject;
  return mockQuestion(subj, difficulty);
}

// ============== 图片框选与增强 ==============
function openCropper(dataUrl, name) {
  return new Promise(resolve => {
    const image = $('#cropImage');
    cropState = {
      dataUrl, name, resolve, imageRect: null,
      box: { x: 0, y: 0, w: 0, h: 0 },
      drag: null
    };
    image.onload = () => {
      openModal('cropModal');
      // 弹窗隐藏时容器宽高为 0；必须显示后再计算图片与选区尺寸。
      requestAnimationFrame(() => {
        layoutCropImage();
        resetCropSelection();
      });
    };
    image.src = dataUrl;
  });
}

function layoutCropImage() {
  if (!cropState) return;
  const stage = $('#cropStage');
  const image = $('#cropImage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const scale = Math.min(sw / image.naturalWidth, sh / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  const x = (sw - w) / 2, y = (sh - h) / 2;
  Object.assign(image.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  cropState.imageRect = { x, y, w, h, scale };
}

function resetCropSelection() {
  if (!cropState?.imageRect) return;
  const r = cropState.imageRect;
  cropState.box = {
    x: r.x + r.w * .05,
    y: r.y + r.h * .18,
    w: r.w * .90,
    h: r.h * .64
  };
  renderCropBox();
}

function renderCropBox() {
  if (!cropState) return;
  const b = cropState.box, r = cropState.imageRect;
  const box = $('#cropBox');
  Object.assign(box.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
  Object.assign($('.crop-shade-top').style, { left:r.x+'px', top:r.y+'px', width:r.w+'px', height:Math.max(0,b.y-r.y)+'px' });
  Object.assign($('.crop-shade-bottom').style, { left:r.x+'px', top:(b.y+b.h)+'px', width:r.w+'px', height:Math.max(0,r.y+r.h-b.y-b.h)+'px' });
  Object.assign($('.crop-shade-left').style, { left:r.x+'px', top:b.y+'px', width:Math.max(0,b.x-r.x)+'px', height:b.h+'px' });
  Object.assign($('.crop-shade-right').style, { left:(b.x+b.w)+'px', top:b.y+'px', width:Math.max(0,r.x+r.w-b.x-b.w)+'px', height:b.h+'px' });
}

function setupCropper() {
  const stage = $('#cropStage');
  const boxEl = $('#cropBox');
  boxEl.addEventListener('pointerdown', e => {
    if (!cropState) return;
    e.preventDefault();
    boxEl.setPointerCapture?.(e.pointerId);
    cropState.drag = {
      startX: e.clientX, startY: e.clientY,
      start: { ...cropState.box },
      handle: e.target.dataset.handle || 'move'
    };
  });
  boxEl.addEventListener('pointermove', e => {
    const d = cropState?.drag;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    const r = cropState.imageRect, min = 48;
    let { x, y, w, h } = d.start;
    if (d.handle === 'move') {
      x = Math.max(r.x, Math.min(r.x + r.w - w, x + dx));
      y = Math.max(r.y, Math.min(r.y + r.h - h, y + dy));
    } else {
      if (d.handle.includes('e')) w = Math.max(min, Math.min(r.x + r.w - x, w + dx));
      if (d.handle.includes('s')) h = Math.max(min, Math.min(r.y + r.h - y, h + dy));
      if (d.handle.includes('w')) {
        const nx = Math.max(r.x, Math.min(x + w - min, x + dx));
        w += x - nx; x = nx;
      }
      if (d.handle.includes('n')) {
        const ny = Math.max(r.y, Math.min(y + h - min, y + dy));
        h += y - ny; y = ny;
      }
    }
    cropState.box = { x, y, w, h };
    renderCropBox();
  });
  const endDrag = () => { if (cropState) cropState.drag = null; };
  boxEl.addEventListener('pointerup', endDrag);
  boxEl.addEventListener('pointercancel', endDrag);

  $('#cropReset').onclick = resetCropSelection;
  $('#cropRotate').onclick = rotateCropImage;
  $('#cropConfirm').onclick = () => finishCrop(false);
  $('#cropUseFull').onclick = () => finishCrop(true);
  $('#cropCancel').onclick = cancelCrop;
  $('#cropCancelTop').onclick = cancelCrop;
  window.addEventListener('resize', () => {
    if (!$('#cropModal').hidden && cropState) { layoutCropImage(); resetCropSelection(); }
  });
}

function rotateCropImage() {
  if (!cropState) return;
  const img = $('#cropImage');
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalHeight; canvas.height = img.naturalWidth;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0);
  cropState.dataUrl = canvas.toDataURL('image/jpeg', .94);
  img.src = cropState.dataUrl;
}

function finishCrop(useFull) {
  if (!cropState) return;
  const cs = cropState, img = $('#cropImage'), r = cs.imageRect;
  const source = useFull ? { x:0, y:0, w:img.naturalWidth, h:img.naturalHeight } : {
    x: Math.max(0, Math.round((cs.box.x-r.x) / r.scale)),
    y: Math.max(0, Math.round((cs.box.y-r.y) / r.scale)),
    w: Math.min(img.naturalWidth, Math.round(cs.box.w / r.scale)),
    h: Math.min(img.naturalHeight, Math.round(cs.box.h / r.scale))
  };
  const maxSide = 2200;
  const scale = Math.min(maxSide/source.w, maxSide/source.h, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.w*scale));
  canvas.height = Math.max(1, Math.round(source.h*scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, source.x, source.y, source.w, source.h, 0, 0, canvas.width, canvas.height);
  if ($('#cropEnhance').checked) enhanceCanvas(ctx, canvas.width, canvas.height);
  const item = { dataUrl: canvas.toDataURL('image/jpeg', .92), name: cs.name, cropped: !useFull };
  cropState = null; closeModal('cropModal'); cs.resolve(item);
}

function enhanceCanvas(ctx, w, h) {
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i=0; i<d.length; i+=4) {
    const gray = .299*d[i] + .587*d[i+1] + .114*d[i+2];
    const v = Math.max(0, Math.min(255, (gray - 128) * 1.28 + 142));
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(image, 0, 0);
}

function cancelCrop() {
  if (!cropState) return;
  const cs = cropState; cropState = null; closeModal('cropModal'); cs.resolve(null);
}

// ============== 解题模块 ==============
function setupSolve() {
  // 上传
  $('#solveCamera').addEventListener('change', e => handleSolveFiles(e.target.files, true));
  $('#solveFile').addEventListener('change', e => handleSolveFiles(e.target.files, false));
  bindDropZone($('#solveUpload'), files => handleSolveFiles(files, false));

  // 解答
  $('#solveBtn').addEventListener('click', async () => {
    const text = $('#solveText').value.trim();
    const subject = $('#solveSubject').value;
    if (!text) { toast('请先输入或识别题目文本'); return; }
    if (!state.currentSolveImages.length && !text) { toast('需要题目文本'); return; }
    setLoading('#solveBtn', true);
    try {
      const sys = '你是MBA备考专家，请用 JSON 输出：{ approach: 思路, final: 最优解 }。思路要列出关键步骤和易错点。';
      const prompt = `科目：${subject}\n题目：\n${text}\n\n请给出：1）思路拆解；2）最优解与最终答案。`;
      const r = await callGPT(prompt, { system: sys, kind: 'solve' });
      const parsed = safeParse(r.raw);
      $('#solveApproach').innerHTML = `<h4>🧠 思路</h4>${escapeHtml(parsed.approach || r.raw)}`;
      $('#solveFinal').innerHTML    = `<h4>✅ 最优解</h4>${escapeHtml(parsed.final || '')}`;
      $('#solveModelBadge').textContent = '模型：' + state.settings.gptModel;
      $('#solveResult').hidden = false;
      $('#solveAddMistakeBtn').disabled = false;
      $('#solveAddMistakeBtn').onclick = () => addSolveAsMistake(subject, text, parsed);
      $('#solveCopyBtn').onclick = () => {
        const text = `【思路】\n${parsed.approach || ''}\n\n【最优解】\n${parsed.final || ''}`;
        copy(text); toast('已复制');
      };
      $('#solveAgainBtn').onclick = () => $('#solveBtn').click();
    } catch (err) {
      console.error(err);
      toast('解答失败：' + err.message);
    } finally {
      setLoading('#solveBtn', false);
    }
  });
}

async function handleSolveFiles(files, isCamera) {
  const arr = Array.from(files || []);
  if (!arr.length) return;
  let added = false;
  for (const f of arr) {
    const dataUrl = await readImageAsync(f);
    const item = await openCropper(dataUrl, f.name);
    if (!item) continue;
    state.currentSolveImages.push(item);
    added = true;
    renderSolvePreviews();
  }
  if (added) openOCRSolveConfirm();
}

function renderSolvePreviews() {
  renderPreviews('#solvePreviews', state.currentSolveImages,
    () => { state.currentSolveImages = []; $('#solveText').value = ''; renderSolvePreviews(); },
    idx => { state.currentSolveImages.splice(idx, 1); renderSolvePreviews(); }
  );
}

function openOCRSolveConfirm() {
  const imagesEl = $('#ocrSolveImages');
  imagesEl.innerHTML = state.currentSolveImages.map(i => `<img src="${i.dataUrl}" />`).join('');
  $('#ocrSolveText').value = '正在识别...';
  $('#ocrSolveHint').textContent = '正在本地识别；首次使用需要加载免费中文模型，之后会自动缓存。';
  openModal('ocrSolveModal');
  callOCR(state.currentSolveImages).then(r => {
    $('#ocrSolveText').value = r.text || '';
    const uncertain = r.uncertain?.length ? `；请重点核对：${r.uncertain.join('、')}` : '';
    $('#ocrSolveHint').textContent = r.message || (r.mock ? '（演示模式：返回模拟识别结果）' : `${r.provider || 'OCR'} 识别完成，置信度 ${(r.confidence||0).toFixed(2)}${uncertain}`);
  });
  $('#ocrSolveConfirm').onclick = () => {
    const txt = $('#ocrSolveText').value.trim();
    if (!txt) { toast('题目文本不能为空'); return; }
    $('#solveText').value = txt;
    state.currentSolveText = txt;
    closeModal('ocrSolveModal');
    toast('题目已确认');
  };
}

function addSolveAsMistake(subject, question, parsed) {
  const m = {
    id: uid(),
    subject,
    reason: '方法不对',
    question,
    wrongAnswer: '',
    answer: extractAnswerFromText(parsed.final || ''),
    approach: parsed.approach || '',
    createdAt: Date.now(),
    reviewedAt: null,
    reviewCount: 0,
  };
  state.mistakes.unshift(m);
  saveMistakes();
  toast('已加入错题集');
  switchTab('mistakes');
}

// ============== 出题模块 ==============
function setupPractice() {
  $('#pGenerateBtn').addEventListener('click', async () => {
    const subject = $('#pSubject').value;
    const difficulty = $('#pDifficulty').value;
    const source = $('#pSource').value;
    setLoading('#pGenerateBtn', true);
    try {
      let q;
      if (source === 'bank') {
        const allSubs = ['综合-数学', '综合-逻辑', '综合-写作', '综合-语文', '英语二'];
        const subj = subject === '随机' ? allSubs[Math.floor(Math.random() * allSubs.length)] : subject;
        q = mockQuestion(subj, difficulty);
      } else if (source === 'mistakes') {
        q = pickMistakeAsQuestion(subject);
        if (!q) { toast('错题集为空，先录入几道错题吧'); return; }
      } else {
        q = mixQuestion(subject, difficulty);
      }
      state.currentPracticeQ = q;
      renderPracticeQ(q, false);
      $('#pRevealBtn').disabled = false;
      $('#pAddMistakeBtn').disabled = false;
      state.practice.count += 1;
      state.practice.log.push({ ts: Date.now(), subject: q.subject, source: q.source });
      savePractice();
    } finally {
      setLoading('#pGenerateBtn', false);
    }
  });

  $('#pRevealBtn').addEventListener('click', () => {
    const q = state.currentPracticeQ;
    if (!q) return;
    renderPracticeQ(q, true);
  });
  $('#pAddMistakeBtn').addEventListener('click', () => {
    const q = state.currentPracticeQ;
    if (!q) return;
    const m = {
      id: uid(),
      subject: q.subject,
      reason: '其他',
      question: q.stem,
      wrongAnswer: '',
      answer: typeof q.answer === 'string' ? q.answer : JSON.stringify(q.answer),
      approach: q.explain || '',
      createdAt: Date.now(),
      reviewedAt: null,
      reviewCount: 0,
    };
    state.mistakes.unshift(m);
    saveMistakes();
    toast('已加入错题集');
  });
}

function renderPracticeQ(q, reveal) {
  $('#pQuestionCard').hidden = false;
  $('#pQSubject').textContent = '科目：' + q.subject;
  $('#pQSubject').className = 'badge primary';
  $('#pQDifficulty').textContent = '难度：' + ({easy:'基础', medium:'中等', hard:'拔高'}[q.difficulty] || q.difficulty);
  $('#pQSource').textContent = '来源：' + (q.source === 'mistake' ? '错题集' : '科目题库');
  $('#pQStem').textContent = q.stem;
  const optsEl = $('#pQOptions');
  optsEl.innerHTML = '';
  (q.options || []).forEach(opt => {
    const div = document.createElement('div');
    div.className = 'q-option';
    div.textContent = opt;
    div.addEventListener('click', () => {
      $$('.q-option', optsEl).forEach(o => o.classList.remove('selected'));
      div.classList.add('selected');
      if (reveal) {
        const ans = (q.answer || '').replace(/^[A-D]\.?\s*/, '').trim();
        const sel = opt.replace(/^[A-D]\.?\s*/, '').trim();
        div.classList.add(sel === ans || opt.startsWith(q.answer) ? 'correct' : 'wrong');
      }
    });
    optsEl.appendChild(div);
  });
  const ansEl = $('#pQAnswer');
  const expEl = $('#pQExplain');
  if (reveal) {
    ansEl.innerHTML = `<strong>答案：</strong>${escapeHtml(q.answer || '')}`;
    expEl.innerHTML = `<strong>解析：</strong>${escapeHtml(q.explain || '')}`;
    ansEl.hidden = false; expEl.hidden = false;
  } else {
    ansEl.hidden = true; expEl.hidden = true;
  }
}

// ============== 错题集模块 ==============
function setupMistakes() {
  $('#mCamera').addEventListener('change', e => handleMistakeFiles(e.target.files, true));
  $('#mFile').addEventListener('change', e => handleMistakeFiles(e.target.files, false));
  bindDropZone($('#mUpload'), files => handleMistakeFiles(files, false));

  $('#mFilterSubject').addEventListener('change', renderMistakes);
  $('#mFilterReason').addEventListener('change', renderMistakes);
  $('#mSearch').addEventListener('input', renderMistakes);

  $('#mExportBtn').addEventListener('click', exportMistakes);
  $('#mClearBtn').addEventListener('click', () => {
    if (confirm('确定清空所有错题？此操作不可恢复。')) {
      state.mistakes = [];
      saveMistakes();
      renderMistakes();
      toast('已清空');
    }
  });

  $('#ocrMAutoApproach').addEventListener('click', async () => {
    const q = $('#ocrMQuestion').value.trim();
    const a = $('#ocrMAnswer').value.trim();
    if (!q) { toast('请先填写题目'); return; }
    setLoading('#ocrMAutoApproach', true);
    try {
      const r = await callGPT(
        `请根据题目与答案，给出解题思路（步骤+易错点）。\n题目：${q}\n答案：${a}`,
        { system: '你是MBA备考专家，输出 JSON { approach: string }', kind: 'approach' }
      );
      const parsed = safeParse(r.raw);
      $('#ocrMApproach').value = parsed.approach || r.raw;
    } finally {
      setLoading('#ocrMAutoApproach', false);
    }
  });

  $('#ocrMConfirm').addEventListener('click', () => {
    const m = {
      id: uid(),
      subject: $('#ocrMSubject').value,
      reason: $('#ocrMReason').value,
      question: $('#ocrMQuestion').value.trim(),
      wrongAnswer: $('#ocrMWrong').value.trim(),
      answer: $('#ocrMAnswer').value.trim(),
      approach: $('#ocrMApproach').value.trim(),
      images: state.currentMistakeImages.map(i => i.dataUrl),
      createdAt: Date.now(),
      reviewedAt: null,
      reviewCount: 0,
    };
    if (!m.question) { toast('题目不能为空'); return; }
    if (!m.answer)   { toast('请填写正确答案'); return; }
    state.mistakes.unshift(m);
    saveMistakes();
    closeModal('ocrMistakeModal');
    state.currentMistakeImages = [];
    renderPreviews('#mPreviews', [], null, null);
    toast('已入册');
    renderMistakes();
  });

  // 错题详情操作
  $('#mdMarkReviewed').addEventListener('click', () => {
    const id = $('#mdMarkReviewed').dataset.id;
    const m = state.mistakes.find(x => x.id === id);
    if (!m) return;
    m.reviewedAt = Date.now();
    m.reviewCount = (m.reviewCount || 0) + 1;
    saveMistakes();
    toast('已标记复习');
    closeModal('mistakeDetailModal');
    renderMistakes();
  });
  $('#mdDelete').addEventListener('click', () => {
    const id = $('#mdDelete').dataset.id;
    if (!confirm('删除这道错题？')) return;
    state.mistakes = state.mistakes.filter(x => x.id !== id);
    saveMistakes();
    closeModal('mistakeDetailModal');
    renderMistakes();
    toast('已删除');
  });
}

async function handleMistakeFiles(files) {
  const arr = Array.from(files || []);
  if (!arr.length) return;
  let added = false;
  for (const f of arr) {
    const dataUrl = await readImageAsync(f);
    const item = await openCropper(dataUrl, f.name);
    if (!item) continue;
    state.currentMistakeImages.push(item);
    added = true;
    renderMistakePreviews();
  }
  if (added) openOCRMistakeConfirm();
}

function renderMistakePreviews() {
  renderPreviews('#mPreviews', state.currentMistakeImages,
    () => { state.currentMistakeImages = []; renderMistakePreviews(); },
    idx => { state.currentMistakeImages.splice(idx, 1); renderMistakePreviews(); }
  );
}

function openOCRMistakeConfirm() {
  $('#ocrMistakeImages').innerHTML = state.currentMistakeImages.map(i => `<img src="${i.dataUrl}" />`).join('');
  $('#ocrMQuestion').value = '正在识别...';
  $('#ocrMHint').textContent = '正在本地识别；首次使用需要加载免费中文模型，之后会自动缓存。';
  openModal('ocrMistakeModal');
  callOCR(state.currentMistakeImages).then(r => {
    $('#ocrMQuestion').value = r.text || '';
    const uncertain = r.uncertain?.length ? `；请重点核对：${r.uncertain.join('、')}` : '';
    $('#ocrMHint').textContent = r.message || (r.mock ? '（演示模式：返回模拟识别结果）' : `${r.provider || 'OCR'} 识别完成，置信度 ${(r.confidence||0).toFixed(2)}${uncertain}`);
  });
}

function renderMistakes() {
  const subj = $('#mFilterSubject').value;
  const reason = $('#mFilterReason').value;
  const kw = $('#mSearch').value.trim().toLowerCase();
  const list = state.mistakes.filter(m => {
    if (subj !== 'all' && m.subject !== subj) return false;
    if (reason !== 'all' && m.reason !== reason) return false;
    if (kw && !(m.question.toLowerCase().includes(kw) || (m.answer || '').toLowerCase().includes(kw))) return false;
    return true;
  });
  const wrap = $('#mList');
  if (!list.length) {
    wrap.innerHTML = '<div class="empty">还没有错题，拍照或手动添加吧 📷</div>';
    return;
  }
  wrap.innerHTML = '';
  list.forEach(m => {
    sm2Init(m);
    const isDue = (m.nextReview || 0) <= Date.now();
    const div = document.createElement('div');
    div.className = 'mistake-item';
    div.innerHTML = `
      <div class="mi-head">
        <span class="badge primary">${escapeHtml(m.subject)}</span>
        <span class="badge warn">${escapeHtml(m.reason || '其他')}</span>
        ${isDue ? '<span class="badge danger">⏰ 待复习</span>' : '<span class="badge ok">已复习 ' + (m.reviewCount||0) + ' 次</span>'}
      </div>
      <div class="mi-q">${escapeHtml(m.question)}</div>
      <div class="mi-meta">
        <span>📅 ${fmt(m.createdAt)}</span>
        ${m.answer ? '<span>✅ ' + escapeHtml(truncate(m.answer, 30)) + '</span>' : ''}
        <span>⏭ ${m.nextReview ? fmt(m.nextReview).slice(5,10) : '—'}</span>
      </div>
    `;
    div.addEventListener('click', () => openMistakeDetail(m.id));
    wrap.appendChild(div);
  });
}

function openMistakeDetail(id) {
  const m = state.mistakes.find(x => x.id === id);
  if (!m) return;
  sm2Init(m);
  $('#mdMarkReviewed').dataset.id = id;
  $('#mdDelete').dataset.id = id;
  const due = (m.nextReview || 0) <= Date.now();
  const next = m.nextReview ? fmt(m.nextReview) : '—';
  const body = $('#mdBody');
  body.innerHTML = `
    <div class="mi-head">
      <span class="badge primary">${escapeHtml(m.subject)}</span>
      <span class="badge warn">${escapeHtml(m.reason || '其他')}</span>
      ${due ? '<span class="badge danger">⏰ 待复习</span>' : '<span class="badge ok">已排期</span>'}
    </div>
    <div class="mi-meta" style="margin:8px 0 0">
      <span>📅 ${fmt(m.createdAt)}</span>
      <span>🔁 ${m.reviewCount || 0} 次</span>
      <span>📊 EF ${m.ef || 2.5}</span>
      <span>⏭ ${next}</span>
    </div>
    <div class="field" style="margin-top:12px">
      <label>题目</label>
      <div style="white-space:pre-wrap;line-height:1.7">${escapeHtml(m.question)}</div>
    </div>
    ${m.wrongAnswer ? `<div class="field"><label>你的错答</label><div style="white-space:pre-wrap">${escapeHtml(m.wrongAnswer)}</div></div>` : ''}
    <div class="field"><label>正确答案</label><div style="white-space:pre-wrap">${escapeHtml(m.answer || '（未填）')}</div></div>
    <div class="field"><label>解题思路</label><div style="white-space:pre-wrap;line-height:1.7">${escapeHtml(m.approach || '（未填）')}</div></div>
    ${m.images && m.images.length ? `<div class="field"><label>原图</label><div class="ocr-images">${m.images.map(src => `<img src="${src}" />`).join('')}</div></div>` : ''}
    <div class="field" style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
      <label>回忆质量打分（SM-2 自动排下次复习）</label>
      <div class="score-grid">
        <button class="score-btn s0" data-q="0"><span class="sn">0</span><span class="sl">完全不会</span></button>
        <button class="score-btn s1" data-q="1"><span class="sn">1</span><span class="sl">毫无印象</span></button>
        <button class="score-btn s2" data-q="2"><span class="sn">2</span><span class="sl">想不起来</span></button>
        <button class="score-btn s3" data-q="3"><span class="sn">3</span><span class="sl">勉强记起</span></button>
        <button class="score-btn s4" data-q="4"><span class="sn">4</span><span class="sl">略有迟疑</span></button>
        <button class="score-btn s5" data-q="5"><span class="sn">5</span><span class="sl">完美记住</span></button>
      </div>
    </div>
  `;
  body.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = parseInt(btn.dataset.q, 10);
      sm2Update(m, q);
      saveMistakes();
      toast(`已打 ${q} 分 · 下次复习 ${fmt(m.nextReview)}`, 2500);
      closeModal('mistakeDetailModal');
      renderMistakes();
      renderStats();
    });
  });
  openModal('mistakeDetailModal');
}

// ============== SM-2 间隔重复算法 ==============
const DAY = 86400000;
// 初始化 SM-2 字段（兼容旧数据）
function sm2Init(m) {
  if (m.ef == null) m.ef = 2.5;
  if (m.interval == null) m.interval = 0;
  if (m.reps == null) m.reps = 0;
  if (m.nextReview == null) m.nextReview = m.createdAt || Date.now();
  return m;
}
// SM-2 核心：根据回忆质量 q(0-5) 更新间隔
function sm2Update(m, q) {
  sm2Init(m);
  let { ef, interval, reps } = m;
  if (q < 3) {
    // 答错/没记住：重置
    reps = 0;
    interval = 1;
  } else {
    // 答对：按公式推进
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ef);
  }
  // 更新难度系数 EF
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;
  m.ef = Math.round(ef * 100) / 100;
  m.interval = interval;
  m.reps = reps;
  m.nextReview = Date.now() + interval * DAY;
  m.reviewedAt = Date.now();
  m.reviewCount = (m.reviewCount || 0) + 1;
  return m;
}
// 取所有到期需复习的错题
function getDueMistakes() {
  const now = Date.now();
  return state.mistakes
    .filter(m => (m.nextReview || 0) <= now)
    .sort((a, b) => (a.nextReview || 0) - (b.nextReview || 0));
}
// 复习模式
let reviewQueue = [];
let reviewIdx = 0;
function startReview() {
  reviewQueue = getDueMistakes();
  reviewIdx = 0;
  if (!reviewQueue.length) {
    toast('当前没有到期待复习的错题 🎉');
    return;
  }
  renderReviewItem();
  openModal('reviewModal');
}
function renderReviewItem() {
  const m = reviewQueue[reviewIdx];
  if (!m) { closeModal('reviewModal'); toast('复习完成！👍'); renderStats(); renderMistakes(); return; }
  const total = reviewQueue.length;
  $('#reviewProgress').textContent = `${reviewIdx + 1} / ${total}`;
  $('#reviewSubject').textContent = m.subject;
  $('#reviewReason').textContent = m.reason || '其他';
  const meta = [];
  meta.push(`已复习 ${m.reviewCount || 0} 次`);
  meta.push(`EF ${m.ef || 2.5}`);
  if (m.interval) meta.push(`上次间隔 ${m.interval} 天`);
  $('#reviewMeta').textContent = meta.join(' · ');
  $('#reviewQ').textContent = m.question;
  $('#reviewAnswer').textContent = m.answer || '（未填答案）';
  $('#reviewApproach').textContent = m.approach || '（未填思路）';
  $('#reviewAnswer').hidden = true;
  $('#reviewApproach').hidden = true;
  $('#reviewRevealBtn').textContent = '👁 先想答案，再点显示';
}
function scoreReview(quality) {
  const m = reviewQueue[reviewIdx];
  if (!m) return;
  sm2Update(m, quality);
  saveMistakes();
  reviewIdx += 1;
  renderReviewItem();
}

// ============== 统计 ==============
function renderStats() {
  const all = state.mistakes;
  $('#sTotal').textContent = all.length;
  const today = todayKey();
  $('#sToday').textContent = all.filter(m => fmt(m.createdAt).startsWith(today)).length;
  const subs = new Set(all.map(m => m.subject));
  $('#sSubj').textContent = subs.size;
  $('#sPractice').textContent = state.practice.count;

  // 分布
  const counts = {};
  all.forEach(m => { counts[m.subject] = (counts[m.subject] || 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const bars = $('#sBars');
  if (!Object.keys(counts).length) {
    bars.innerHTML = '<div class="empty">暂无数据</div>';
  } else {
    bars.innerHTML = '';
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'bar';
      row.innerHTML = `<div class="bar-label">${escapeHtml(k)}</div><div class="bar-track"><div class="bar-fill" style="width:${(v/max*100).toFixed(1)}%"></div></div><div class="bar-num">${v}</div>`;
      bars.appendChild(row);
    });
  }

  // 待复习（SM-2 到期）
  const due = getDueMistakes().slice(0, 10);
  const dueEl = $('#sDue');
  if (!due.length) {
    dueEl.innerHTML = '<div class="empty">没有到期待复习的错题 🎉<br><span style="font-size:13px">SM-2 会自动把难记的题排在前面</span></div>';
  } else {
    dueEl.innerHTML = '';
    due.forEach(m => {
      const d = document.createElement('div');
      d.className = 'due-item';
      const overdue = Math.ceil(((m.nextReview || 0) - Date.now()) / DAY);
      const ot = overdue < 0 ? `逾期 ${-overdue} 天` : (overdue === 0 ? '今天到期' : `还剩 ${overdue} 天`);
      d.innerHTML = `<div>[${escapeHtml(m.subject)}] ${escapeHtml(truncate(m.question, 50))}</div><div class="mi-meta"><span class="mi-due">${ot}</span><span>复习 ${m.reviewCount||0} 次</span><span>EF ${m.ef||2.5}</span></div>`;
      d.addEventListener('click', () => openMistakeDetail(m.id));
      dueEl.appendChild(d);
    });
  }
}

// ============== 设置 ==============
function setupSettings() {
  $('#settingsBtn').addEventListener('click', () => {
    const s = state.settings;
    $('#setMode').value = s.mode;
    $('#setOcr').value = s.ocrProvider;
    $('#setOcrKey').value = s.ocrKey || '';
    $('#setGptModel').value = s.gptModel;
    $('#setGptEndpoint').value = s.gptEndpoint || '';
    $('#setGptKey').value = s.gptKey || '';
    renderProfileList();
    openModal('settingsModal');
  });

  // 快切按钮（顶栏）
  $('#apiSwitchBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = $('#apiSwitchPanel');
    if (panel.hidden) {
      renderApiSwitchPanel();
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    const panel = $('#apiSwitchPanel');
    const btn = $('#apiSwitchBtn');
    if (panel && !panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) {
      panel.hidden = true;
    }
  });

  $('#setSave').addEventListener('click', () => {
    state.settings = {
      mode: $('#setMode').value,
      ocrProvider: $('#setOcr').value,
      ocrKey: $('#setOcrKey').value.trim(),
      gptModel: $('#setGptModel').value,
      gptEndpoint: $('#setGptEndpoint').value.trim(),
      gptKey: $('#setGptKey').value.trim(),
    };
    saveSettings();
    closeModal('settingsModal');
    toast('设置已保存');
    updateApiSwitchLabel();
  });

  // 保存当前设置为预设
  $('#setSaveProfile').addEventListener('click', () => {
    const name = prompt('给这套配置起个名字：', '自定义');
    if (!name) return;
    state.profiles.push({
      name: name,
      desc: $('#setGptModel').value + ' · ' + ($('#setMode').value === 'api' ? 'API模式' : '演示'),
      settings: {
        mode: $('#setMode').value,
        ocrProvider: $('#setOcr').value,
        ocrKey: $('#setOcrKey').value.trim(),
        gptModel: $('#setGptModel').value,
        gptEndpoint: $('#setGptEndpoint').value.trim(),
        gptKey: $('#setGptKey').value.trim(),
      },
    });
    saveProfiles();
    renderProfileList();
    toast('预设已保存');
  });

  $('#setImport').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (Array.isArray(data)) {
            state.mistakes = data.concat(state.mistakes);
            saveMistakes(); renderMistakes();
            toast(`已导入 ${data.length} 条`);
          } else toast('文件格式不正确');
        } catch { toast('解析失败'); }
      };
      r.readAsText(f);
    };
    inp.click();
  });
  $('#setExport').addEventListener('click', exportMistakes);
  $('#setWipe').addEventListener('click', () => {
    if (!confirm('清空所有错题与设置？此操作不可恢复。')) return;
    localStorage.removeItem(STORAGE_KEYS.mistakes);
    localStorage.removeItem(STORAGE_KEYS.practice);
    localStorage.removeItem(STORAGE_KEYS.settings);
    localStorage.removeItem(STORAGE_KEYS.profiles);
    state.mistakes = []; state.practice = { count: 0, log: [] }; state.settings = { ...defaultSettings };
    loadProfiles();
    renderMistakes(); renderStats();
    toast('已清空');
  });
}

// ============== API 快切面板 ==============
function updateApiSwitchLabel() {
  const btn = $('#apiSwitchBtn');
  if (!btn) return;
  const s = state.settings;
  if (s.mode === 'mock') {
    btn.textContent = '🎯 演示';
    btn.className = 'api-switch-btn demo';
  } else if (s.gptEndpoint.includes('deepseek')) {
    btn.textContent = '🇨🇳 DeepSeek';
    btn.className = 'api-switch-btn deepseek';
  } else if (s.gptEndpoint.includes('openai') || s.gptModel.includes('gpt')) {
    btn.textContent = '🌐 GPT';
    btn.className = 'api-switch-btn gpt';
  } else {
    btn.textContent = '🔧 API';
    btn.className = 'api-switch-btn custom';
  }
}

function renderApiSwitchPanel() {
  const panel = $('#apiSwitchPanel');
  if (!panel) return;
  const active = detectActiveProfile();
  panel.innerHTML = '<div class="switch-header">⚡ 一键切换 API</div>' +
    state.profiles.map((p, i) => {
      const isOn = i === active;
      const s = p.settings;
      const tag = s.mode === 'mock' ? '离线' : (s.gptEndpoint.includes('deepseek') ? '国内直连' : (s.gptEndpoint.includes('openai') ? '需翻墙' : '自定义'));
      return `<div class="switch-item${isOn ? ' active' : ''}" data-idx="${i}">
        <div class="switch-item-info">
          <div class="switch-item-name">${escapeHtml(p.name)}${isOn ? ' ✅' : ''}</div>
          <div class="switch-item-desc">${escapeHtml(p.desc || '')}</div>
          <div class="switch-item-tag">${tag}</div>
        </div>
      </div>`;
    }).join('');
  panel.querySelectorAll('.switch-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      applyProfile(idx);
      $('#apiSwitchPanel').hidden = true;
      updateApiSwitchLabel();
    });
  });
}

function renderProfileList() {
  const wrap = $('#profileList');
  if (!wrap) return;
  const active = detectActiveProfile();
  wrap.innerHTML = state.profiles.map((p, i) => {
    const isOn = i === active;
    return `<div class="profile-row${isOn ? ' active' : ''}">
      <div class="profile-info">
        <span class="profile-name">${escapeHtml(p.name)}${isOn ? ' <small>当前</small>' : ''}</span>
        <span class="profile-desc">${escapeHtml(p.desc || '')}</span>
      </div>
      <div class="profile-actions">
        <button class="btn sm primary" data-load="${i}">切换</button>
        ${state.profiles.length > 1 ? `<button class="btn sm ghost" data-del="${i}">删</button>` : ''}
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('[data-load]').forEach(b => {
    b.addEventListener('click', () => {
      applyProfile(parseInt(b.dataset.load));
      closeModal('settingsModal');
      updateApiSwitchLabel();
    });
  });
  wrap.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('删除这个预设？')) return;
      state.profiles.splice(parseInt(b.dataset.del), 1);
      saveProfiles();
      renderProfileList();
    });
  });
}

// ============== 通用辅助 ==============
function bindDropZone(zone, onFiles) {
  if (!zone) return;
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); zone.classList.remove('drag');
  }));
  zone.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files && files.length) onFiles(files);
  });
}
function readImage(file, cb) {
  const r = new FileReader();
  r.onload = e => {
    // 压缩图片：防止 localStorage 溢出（5-10MB 限制）
    const img = new Image();
    img.onload = () => {
      // OCR 输入优先保留小字和公式边界；真正入库前会在框选阶段再次压缩。
      const maxW = 2400, maxH = 3200;
      let w = img.width, h = img.height;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // JPEG 使用较高质量，避免根号、分数线和上下标被压糊。
      const isPng = file.type === 'image/png';
      const dataUrl = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);
      cb(dataUrl);
    };
    img.onerror = () => cb(e.target.result); // 压缩失败则用原图
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}
function readImageAsync(file) {
  return new Promise(resolve => readImage(file, resolve));
}
function renderPreviews(sel, arr, onClear, onRemove) {
  const wrap = $(sel);
  wrap.innerHTML = '';
  arr.forEach((it, idx) => {
    const div = document.createElement('div');
    div.className = 'preview';
    div.innerHTML = `<img src="${it.dataUrl}" /><button class="x" title="移除">✕</button>`;
    div.querySelector('.x').addEventListener('click', (e) => {
      e.stopPropagation();
      if (onRemove) onRemove(idx);
    });
    wrap.appendChild(div);
  });
  if (arr.length && onClear) {
    const clr = document.createElement('button');
    clr.className = 'btn ghost small';
    clr.textContent = '清空';
    clr.onclick = onClear;
    wrap.appendChild(clr);
  }
}
function setLoading(sel, on) {
  const btn = $(sel);
  if (!btn) return;
  if (on) { btn.dataset.t = btn.textContent; btn.textContent = '处理中...'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.t || btn.textContent; btn.disabled = false; }
}
function safeParse(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch {
    // 尝试从文本中抽 JSON
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return { approach: s, final: '' };
  }
}
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '...' : s;
}
function copy(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
}
function extractAnswerFromText(t) {
  const m = t.match(/(?:【答案】|答案[：:])\s*([^\n]+)/);
  return m ? m[1].trim() : '';
}
function exportMistakes() {
  const blob = new Blob([JSON.stringify(state.mistakes, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kaoshen_mistakes_${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出');
}

// ============== 初始化 ==============
function init() {
  loadState();
  autoConfigFromURL();
  // 注入示例错题（首次使用）
  if (!localStorage.getItem('kaoshen_seeded_v1') && state.mistakes.length === 0) {
    state.mistakes = [
      {
        id: uid(),
        subject: '综合-数学',
        reason: '计算失误',
        question: '若 a + b = 5, ab = 6, 求 a² + b²。',
        wrongAnswer: '选了 11（漏算 2ab）',
        answer: '13',
        approach: 'a² + b² = (a+b)² - 2ab = 25 - 12 = 13。',
        createdAt: Date.now() - 86400000,
        reviewedAt: null, reviewCount: 0,
        ef: 2.5, interval: 0, reps: 0,
        nextReview: Date.now() - 86400000,
      },
      {
        id: uid(),
        subject: '综合-逻辑',
        reason: '审题不清',
        question: '"只有不下雨，小李才去公园"为真，则以下哪项必然为真？',
        wrongAnswer: '选了 A（下雨时小李不去公园）',
        answer: 'B',
        approach: '"只有...才..."结构：去公园 → 不下雨。',
        createdAt: Date.now() - 2*86400000,
        reviewedAt: null, reviewCount: 0,
        ef: 2.5, interval: 0, reps: 0,
        nextReview: Date.now() - 86400000,
      },
    ];
    saveMistakes();
    localStorage.setItem('kaoshen_seeded_v1', '1');
  }

  // 兼容旧数据：给所有错题补齐 SM-2 字段
  state.mistakes.forEach(m => sm2Init(m));
  saveMistakes();

  setupSolve();
  setupCropper();
  setupPractice();
  setupMistakes();
  setupSettings();
  updateApiSwitchLabel();

  // 复习模式事件
  $('#reviewStartBtn')?.addEventListener('click', startReview);
  $('#reviewRevealBtn')?.addEventListener('click', () => {
    $('#reviewAnswer').hidden = false;
    $('#reviewApproach').hidden = false;
    $('#reviewRevealBtn').textContent = '👇 根据回忆质量打分';
  });
  $$('#reviewScores .score-btn').forEach(btn => {
    btn.addEventListener('click', () => scoreReview(parseInt(btn.dataset.q, 10)));
  });

  // Tab 切换
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) switchTab(b.dataset.tab);
  });

  // 模态框关闭
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (c) closeModal(c.dataset.close);
    if (e.target.classList?.contains('modal-mask')) {
      if (e.target.parentElement.id === 'cropModal') { cancelCrop(); return; }
      e.target.parentElement.hidden = true;
      document.body.style.overflow = '';
    }
  });

  renderMistakes();
  renderStats();
}

document.addEventListener('DOMContentLoaded', init);
})();
