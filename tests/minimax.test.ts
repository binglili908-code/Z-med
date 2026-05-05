import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

import { callMiniMaxChat } from "../src/lib/minimax";

const server = setupServer();
const ENV_KEYS = [
  "MINIMAX_API_KEY",
  "MINIMAX_API_BASE_URL",
  "MINIMAX_MODEL",
  "MINIMAX_GROUP_ID",
  "MINIMAX_REASONING_SPLIT",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;

before(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }

  process.env.MINIMAX_API_KEY = "test-minimax-key";
  process.env.MINIMAX_API_BASE_URL = "https://api.minimaxi.com";
  process.env.MINIMAX_MODEL = "MiniMax-M2.7";
});

afterEach(() => {
  server.resetHandlers();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

after(() => {
  server.close();
});

test("calls MiniMax chat completions with the OpenAI-compatible request shape", async () => {
  server.use(
    http.post("https://api.minimaxi.com/v1/chat/completions", async ({ request }) => {
      assert.equal(request.headers.get("authorization"), "Bearer test-minimax-key");

      const body = (await request.json()) as {
        model?: string;
        messages?: Array<{ role: string; content: string }>;
        temperature?: number;
        max_completion_tokens?: number;
      };
      assert.equal(body.model, "MiniMax-M2.7");
      assert.deepEqual(body.messages, [
        { role: "system", content: "Return short answers." },
        { role: "user", content: "hello" },
      ]);
      assert.equal(body.temperature, 1);
      assert.equal(body.max_completion_tokens, 50);

      return HttpResponse.json({
        choices: [
          {
            message: {
              content: "hi",
            },
          },
        ],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 2,
        },
      });
    }),
  );

  const response = await callMiniMaxChat({
    systemPrompt: "Return short answers.",
    userPrompt: "hello",
    temperature: 9,
    maxTokens: 50,
  });

  assert.deepEqual(response, {
    content: "hi",
    inputTokens: 3,
    outputTokens: 2,
    model: "MiniMax-M2.7",
  });
});

test("retries highspeed model failures with the supported MiniMax fallback model", async () => {
  process.env.MINIMAX_MODEL = "MiniMax-M2.7-highspeed";
  let requestCount = 0;
  const originalConsoleError = console.error;
  console.error = () => undefined;

  server.use(
    http.post("https://api.minimaxi.com/v1/chat/completions", async ({ request }) => {
      requestCount += 1;
      const body = (await request.json()) as { model?: string };

      if (requestCount === 1) {
        assert.equal(body.model, "MiniMax-M2.7-highspeed");
        return HttpResponse.json(
          {
            base_resp: {
              status_msg: "not support model",
            },
          },
          { status: 400 },
        );
      }

      assert.equal(body.model, "MiniMax-M2.7");
      return HttpResponse.json({
        choices: [
          {
            message: {
              content: [{ text: "fallback ok" }],
            },
          },
        ],
        usage: {
          total_tokens: 7,
        },
      });
    }),
  );

  let response;
  try {
    response = await callMiniMaxChat({
      userPrompt: "normalize this",
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(requestCount, 2);
  assert.deepEqual(response, {
    content: "fallback ok",
    inputTokens: undefined,
    outputTokens: 7,
    model: "MiniMax-M2.7",
  });
});

test("strips reasoning blocks and reasoning content parts from MiniMax responses", async () => {
  let requestCount = 0;

  server.use(
    http.post("https://api.minimaxi.com/v1/chat/completions", () => {
      requestCount += 1;
      return HttpResponse.json({
        choices: [
          {
            message: {
              content: [
                { type: "reasoning_content", text: "internal chain of thought" },
                { type: "text", text: "<think>hidden</think>visible translation" },
              ],
            },
          },
        ],
      });
    }),
  );

  const response = await callMiniMaxChat({
    userPrompt: "translate this",
  });

  assert.equal(requestCount, 1);
  assert.equal(response.content, "visible translation");
});
