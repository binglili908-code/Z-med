export type KeywordSyncStat = {
  keyword: string;
  found: number;
  estimatedFound: number;
  new: number;
  passed: number;
  dropped: number;
  windows: number[];
};

export class KeywordSyncStats {
  private totalFound = 0;
  private estimatedTotalFound = 0;
  private totalNew = 0;
  private totalPassed = 0;
  private pmidKeywordMap = new Map<string, Set<string>>();
  private keywordWindowMap = new Map<string, Set<number>>();
  private keywordFoundMap = new Map<string, number>();
  private keywordEstimatedFoundMap = new Map<string, number>();
  private keywordNewMap = new Map<string, number>();
  private keywordPassedMap = new Map<string, number>();

  recordSearchWindow(input: {
    keyword: string;
    daysBack: number;
    ids: string[];
    totalCount: number;
  }) {
    const estimatedFound = Math.max(input.totalCount, input.ids.length);
    this.totalFound += input.ids.length;
    this.estimatedTotalFound += estimatedFound;
    this.keywordFoundMap.set(
      input.keyword,
      (this.keywordFoundMap.get(input.keyword) ?? 0) + input.ids.length,
    );
    this.keywordEstimatedFoundMap.set(
      input.keyword,
      (this.keywordEstimatedFoundMap.get(input.keyword) ?? 0) + estimatedFound,
    );

    if (!this.keywordWindowMap.has(input.keyword)) {
      this.keywordWindowMap.set(input.keyword, new Set<number>());
    }
    this.keywordWindowMap.get(input.keyword)!.add(input.daysBack);

    for (const pmid of input.ids) {
      if (!this.pmidKeywordMap.has(pmid)) {
        this.pmidKeywordMap.set(pmid, new Set<string>());
      }
      this.pmidKeywordMap.get(pmid)!.add(input.keyword);
    }
  }

  getDedupedPmids() {
    return Array.from(this.pmidKeywordMap.keys());
  }

  getKeywordsForPmid(pmid: string) {
    return Array.from(this.pmidKeywordMap.get(pmid) ?? []);
  }

  recordUpsert(input: { matchedKeywords: string[]; isAiMed: boolean }) {
    this.totalNew += 1;
    for (const keyword of input.matchedKeywords) {
      this.keywordNewMap.set(keyword, (this.keywordNewMap.get(keyword) ?? 0) + 1);
    }
    if (!input.isAiMed) return;

    this.totalPassed += 1;
    for (const keyword of input.matchedKeywords) {
      this.keywordPassedMap.set(keyword, (this.keywordPassedMap.get(keyword) ?? 0) + 1);
    }
  }

  buildSummary(keywordList: string[]) {
    const totalDropped = Math.max(0, this.totalNew - this.totalPassed);
    const keywordStats: KeywordSyncStat[] = keywordList.map((keyword) => {
      const found = this.keywordFoundMap.get(keyword) ?? 0;
      const estimatedFound = this.keywordEstimatedFoundMap.get(keyword) ?? 0;
      const nextNew = this.keywordNewMap.get(keyword) ?? 0;
      const passed = this.keywordPassedMap.get(keyword) ?? 0;
      const dropped = Math.max(0, nextNew - passed);
      return {
        keyword,
        found,
        estimatedFound,
        new: nextNew,
        passed,
        dropped,
        windows: Array.from(this.keywordWindowMap.get(keyword) ?? []),
      };
    });

    return {
      totalFound: this.totalFound,
      estimatedTotalFound: this.estimatedTotalFound,
      totalNew: this.totalNew,
      totalPassed: this.totalPassed,
      totalDropped,
      keywordStats,
    };
  }
}
