import AppointmentEditor from "../AppointmentEditor";

export const dynamic = "force-dynamic";

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; return_to?: string }>;
}) {
  const params = await searchParams;
  return <AppointmentEditor date={params.date} returnTo={params.return_to} />;
}
