import { unstable_cache } from "next/cache";

import { getModelHubPageData } from "@/lib/github-model-hub";
import type { ModelHubResponse } from "@/shared/contracts/model-hub";

import { ModelHubClient } from "./model-hub-client";

export const revalidate = 300;

async function loadModelHubData(): Promise<ModelHubResponse> {
  try {
    return await getModelHubPageData({
      category: null,
      limit: 240,
    });
  } catch (error) {
    console.error("[model-hub-page-load-failed]", error);
    return {
      items: [],
      total: 0,
      category: null,
      lastSyncedAt: null,
      configured: false,
    };
  }
}

const getCachedModelHubData = unstable_cache(
  loadModelHubData,
  ["model-hub-page-data-v3"],
  {
    revalidate: 300,
  },
);

export default async function ModelHubPage() {
  const data = await getCachedModelHubData();
  return <ModelHubClient data={data} />;
}
