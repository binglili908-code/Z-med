import { Container } from "@/components/site/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TutorialsPage() {
  return (
    <Container className="py-10">
      <Card>
        <CardHeader>
          <CardTitle>论文复现指南</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          数据接入占位：这里将展示 10 分医学 AI 论文复现教程、环境与数据集清单。
        </CardContent>
      </Card>
    </Container>
  );
}
