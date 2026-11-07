// Row types mirror supabase/migrations/0001_init.sql exactly.

export const PIPELINE_STAGES = [
  "discovered",
  "qualified",
  "researched",
  "outreach_drafted",
  "pending_approval",
  "approved",
  "manually_contacted",
  "connected",
  "replied",
  "interested",
  "appointment_booked",
  "attended",
  "proposal_sent",
  "won",
  "lost",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  discovered: "Discovered",
  qualified: "Qualified",
  researched: "Researched",
  outreach_drafted: "Outreach Drafted",
  pending_approval: "Pending Approval",
  approved: "Approved",
  manually_contacted: "Manually Contacted",
  connected: "Connected",
  replied: "Replied",
  interested: "Interested",
  appointment_booked: "Appointment Booked",
  attended: "Attended",
  proposal_sent: "Proposal Sent",
  won: "Won",
  lost: "Lost",
};

/** Reactivation categories from the spec (A–I) plus never_engaged for cold threads with no reply. */
export const LEAD_CATEGORIES = {
  A_interested_inactive: "Interested but inactive",
  B_replied_then_silent: "Replied, then stopped responding",
  C_asked_pricing: "Asked about pricing",
  D_requested_info: "Requested more information",
  E_received_proposal: "Received a proposal",
  F_interested_never_booked: "Interested but never booked",
  G_ghosted_after_sales: "Ghosted after a sales discussion",
  H_declined_may_revisit: "Declined — may have a new opportunity",
  I_not_worth_pursuing: "Not worth pursuing",
  never_engaged: "Never replied to outreach",
} as const;
export type LeadCategory = keyof typeof LEAD_CATEGORIES;

export type Market = "dubai" | "usa" | "uk" | "other" | "unknown";
export type ContactStatus = "ok" | "do_not_contact" | "opted_out";
export type InterestLevel = "high" | "medium" | "low" | "none" | "unknown";
export type OfferFit = "strong" | "possible" | "weak" | "unknown";

export interface ProspectResearch {
  posting_frequency?: "none" | "irregular" | "regular" | "high" | null;
  has_video?: boolean | null;
  recent_post_at?: string | null;
  ability_to_invest?: "high" | "medium" | "low" | null;
  headcount?: number | null;
  years_experience?: number | null;
  content_gap_notes?: string | null;
  notes?: string | null;
  sources?: string[];
}

export interface ScoreBreakdownItem {
  dimension: string;
  weight: number;
  value: number | null; // null = unknown
  points: number;
  reason: string;
}

export interface Prospect {
  id: string;
  identity_key: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  market: Market;
  linkedin_url: string | null;
  email: string | null;
  source: string;
  stage: PipelineStage;
  lead_category: LeadCategory | null;
  interest_level: InterestLevel | null;
  offer_fit: OfferFit | null;
  previous_objection: string | null;
  score: number | null;
  score_class: string | null;
  score_confidence: number | null;
  score_breakdown: ScoreBreakdownItem[] | null;
  research: ProspectResearch;
  conversation_summary: string | null;
  last_interaction_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  next_action: string | null;
  next_action_due: string | null;
  follow_up_priority: number | null;
  deal_value_estimate: number | null;
  contact_status: ContactStatus;
  contact_status_reason: string | null;
  snoozed_until: string | null;
  tags: string[];
  is_synthetic: boolean;
  analysed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  prospect_id: string;
  external_id: string;
  direction: "inbound" | "outbound";
  channel: string;
  sent_at: string;
  body: string;
  source: string;
  analysed: boolean;
  created_at: string;
}

export const DRAFT_KINDS = ["connection_note", "initial_message", "follow_up", "inmail", "reply", "reactivation"] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];
export type DraftStatus =
  | "pending_approval"
  | "blocked"
  | "approved"
  | "rejected"
  | "snoozed"
  | "sent_manually"
  | "superseded";

export interface GuardrailFlag {
  code: string;
  severity: "block" | "review";
  message: string;
}

export interface Draft {
  id: string;
  prospect_id: string;
  kind: DraftKind;
  subject: string | null;
  body: string;
  rationale: string | null;
  observation: string | null;
  positioning: string | null;
  cta: string | null;
  follow_up_in_days: number | null;
  status: DraftStatus;
  guardrail_flags: GuardrailFlag[];
  generated_by: string;
  idempotency_key: string;
  body_hash: string;
  snooze_until: string | null;
  decided_at: string | null;
  sent_confirmed_at: string | null;
  outcome: string | null;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  prospect_id: string;
  idempotency_key: string;
  google_event_id: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status: "confirmed" | "cancelled" | "rescheduled" | "attended" | "no_show";
  prospect_confirmation: string;
  qualified: boolean | null;
  notes: string | null;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  prospect_id: string;
  title: string;
  plan: string | null;
  status: "open" | "proposal" | "won" | "lost";
  contract_value: number;
  currency: string;
  probability: number | null;
  market: string | null;
  lead_source: string | null;
  signed_at: string | null;
  closed_at: string | null;
  lost_reason: string | null;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  deal_id: string;
  invoice_ref: string | null;
  amount: number;
  currency: string;
  status: "outstanding" | "paid" | "void";
  due_at: string | null;
  paid_at: string | null;
  verified: boolean;
  idempotency_key: string | null;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export type ContentStatus = "idea" | "draft" | "pending_approval" | "approved" | "published" | "rejected";
export interface ContentMetrics {
  impressions?: number | null;
  reactions?: number | null;
  comments?: number | null;
  reposts?: number | null;
  profile_views?: number | null;
  dms?: number | null;
  recorded_at?: string;
}
export interface ContentItem {
  id: string;
  status: ContentStatus;
  pillar: string | null;
  audience: string | null;
  topic: string;
  hook: string | null;
  body: string | null;
  cta: string | null;
  format: string | null;
  objective: string | null;
  reasoning: string | null;
  suggested_visual: string | null;
  assets: { kind: string; name: string; svg?: string; url?: string }[];
  scheduled_for: string | null;
  published_at: string | null;
  published_url: string | null;
  metrics: ContentMetrics | null;
  leads_attributed: number;
  generated_by: string | null;
  idempotency_key: string | null;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export interface Competitor {
  id: string;
  name: string;
  market: string | null;
  profile_url: string | null;
  category: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompetitorObservation {
  id: string;
  competitor_id: string;
  source_url: string;
  observed_at: string;
  observation: string;
  content_theme: string | null;
  format: string | null;
  evidence: string | null;
  strategic_opportunity: string | null;
  kind: "fact" | "estimate";
  idempotency_key: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  occurred_at: string;
  type: string;
  source: string;
  actor: "system" | "owner";
  prospect_id: string | null;
  summary: string;
  data: Record<string, unknown>;
  is_synthetic: boolean;
}

export interface WorkflowRun {
  id: string;
  workflow: string;
  slot: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  attempt: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  stats: Record<string, unknown>;
}

export interface Report {
  id: string;
  kind: "daily" | "weekly";
  period_start: string;
  period_end: string;
  metrics: Record<string, unknown>;
  body_md: string;
  created_at: string;
}

export interface Setting {
  key: string;
  value: unknown;
  updated_at: string;
}

export interface IntegrationStatus {
  name: string;
  status: "connected" | "not_configured" | "error" | "manual_only";
  detail: string | null;
  checked_at: string;
}

export interface Tables {
  prospects: Prospect;
  messages: Message;
  drafts: Draft;
  appointments: Appointment;
  deals: Deal;
  payments: Payment;
  content_items: ContentItem;
  competitors: Competitor;
  competitor_observations: CompetitorObservation;
  events: EventRow;
  workflow_runs: WorkflowRun;
  reports: Report;
  settings: Setting;
  integration_status: IntegrationStatus;
}
export type TableName = keyof Tables;

/** Primary key column per table (most are "id"). */
export const PRIMARY_KEYS: Record<TableName, string> = {
  prospects: "id",
  messages: "id",
  drafts: "id",
  appointments: "id",
  deals: "id",
  payments: "id",
  content_items: "id",
  competitors: "id",
  competitor_observations: "id",
  events: "id",
  workflow_runs: "id",
  reports: "id",
  settings: "key",
  integration_status: "name",
};

/** Unique columns per table, used for upsert conflict targets and in-memory uniqueness enforcement. */
export const UNIQUE_KEYS: { [K in TableName]: string[][] } = {
  prospects: [["identity_key"], ["linkedin_url"], ["email"]],
  messages: [["external_id"]],
  drafts: [["idempotency_key"]],
  appointments: [["idempotency_key"], ["google_event_id"]],
  deals: [],
  payments: [["idempotency_key"]],
  content_items: [["idempotency_key"]],
  competitors: [["name", "market"]],
  competitor_observations: [["idempotency_key"]],
  events: [],
  workflow_runs: [["workflow", "slot", "attempt"]],
  reports: [["kind", "period_start"]],
  settings: [["key"]],
  integration_status: [["name"]],
};
