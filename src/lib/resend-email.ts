import { Resend } from "resend";

type SendResendEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
};

type ResendConfig = {
  apiKey: string;
  fromEmail: string;
};

export type ResendConfigStatus = {
  configured: boolean;
  hasApiKey: boolean;
  hasFromEmail: boolean;
  fromEmail: string | null;
  usesTestingDomain: boolean;
};

const RESEND_TESTING_DOMAIN_PATTERN = /@resend\.dev\b/i;

function getEnvValue(name: string) {
  return process.env[name]?.trim() ?? "";
}

function validateFromEmail(fromEmail: string) {
  if (RESEND_TESTING_DOMAIN_PATTERN.test(fromEmail)) {
    throw new Error(
      'RESEND_FROM_EMAIL must use your verified sending domain, for example "Z-Lab <noreply@zlab-med.com>". onboarding@resend.dev only works for Resend test emails.',
    );
  }
}

function getRequiredResendConfig(): ResendConfig {
  const apiKey = getEnvValue("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("Missing required env: RESEND_API_KEY");
  }

  const fromEmail = getEnvValue("RESEND_FROM_EMAIL");
  if (!fromEmail) {
    throw new Error("Missing required env: RESEND_FROM_EMAIL");
  }

  validateFromEmail(fromEmail);

  return { apiKey, fromEmail };
}

export function getResendConfigStatus(): ResendConfigStatus {
  const hasApiKey = Boolean(getEnvValue("RESEND_API_KEY"));
  const fromEmail = getEnvValue("RESEND_FROM_EMAIL");
  const hasFromEmail = Boolean(fromEmail);
  const usesTestingDomain = RESEND_TESTING_DOMAIN_PATTERN.test(fromEmail);

  return {
    configured: hasApiKey && hasFromEmail && !usesTestingDomain,
    hasApiKey,
    hasFromEmail,
    fromEmail: hasFromEmail ? fromEmail : null,
    usesTestingDomain,
  };
}

export function createResendEmailSender() {
  const { apiKey, fromEmail } = getRequiredResendConfig();
  const resend = new Resend(apiKey);

  return async function sendEmail(params: SendResendEmailParams) {
    const from = params.from?.trim() || fromEmail;
    validateFromEmail(from);

    const response = await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (response.error) {
      throw new Error(`Email sending failed: ${response.error.message}`);
    }

    return response.data ?? null;
  };
}

export async function sendResendEmail(params: SendResendEmailParams) {
  const sendEmail = createResendEmailSender();
  return sendEmail(params);
}
