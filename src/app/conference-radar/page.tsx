import { Container } from "@/components/site/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ConferenceRadarPage() {
  return (
    <Container className="py-10">
      <Card>
        <CardHeader>
          <CardTitle>会议雷达</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          数据接入占位：这里将展示顶会/期刊的截稿日期、预警与时间轴视图。
        </CardContent>
      </Card>
    </Container>
  );
}
