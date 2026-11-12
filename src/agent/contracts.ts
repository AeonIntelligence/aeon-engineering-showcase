/**
 * Agent runtime contracts ("Wilson").
 *
 * PROPRIETARY: the agent loop, prompts, tool implementations, knowledge
 * catalog, and validators are withheld from this showcase. These types show
 * the shape of the boundary between the deterministic pipeline (shown in this
 * repository) and the agent; the runtime is walked through live on request.
 */

import type { EventEnvelope, SecurityVerdict } from "../ingestion/types.ts";

export type AgentIntakeKind = "reactive" | "proactive" | "operator_chat";

export type AutonomyLevel = 1 | 2 | 3;

export interface AgentInput {
  readonly intake: AgentIntakeKind;
  readonly clientId: string;
  readonly traceId: string;
  readonly agentProfile: string;
  readonly autonomy: AutonomyLevel;
  /** Present for reactive intake only; already through the security boundary. */
  readonly envelope?: EventEnvelope;
  readonly security?: SecurityVerdict;
}

export type AgentOutcome = "delivered" | "queued" | "escalated" | "dropped" | "error";

export interface AgentResult {
  readonly outcome: AgentOutcome;
  readonly traceId: string;
  readonly stepCount: number;
  readonly durationMs: number;
}

export interface AgentLoop {
  readonly execute: (input: AgentInput) => Promise<AgentResult>;
}
