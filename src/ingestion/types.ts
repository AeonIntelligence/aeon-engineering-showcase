export type EventType =
  | "email_received"
  | "sms_received"
  | "call_ended"
  | "appointment_booked"
  | "appointment_cancelled"
  | "review_posted"
  | "lead_captured"
  | "form_submitted"
  | "calendar_event"
  | "user_command"
  | "churn_signal"
  | "no_response_timeout";

/**
 * Normalized inbound event. Channel-specific normalizers (email, SMS, forms,
 * voice) produce this shape before the ingestion boundary runs; per-event data
 * payloads are typed per event in the full system and left open here.
 */
export interface EventEnvelope<T extends EventType = EventType> {
  readonly eventType: T;
  readonly source: string;
  readonly clientId: string | null;
  readonly data: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
  readonly traceId: string;
}

export interface StructuralValidationResult {
  readonly passed: boolean;
  readonly modifications: readonly string[];
}

export interface SecurityVerdict {
  readonly passed: boolean;
  readonly threatLevel: "none" | "low" | "suspicious" | "blocked";
  readonly flags: readonly string[];
  readonly structuralValidation: StructuralValidationResult;
  readonly contentScan: {
    readonly ran: boolean;
    readonly model: string | null;
    readonly decision: "safe" | "suspicious" | "blocked" | null;
    readonly threats: readonly string[];
    readonly reasoning: string | null;
  };
  readonly sanitized: boolean;
  readonly sanitizedFields: readonly string[];
  readonly scannedAt: string;
}
