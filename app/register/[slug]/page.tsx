import { redirect } from "next/navigation";

export default async function BrandRegistrationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/register?clinic_slug=${encodeURIComponent(slug)}`);
}
