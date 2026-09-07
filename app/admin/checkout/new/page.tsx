import SalesOrderEditor from "./SalesOrderEditor";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage({ searchParams }: { searchParams: Promise<{ appointment_id?: string; registration_id?: string }> }) {
  const params = await searchParams;
  return <SalesOrderEditor appointmentId={params.appointment_id} registrationId={params.registration_id} />;
}
