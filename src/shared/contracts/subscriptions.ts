export type UserSubscription = {
  subscription_enabled: boolean;
  exclude_reviews?: boolean;
  custom_journals: string[];
  keywords: string[];
  normalized_custom_journals?: string[];
  normalized_keywords?: string[];
  preference_normalized_at?: string | null;
  preference_normalization_error?: string | null;
};

export type UserSubscriptionSaveResponse = UserSubscription & {
  ok: true;
  ai_normalized?: boolean;
};
