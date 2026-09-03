import { redirect } from "next/navigation";

export default async function EventRegistrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const next = new URLSearchParams({ event: slug });
  for (const key of ["clinic_slug", "clinic_id", "access_token", "liff"]) {
    const value = query[key];
    if (typeof value === "string" && value) next.set(key, value);
  }
  redirect(`/register?${next.toString()}`);
}
