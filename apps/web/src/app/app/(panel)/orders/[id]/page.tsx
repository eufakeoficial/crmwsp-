import { OrderDetailView } from "@/components/app/orders/OrderDetailView";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailView id={id} />;
}
