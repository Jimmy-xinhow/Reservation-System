import { notFound } from "next/navigation";
import { IndustryShowcase } from "@/components/showcase/IndustryShowcase";
import { SHOWCASE_TEMPLATES, getShowcaseTemplate } from "@/lib/showcase-templates";

export function generateStaticParams() {
  return SHOWCASE_TEMPLATES.map(({ slug }) => ({ slug }));
}

export default async function IndustryShowcasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const template = getShowcaseTemplate(slug);
  if (!template) notFound();
  return <IndustryShowcase slug={template.slug} />;
}
