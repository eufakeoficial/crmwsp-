import { SalesDashboard } from "@/components/app/dashboard/SalesDashboard";
import { GettingStartedCard } from "@/components/dashboard/GettingStartedCard";

export default function HomePage() {
  return (
    <>
      <GettingStartedCard />
      <SalesDashboard />
    </>
  );
}
