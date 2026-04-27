function stripMarkdownFence(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
}

function extractBalancedObject(text: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseJsonObjectFromModelOutput<T>(
  text: string,
  label = "Model response",
) {
  const cleaned = stripMarkdownFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // MiniMax M2 models may include thinking or a short explanation around JSON.
  }

  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i] !== "{") continue;
    const candidate = extractBalancedObject(cleaned, i);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  throw new Error(`${label} was not valid JSON`);
}
