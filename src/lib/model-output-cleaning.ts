function isReasoningPart(part: Record<string, unknown>) {
  const marker = [part.type, part.role, part.name, part.purpose]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return ["reasoning", "thinking", "thought", "chain_of_thought", "chain-of-thought"].some(
    (token) => marker.includes(token),
  );
}

export function stripReasoningBlocks(text: string) {
  return text
    .replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/<think(?:ing)?\b[^>]*>[\s\S]*/gi, "")
    .replace(
      /\[(?:think|thinking|reasoning|analysis)\][\s\S]*?\[\/(?:think|thinking|reasoning|analysis)\]/gi,
      "",
    )
    .replace(/\[(?:think|thinking|reasoning|analysis)\][\s\S]*/gi, "")
    .replace(
      /^\s*(?:思考过程|推理过程|分析过程|内部思考|思路|Reasoning|Analysis|Thought process|Chain of thought)\s*[:：][\s\S]*?(?:翻译结果|译文|最终译文|最终答案|Translation|Final answer|Answer|Result)\s*[:：]\s*/i,
      "",
    )
    .trim();
}

export function extractVisibleModelText(value: unknown) {
  if (typeof value === "string") return stripReasoningBlocks(value);
  if (!Array.isArray(value)) return "";

  return stripReasoningBlocks(
    value
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";

        const record = part as Record<string, unknown>;
        if (isReasoningPart(record)) return "";
        if (typeof record.text === "string") return record.text;
        if (typeof record.content === "string") return record.content;
        return "";
      })
      .join(""),
  );
}
