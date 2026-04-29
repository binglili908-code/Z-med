import assert from "node:assert/strict";
import test from "node:test";

import { formatSupabaseAuthError } from "../src/lib/supabase/auth-error";

test("maps Supabase email send rate limit errors to a user-facing message", () => {
  assert.equal(
    formatSupabaseAuthError("email rate limit exceeded"),
    "邮件发送过于频繁，请稍后再试。",
  );

  assert.equal(
    formatSupabaseAuthError("over_email_send_rate_limit"),
    "邮件发送过于频繁，请稍后再试。",
  );

  assert.equal(
    formatSupabaseAuthError("For security purposes, you can only request this after 56 seconds."),
    "邮件发送过于频繁，请稍后再试。",
  );
});

test("maps empty object-like auth errors to a generic retry message", () => {
  assert.equal(formatSupabaseAuthError("{}"), "操作失败，请稍后重试。");
  assert.equal(formatSupabaseAuthError("[]"), "操作失败，请稍后重试。");
});

test("maps auth email delivery failures to an actionable message", () => {
  assert.equal(
    formatSupabaseAuthError("Error sending confirmation email"),
    "邮件发送失败，请稍后再试或联系管理员。",
  );
});

test("maps captcha failures to a retry message", () => {
  assert.equal(formatSupabaseAuthError("captcha_failed"), "人机验证失败，请刷新后重试。");
});
