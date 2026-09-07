import AppointmentEditor from "../../AppointmentEditor";

export const dynamic = "force-dynamic";

export default async function RescheduleAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ return_to?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <AppointmentEditor appointmentId={id} returnTo={query.return_to} />;
}
