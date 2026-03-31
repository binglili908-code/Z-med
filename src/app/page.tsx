import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock,
  Github,
  Terminal,
} from "lucide-react";

import { DailyPaperModule } from "@/components/home/daily-paper-module";

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
          专为医疗 AI 研究者与临床医生打造的开源情报社区。获取最新顶会进展，掌握前沿模型复现，消除技术壁垒。
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <DailyPaperModule />
        </div>
        <div className="lg:col-span-4">
          <AiForDocsModule />
        </div>

        <div className="lg:col-span-4">
          <ConferenceRadarModule />
        </div>
        <div className="lg:col-span-8">
          <ReproductionGuideModule />
        </div>
      </div>
    </main>
  );
}

const AI_FOR_DOCS = [
  {
    id: 1,
    title: "大白话：什么是深度学习模型？",
    desc: "不用数学公式，用烤面包的逻辑懂AI。",
    readTime: "5 min",
    level: "Beginner",
  },
  {
    id: 2,
    title: "AI 阅片与人工阅片究竟有何区别？",
    desc: "AI 是如何看到我们忽略的微小结节的。",
    readTime: "8 min",
    level: "Beginner",
  },
  {
    id: 3,
    title: "一文读懂：大模型如何写病历",
    desc: "解放双手的自然语言处理技术 (NLP) 简介。",
    readTime: "6 min",
    level: "Beginner",
  },
];

const CONFERENCES = [
  {
    id: 1,
    name: "MICCAI 2026",
    desc: "Medical Image Computing",
    date: "2026-05-15",
    daysLeft: 67,
    status: "warning",
  },
  {
    id: 2,
    name: "TMI Journal",
    desc: "IEEE Trans. on Med Imaging",
    date: "Rolling",
    daysLeft: "N/A",
    status: "normal",
  },
  {
    id: 3,
    name: "Nature Medicine",
    desc: "AI in Healthcare Special",
    date: "2026-06-01",
    daysLeft: 84,
    status: "safe",
  },
];

const REPRODUCTION_GUIDE = {
  title: "Segment Anything in Medical Images (MedSAM)",
  paper: "Nature Communications (IF: 16.6)",
  description:
    "手把手教你复现首个医疗图像分割基础模型。包含数据预处理、权重加载与推理脚本。",
  env: ["Python 3.10", "PyTorch 2.0", "CUDA 11.8", "A100 x 1 (24GB VRAM)"],
  githubStars: "4.2k",
};

const AiForDocsModule = () => (
  <div className="bg-teal-50/50 rounded-3xl border border-teal-100 p-8 h-full flex flex-col">
    <div className="flex items-center gap-2 mb-6">
      <span className="bg-white text-teal-600 p-1.5 rounded-md shadow-sm border border-teal-100">
        <BookOpen className="w-5 h-5" />
      </span>
      <h2 className="text-lg font-bold text-slate-900 tracking-tight">
        AI 科普角
      </h2>
      <span className="ml-auto bg-teal-100 text-teal-800 text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide">
        For Doctors
      </span>
    </div>

    <p className="text-sm text-slate-600 mb-6 leading-relaxed">
      专为临床医生准备的零基础 AI 指南，每天 5 分钟，读懂医疗 AI 的底层逻辑。
    </p>

    <div className="flex flex-col gap-4 flex-grow">
      {AI_FOR_DOCS.map((article) => (
        <div
          key={article.id}
          className="group bg-white p-5 rounded-2xl border border-teal-100/50 shadow-sm hover:shadow-md hover:border-teal-300 transition-all cursor-pointer"
        >
          <div className="flex items-start justify-between mb-2">
            <span className="text-[10px] font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md uppercase tracking-wide">
              {article.level}
            </span>
            <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {article.readTime}
            </span>
          </div>
          <h4 className="text-sm font-bold text-slate-900 mb-1 group-hover:text-teal-700 transition-colors">
            {article.title}
          </h4>
          <p className="text-xs text-slate-500 line-clamp-2">{article.desc}</p>
        </div>
      ))}
    </div>

    <button className="mt-6 w-full py-3 rounded-xl border border-teal-200 text-teal-700 text-sm font-bold hover:bg-teal-50 transition-colors flex items-center justify-center gap-2">
      查看完整科普专栏 <ArrowUpRight className="w-4 h-4" />
    </button>
  </div>
);

const ConferenceRadarModule = () => (
  <div className="bg-white rounded-3xl border border-slate-200 p-8 h-full flex flex-col">
    <div className="flex items-center gap-2 mb-6">
      <span className="bg-slate-100 text-slate-600 p-1.5 rounded-md">
        <CalendarDays className="w-5 h-5" />
      </span>
      <h2 className="text-lg font-bold text-slate-900 tracking-tight">
        会议节点雷达
      </h2>
    </div>

    <div className="flex flex-col gap-5 flex-grow justify-center">
      {CONFERENCES.map((conf) => (
        <div key={conf.id} className="flex items-center justify-between group cursor-pointer">
          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center border ${
                conf.status === "warning"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-slate-50 border-slate-200"
              }`}
            >
              <span
                className={`text-[10px] font-bold uppercase ${
                  conf.status === "warning" ? "text-amber-600" : "text-slate-500"
                }`}
              >
                {conf.date === "Rolling"
                  ? "ANY"
                  : new Date(conf.date).toLocaleString("en-US", {
                      month: "short",
                    })}
              </span>
              <span
                className={`text-lg font-black leading-none ${
                  conf.status === "warning" ? "text-amber-700" : "text-slate-700"
                }`}
              >
                {conf.date === "Rolling" ? "---" : new Date(conf.date).getDate()}
              </span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 group-hover:text-teal-600 transition-colors">
                {conf.name}
              </h4>
              <p className="text-xs text-slate-500">{conf.desc}</p>
            </div>
          </div>
          <div className="text-right">
            {typeof conf.daysLeft === "number" ? (
              <div className="flex flex-col items-end">
                <span
                  className={`text-sm font-bold ${
                    conf.daysLeft < 70 ? "text-amber-600" : "text-slate-900"
                  }`}
                >
                  {conf.daysLeft} 天
                </span>
                <span className="text-[10px] text-slate-400 uppercase font-medium">
                  截止
                </span>
              </div>
            ) : (
              <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-1 rounded-md">
                Rolling
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ReproductionGuideModule = () => (
  <div className="bg-slate-900 rounded-3xl border border-slate-800 p-8 h-full flex flex-col relative overflow-hidden group">
    <div
      className="absolute inset-0 opacity-10"
      style={{
        backgroundImage:
          "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
        backgroundSize: "24px 24px",
      }}
    ></div>

    <div className="relative z-10">
      <div className="flex items-center gap-2 mb-6">
        <span className="bg-slate-800 text-teal-400 p-1.5 rounded-md border border-slate-700">
          <Terminal className="w-5 h-5" />
        </span>
        <h2 className="text-lg font-bold text-white tracking-tight">
          硬核实战：10分论文复现指南
        </h2>
        <span className="ml-auto flex items-center gap-1.5 bg-slate-800 border border-slate-700 text-slate-300 text-xs px-2.5 py-1 rounded-full">
          <Activity className="w-3.5 h-3.5 text-teal-400" /> Featured
        </span>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <div className="inline-block px-2.5 py-1 rounded bg-teal-900/50 border border-teal-800 text-teal-400 text-[10px] font-bold uppercase tracking-wider mb-3">
            {REPRODUCTION_GUIDE.paper}
          </div>
          <h3 className="text-2xl font-bold text-white mb-3 leading-tight">
            {REPRODUCTION_GUIDE.title}
          </h3>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            {REPRODUCTION_GUIDE.description}
          </p>

          <div className="flex items-center gap-4">
            <button className="bg-teal-500 hover:bg-teal-400 text-slate-900 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
              <Terminal className="w-4 h-4" /> 开始配置环境
            </button>
            <button className="bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-2">
              <Github className="w-4 h-4" /> {REPRODUCTION_GUIDE.githubStars}
            </button>
          </div>
        </div>

        <div className="md:w-64 bg-slate-950 rounded-2xl p-5 border border-slate-800 font-mono text-xs text-slate-300 shadow-inner flex flex-col justify-center">
          <div className="text-slate-500 mb-3 text-[10px] uppercase tracking-wider flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
              <div className="w-2 h-2 rounded-full bg-yellow-500/50"></div>
              <div className="w-2 h-2 rounded-full bg-green-500/50"></div>
            </div>
            Requirements.txt
          </div>
          <ul className="space-y-2.5">
            {REPRODUCTION_GUIDE.env.map((item, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <ChevronRight className="w-3 h-3 text-teal-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </div>
);
