import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import {
  createServiceAction,
  updateServiceAction,
  toggleServiceAction,
  deleteServiceAction,
} from "../actions";
import EntityManager from "../_components/EntityManager";

export const dynamic = "force-dynamic";

interface Service {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

export default async function ServicesPage() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("services")
    .select("id, name, description, active")
    .eq("clinic_id", CLINIC_ID)
    .order("created_at");
  const services = (data ?? []) as Service[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">看診服務</h1>
        <p className="text-sm text-slate-400">病患預約時可選的服務項目;約診會記錄所選服務,方便醫師掌握。</p>
      </div>
      <EntityManager
        title="服務項目"
        nameLabel="服務名稱"
        secondaryLabel="說明"
        secondaryField="description"
        items={services.map((s) => ({
          id: s.id,
          name: s.name,
          secondary: s.description,
          active: s.active,
        }))}
        createAction={createServiceAction}
        updateAction={updateServiceAction}
        toggleAction={toggleServiceAction}
        deleteAction={deleteServiceAction}
      />
    </div>
  );
}
