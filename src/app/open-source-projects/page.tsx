import { Container } from "@/components/site/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OpenSourceProjectsPage() {
  return (
    <Container className="py-10">
      <Card>
        <CardHeader>
          <CardTitle>开源项目库</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          数据接入占位：这里将展示精选仓库、指标（Star/更新频率）与筛选能力。
        </CardContent>
      </Card>
    </Container>
  );
}
