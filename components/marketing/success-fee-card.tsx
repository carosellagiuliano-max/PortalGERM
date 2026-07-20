import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SuccessFeeCard() {
  return (
    <Card className="h-full border-dashed bg-muted/20">
      <CardHeader>
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Rechtliches Gate</p>
        <CardTitle as="h3" className="text-xl">Erfolgsbasierte Vermittlung</CardTitle>
        <p className="mt-2 text-2xl font-semibold">Coming soon</p>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="text-sm leading-6 text-muted-foreground">
          Erfolgsbasierte Vermittlungsmodelle werden erst nach rechtlicher Prüfung aktiviert.
        </p>
        <Button type="button" disabled variant="outline" className="mt-5 w-full">
          Nicht verfügbar
        </Button>
      </CardContent>
    </Card>
  );
}
