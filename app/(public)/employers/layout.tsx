import { EmployerMarketingNav } from "@/components/marketing/employer-marketing-nav";

export default function EmployerMarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <EmployerMarketingNav />
      {children}
    </>
  );
}
