import { Container } from "@/components/site/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LiteratureTrendsPage() {
  return (
    <Container className="py-10">
      <Card>
        <CardHeader>
          <CardTitle>文献风向标</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          数据接入占位：这里将展示最新高引、热点方向与标签聚合视图。
        </CardContent>
      </Card>
    </Container>
  );
}
