export type AssistantExpressionName =
  | 'happy'
  | 'sad'
  | 'surprised'
  | 'angry'
  | 'shy'
  | 'sleepy'
  | 'excited'
  | 'confused';

export type AssistantExpressionInference = {
  name: AssistantExpressionName;
  score: number;
  confidence: number;
  matchedCues: string[];
};

type ExpressionRule = {
  name: AssistantExpressionName;
  cues: Array<{
    pattern: RegExp;
    weight: number;
    label: string;
  }>;
  punctuationBoost?: (text: string) => number;
};

const EXPRESSION_RULES: ExpressionRule[] = [
  {
    name: 'angry',
    cues: [
      { pattern: /生气|气死|气坏了/, weight: 3, label: 'explicit-angry' },
      { pattern: /哼|别闹|不许|不行|住口|闭嘴|讨厌|别惹我/, weight: 2.4, label: 'angry-phrase' },
      { pattern: /吓人|凶你|凶一点/, weight: 1.6, label: 'threat-tone' },
    ],
    punctuationBoost: (text) => (/[!！]{1,}/.test(text) ? 0.4 : 0),
  },
  {
    name: 'sad',
    cues: [
      { pattern: /难过|伤心|遗憾|失落|委屈|心疼|可惜/, weight: 2.6, label: 'sadness' },
      { pattern: /抱抱|没关系|别怕|没事的/, weight: 1.4, label: 'comforting' },
      { pattern: /呜呜|呜/, weight: 2, label: 'crying' },
    ],
  },
  {
    name: 'sleepy',
    cues: [
      { pattern: /困了|好困|睡觉|晚安|休息|眯一会|先睡/, weight: 2.8, label: 'sleepy' },
      { pattern: /好累|打哈欠|累坏了/, weight: 2, label: 'tired' },
    ],
  },
  {
    name: 'shy',
    cues: [
      { pattern: /害羞|不好意思|脸红|羞|羞羞/, weight: 2.8, label: 'shy' },
      { pattern: /嘿嘿|哎呀|偷偷|人家/, weight: 1.8, label: 'bashful-tone' },
    ],
    punctuationBoost: (text) => (/[~～]/.test(text) ? 0.3 : 0),
  },
  {
    name: 'surprised',
    cues: [
      { pattern: /哇|竟然|居然|原来|没想到|天哪|真的假的/, weight: 2.4, label: 'surprise' },
      { pattern: /欸|咦/, weight: 1.4, label: 'interjection' },
    ],
    punctuationBoost: (text) => (/[!?？！]{2,}/.test(text) ? 0.9 : 0),
  },
  {
    name: 'excited',
    cues: [
      { pattern: /太好了|好耶|真棒|太棒了|开心|高兴|太赞了|棒呆/, weight: 2.8, label: 'excited' },
      { pattern: /喜欢|超喜欢|太可爱了|汪汪/, weight: 1.8, label: 'enthusiasm' },
    ],
    punctuationBoost: (text) => (/[!！]{1,}/.test(text) ? 0.8 : 0),
  },
  {
    name: 'confused',
    cues: [
      { pattern: /什么情况|什么意思|怎么了|为什么|不明白|听不懂|奇怪/, weight: 2.8, label: 'confused' },
      { pattern: /你是说|是这样吗|欸等等/, weight: 1.8, label: 'clarifying' },
    ],
    punctuationBoost: (text) => (/[\?？]/.test(text) ? 0.9 : 0),
  },
  {
    name: 'happy',
    cues: [
      { pattern: /好的|当然|没问题|可以呀|真好|欢迎|谢谢|好呀|好哦|一起|陪你/, weight: 1.8, label: 'friendly' },
      { pattern: /嗯嗯|好呢|可以哦|收到啦/, weight: 1.4, label: 'warm-ack' },
    ],
    punctuationBoost: (text) => (/[~～]/.test(text) ? 0.4 : 0),
  },
];

const DEFAULT_INFERENCE: AssistantExpressionInference = {
  name: 'happy',
  score: 1,
  confidence: 0.35,
  matchedCues: ['default-friendly'],
};

export function inferAssistantExpression(text: string): AssistantExpressionName | null {
  return inferAssistantExpressionDetail(text)?.name ?? null;
}

export function inferAssistantExpressionDetail(text: string): AssistantExpressionInference | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  let bestInference: AssistantExpressionInference | null = null;
  let totalScore = 0;

  for (const rule of EXPRESSION_RULES) {
    let score = 0;
    const matchedCues: string[] = [];

    for (const cue of rule.cues) {
      if (cue.pattern.test(normalizedText)) {
        score += cue.weight;
        matchedCues.push(cue.label);
      }
    }

    score += rule.punctuationBoost?.(normalizedText) ?? 0;
    totalScore += Math.max(score, 0);

    if (!bestInference || score > bestInference.score) {
      bestInference = {
        name: rule.name,
        score,
        confidence: 0,
        matchedCues,
      };
    }
  }

  if (!bestInference || bestInference.score <= 0) {
    return inferFallbackExpression(normalizedText);
  }

  const confidence = totalScore > 0
    ? Math.max(0.35, Math.min(0.96, bestInference.score / totalScore))
    : 0.5;

  return {
    ...bestInference,
    confidence,
  };
}

function inferFallbackExpression(text: string): AssistantExpressionInference {
  if (/[!！]/.test(text)) {
    return {
      name: 'excited',
      score: 1.2,
      confidence: 0.42,
      matchedCues: ['fallback-exclamation'],
    };
  }

  if (/[\?？]/.test(text)) {
    return {
      name: 'confused',
      score: 1.2,
      confidence: 0.42,
      matchedCues: ['fallback-question'],
    };
  }

  return DEFAULT_INFERENCE;
}
