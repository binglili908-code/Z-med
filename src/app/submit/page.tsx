import { Container } from "@/components/site/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SubmitPage() {
  return (
    <Container className="py-10">
      <Card>
        <CardHeader>
          <CardTitle>我要推荐</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          表单占位：这里将提供推荐会议/文献/项目/教程的提交入口（后续接入后端）。
        </CardContent>
      </Card>
    </Container>
  );
}
