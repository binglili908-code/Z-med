export type UserSubscription = {
  subscription_enabled: boolean;
  custom_journals: string[];
  keywords: string[];
};

export type UserSubscriptionSaveResponse = UserSubscription & {
  ok: true;
};
