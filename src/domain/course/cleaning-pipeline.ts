//! M4 清洗管道：JSON 声明式的正则清洗规则，与 `course.normalizer` 对齐，Web/桌面共用同一套。
//!
//! 设计要点：
//! - 规则为纯数据（pattern + flags + replacement），可随应用分发、可被用户覆盖；
//! - 全角转半角由 `NFKC` 规范化完成（０-９、Ａ-Ｚ、（）等），管道内显式执行；
//! - 单条规则异常不影响整体清洗（跳过并继续），保证解析流程不因规则损坏而中断。

export interface CleaningRule {
  /** 规则标识 */
  name: string;
  /** 给人看的说明 */
  description?: string;
  /** 正则表达式字符串（JSON 可序列化） */
  pattern: string;
  /** 正则 flags；默认 g */
  flags?: string;
  /** 替换文本，支持 $1 等反向引用 */
  replacement: string;
}

export const defaultCleaningRules: CleaningRule[] = [
  {
    name: 'strip-annotation-parenthesis',
    description: '去除数字后的括号批注（90(重修)→90、90（重修）→90）',
    pattern: String.raw`(\d+(?:\.\d+)?)\s*[（(]\s*[^()（）]*\s*[）)]`,
    replacement: '$1'
  },
  {
    name: 'strip-unit-suffix',
    description: '去除末尾“分”单位（90.0分→90.0）',
    pattern: String.raw`(\d+(?:\.\d+)?)\s*分\s*$`,
    replacement: '$1'
  },
  {
    name: 'normalize-space',
    description: '合并空白并去除全角空格（NFKC 已转半角，此处兜底）',
    pattern: String.raw`[ \t\u00a0\u3000]+`,
    replacement: ' '
  }
];

/**
 * 对原始单元格值执行清洗管道：NFKC 规范化（全角转半角、兼容字符归一）→ 依次应用声明式规则 → 收尾去空白。
 * 返回空串表示无有效内容。
 */
export function cleanRawValue(
  value: unknown,
  rules: CleaningRule[] = defaultCleaningRules
): string {
  let text = String(value ?? '').normalize('NFKC');
  for (const rule of rules) {
    try {
      text = text.replace(new RegExp(rule.pattern, rule.flags ?? 'g'), rule.replacement);
    } catch {
      // 规则损坏时跳过该条，不影响其余清洗
    }
  }
  return text.trim();
}

/** 供 UI 展示规则说明时使用 */
export function describeCleaningRules(rules: CleaningRule[] = defaultCleaningRules): string[] {
  return rules
    .filter((rule) => rule.description)
    .map((rule) => `${rule.name}：${rule.description}`);
}
