import { DailyPaperModule } from "@/components/home/daily-paper-module";
import { HomeSearchBar } from "@/components/home/home-search-bar";

export default function Home() {
  return (
    <main className="max-w-7xl mx-auto px-6 pt-10 pb-20">
      <header className="mb-10">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
          连接医学与计算的<br className="md:hidden" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-600 to-blue-600">
            智能边界
          </span>
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl">
          聚焦 AI 医疗文献检索、评分与推送，帮助你高效获取高价值新论文。
        </p>
        <HomeSearchBar />
      </header>

      <DailyPaperModule />
    </main>
  );
}
