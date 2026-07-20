import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

export function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: Readonly<{
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  return (
    <section className="page-shell grid min-h-[calc(100vh-10rem)] place-items-center py-10 sm:py-16">
      <Card className="w-full max-w-xl shadow-sm">
        <CardHeader className="gap-2">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="font-heading text-2xl leading-snug font-semibold sm:text-3xl">
            {title}
          </h1>
          <CardDescription className="max-w-prose leading-6">
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        {footer === undefined ? null : (
          <CardFooter className="flex-wrap justify-center gap-x-2 gap-y-1 text-center text-sm text-muted-foreground">
            {footer}
          </CardFooter>
        )}
      </Card>
    </section>
  );
}

export function AuthTextLink({
  href,
  children,
}: Readonly<{ href: string; children: React.ReactNode }>) {
  return (
    <Link
      href={href}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}
