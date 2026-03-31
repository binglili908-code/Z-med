import Link from "next/link";

import { CalendarClock, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const items = [
  { name: "MICCAI 2026", date: "2026-03-20", type: "Conference", urgency: "Soon" },
  { name: "IEEE TMI", date: "Rolling", type: "Journal", urgency: "Ongoing" },
  { name: "CVPR (Medical)", date: "2026-11-01", type: "Conference", urgency: "Watch" },
] as const;

export function ConferenceRadarSidebar() {
  return (
    <Card className="sticky top-20">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-slate-700" />
          Conference Radar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          {items.map((it) => (
            <div
              key={it.name}
              className="rounded-xl border border-slate-200 bg-white p-3 hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {it.name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge>{it.type}</Badge>
                    <Badge tone="brand">{it.urgency}</Badge>
                  </div>
                </div>
                <div className="text-sm font-medium text-slate-700">{it.date}</div>
              </div>
            </div>
          ))}
        </div>

        <Link href="/conference-radar" className="block">
          <Button variant="secondary" className="w-full justify-between">
            View full radar
            <ChevronRight className="h-4 w-4 opacity-80" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
