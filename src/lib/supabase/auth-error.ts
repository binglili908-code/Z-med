const AUTH_ERROR_MESSAGES: Array<[RegExp, string]> = [
  [/Invalid login credentials/i, "邮箱或密码错误，请重新输入。"],
  [/Email not confirmed/i, "邮箱尚未验证，请先完成邮件验证。"],
  [/User already registered/i, "该邮箱已注册，可直接登录。"],
  [/Password should be at least/i, "密码至少需要 6 位。"],
  [/Unable to validate email address/i, "邮箱格式不正确，请检查后重试。"],
  [/Signup is disabled/i, "当前环境未开启注册能力，请联系管理员。"],
  [/Auth session missing/i, "当前重置链接已失效，请重新发起找回密码。"],
  [/New password should be different/i, "新密码不能与旧密码相同。"],
  [/same as the old password/i, "新密码不能与旧密码相同。"],
];

export function formatSupabaseAuthError(message?: string | null) {
  if (!message) {
    return "操作失败，请稍后重试。";
  }

  const normalized = message.trim();

  for (const [pattern, text] of AUTH_ERROR_MESSAGES) {
    if (pattern.test(normalized)) {
      return text;
    }
  }

  return normalized;
}
