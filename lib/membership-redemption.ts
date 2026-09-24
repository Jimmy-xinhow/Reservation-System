// Existing memberships without a snapshot retain their legacy plan projection.
// New snapshots are written by the database, never supplied by the customer.
export function applyMembershipRedemptionSnapshot<T extends { redemption_snapshot?: unknown; membership_plans: unknown }>(row: T): T {
  const value = row.redemption_snapshot;
  if (value == null) return row;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("套票使用限制資料不完整");
  const terms = value as Record<string, unknown>;
  if (!["appointment", "registration", "both"].includes(String(terms.usage_scope)) ||
      !Array.isArray(terms.redeem_channels) || !terms.redeem_channels.every(channel => typeof channel === "string") ||
      !(terms.service_id === null || typeof terms.service_id === "string")) {
    throw new Error("套票使用限制資料不完整");
  }
  const project = (plan: unknown) => plan && typeof plan === "object" && !Array.isArray(plan)
    ? { ...plan, usage_scope: terms.usage_scope, service_id: terms.service_id, redeem_channels: terms.redeem_channels }
    : plan;
  return { ...row, membership_plans: Array.isArray(row.membership_plans)
    ? row.membership_plans.map(project) : project(row.membership_plans) };
}
