"use client";

import { useEffect } from "react";
import { trackFunnelEvent, type FunnelEventName } from "@/lib/funnel-client";

export function FunnelTracker({ eventName, metadata }: { eventName: FunnelEventName; metadata?: Record<string, string | number | boolean> }) {
  useEffect(() => {
    trackFunnelEvent(eventName, metadata);
  }, [eventName, metadata]);
  return null;
}
