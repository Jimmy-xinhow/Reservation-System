import { redirect } from "next/navigation";

export default function LegacyBeautyOperationsPage() {
  redirect("/admin/operations/inventory");
}
