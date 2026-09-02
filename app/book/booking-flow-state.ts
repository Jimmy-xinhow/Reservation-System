export type BookingFlowStage =
  | "identifying_customer"
  | "choosing_customer"
  | "customer_details"
  | "service_details"
  | "choosing_time"
  | "ready"
  | "submitting";

export interface BookingFlowInput {
  customerLookupComplete: boolean;
  customerChoiceComplete: boolean;
  customerDetailsComplete: boolean;
  serviceComplete: boolean;
  bookingFieldsComplete: boolean;
  timeComplete: boolean;
  identityReady: boolean;
  submitting: boolean;
  joiningWaitlist: boolean;
  membershipCode: string;
}

export interface BookingFlowState {
  stage: BookingFlowStage;
  completed: {
    customer: boolean;
    service: boolean;
    bookingFields: boolean;
    time: boolean;
  };
  canChooseTime: boolean;
  canSubmit: boolean;
  submitBlock: "waitlist_membership_conflict" | null;
}

export function getBookingFlowState(input: BookingFlowInput): BookingFlowState {
  const submitBlock = input.joiningWaitlist && input.membershipCode.trim()
    ? "waitlist_membership_conflict"
    : null;
  const canChooseTime = input.customerDetailsComplete && input.serviceComplete;
  const canSubmit =
    input.identityReady &&
    input.customerDetailsComplete &&
    input.serviceComplete &&
    input.bookingFieldsComplete &&
    input.timeComplete &&
    !input.submitting &&
    submitBlock === null;

  let stage: BookingFlowStage;
  if (!input.customerLookupComplete) stage = "identifying_customer";
  else if (!input.customerChoiceComplete) stage = "choosing_customer";
  else if (!input.customerDetailsComplete) stage = "customer_details";
  else if (!input.serviceComplete || !input.bookingFieldsComplete) stage = "service_details";
  else if (!input.timeComplete) stage = "choosing_time";
  else if (input.submitting) stage = "submitting";
  else stage = "ready";

  return {
    stage,
    completed: {
      customer: input.customerDetailsComplete,
      service: input.serviceComplete,
      bookingFields: input.bookingFieldsComplete,
      time: input.timeComplete,
    },
    canChooseTime,
    canSubmit,
    submitBlock,
  };
}
