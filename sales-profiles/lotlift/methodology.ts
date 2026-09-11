import type { MethodologyFramework, ProfileKnowledgeAttachment } from "../../src/lib/sales/knowledge";

export const LOTLIFT_KNOWLEDGE_SOURCES = Object.freeze({
  objectionStrategy: Object.freeze({ id: "objections-jeb-blount", title: "Objections", role: "objection strategy" }),
  coldCallExecution: Object.freeze({ id: "cold-calling-sucks", title: "Cold Calling Sucks", role: "cold-call execution" }),
});

export const LOTLIFT_KNOWLEDGE_ATTACHMENTS: readonly ProfileKnowledgeAttachment[] = Object.freeze([
  Object.freeze({ sourceId: LOTLIFT_KNOWLEDGE_SOURCES.objectionStrategy.id, enabled: true, order: 1, priority: 90, role: LOTLIFT_KNOWLEDGE_SOURCES.objectionStrategy.role, scope: Object.freeze(["objection", "discovery"]) }),
  Object.freeze({ sourceId: LOTLIFT_KNOWLEDGE_SOURCES.coldCallExecution.id, enabled: true, order: 2, priority: 80, role: LOTLIFT_KNOWLEDGE_SOURCES.coldCallExecution.role, scope: Object.freeze(["opening", "objection", "discovery"]) }),
]);

/** Concise paraphrases only. The imported PDFs and extracted corpora stay in local app data. */
export const LOTLIFT_METHODOLOGY_FRAMEWORKS: readonly MethodologyFramework[] = Object.freeze([
  Object.freeze({
    id: "ledge-disrupt-ask", sourceId: LOTLIFT_KNOWLEDGE_SOURCES.objectionStrategy.id,
    title: "Prospecting objection turnaround", summary: "Regain composure, interrupt the expected sales pattern, then request one small next step.",
    guidance: "Use a brief neutral acknowledgment, respond in an unexpected but respectful way, and ask one concise question. Never argue or ignore a refusal.",
    stages: Object.freeze(["opening", "discovery"]), candidateIds: Object.freeze(["first-refusal", "guided-objection-discovery"]), objectionClasses: Object.freeze(["not-interested", "busy", "send-information", "unknown"]), stateTags: Object.freeze([]), wording: Object.freeze(["not interested", "busy", "send information", "send me"],),
    provenance: Object.freeze({ pageStart: 106, pageEnd: 110, section: "Chapter 10: The Three-Step Prospecting Objection Turnaround Framework" }),
  }),
  Object.freeze({
    id: "reflex-or-real", sourceId: LOTLIFT_KNOWLEDGE_SOURCES.objectionStrategy.id,
    title: "Separate reflex resistance from a real constraint", summary: "A brush-off and a concrete business constraint require different next steps.",
    guidance: "Ask one diagnostic question. If the prospect gives a concrete constraint, learn the relevant timing, ownership, or workflow detail; if they refuse again, stop.",
    stages: Object.freeze(["opening", "discovery", "qualification"]), candidateIds: Object.freeze(["first-refusal", "guided-objection-discovery"]), objectionClasses: Object.freeze(["unknown", "not-interested", "price"]), stateTags: Object.freeze(["pending-answer"]), wording: Object.freeze(["not a fit", "doesn't work", "too expensive", "already handled"]),
    provenance: Object.freeze({ pageStart: 102, pageEnd: 106, section: "Chapter 10: Prospecting RBOs" }),
  }),
  Object.freeze({
    id: "disarm-and-diagnose", sourceId: LOTLIFT_KNOWLEDGE_SOURCES.coldCallExecution.id,
    title: "Disarm before diagnosing", summary: "Agreement lowers resistance and makes a short diagnostic question easier to answer.",
    guidance: "Acknowledge the specific concern without conceding unsupported facts. Ask a short, easy-to-answer diagnostic question, preferably with two or three plausible workflow choices.",
    stages: Object.freeze(["opening", "discovery"]), candidateIds: Object.freeze(["first-refusal", "guided-objection-discovery"]), objectionClasses: Object.freeze(["not-interested", "busy", "send-information", "unknown"]), stateTags: Object.freeze([]), wording: Object.freeze(["not interested", "send me", "call back", "who handles", "concern", "worry", "staff"]),
    provenance: Object.freeze({ pageStart: 87, pageEnd: 95, section: "Chapter 3: How to Handle Objections Like Mr. Miyagi" }),
  }),
  Object.freeze({
    id: "situational-price", sourceId: LOTLIFT_KNOWLEDGE_SOURCES.coldCallExecution.id,
    title: "Diagnose situational price resistance", summary: "Price language may signal timing, approval friction, or missing value context.",
    guidance: "Only after verified pain, distinguish budget timing from a value concern. Do not quote, discount, promise ROI, or debate price on the cold call.",
    stages: Object.freeze(["discovery", "qualification"]), candidateIds: Object.freeze(["guided-objection-discovery", "workflow-check"]), objectionClasses: Object.freeze(["price", "budget"]), stateTags: Object.freeze(["pain-verified"]), wording: Object.freeze(["price", "expensive", "budget", "cost"]),
    provenance: Object.freeze({ pageStart: 131, pageEnd: 136, section: "Chapter 4: Situational Objections, No Budget and Too Expensive" }),
  }),
  Object.freeze({
    id: "busy-as-bandwidth", sourceId: LOTLIFT_KNOWLEDGE_SOURCES.coldCallExecution.id,
    title: "Distinguish late-stage bandwidth from a brush-off", summary: "Busy language later in discovery may describe a real resource constraint.",
    guidance: "Acknowledge the workload and ask one neutral question about whether the constraint is timing, staffing, or the effort of changing the workflow.",
    stages: Object.freeze(["qualification"]), candidateIds: Object.freeze(["guided-objection-discovery"]), objectionClasses: Object.freeze(["busy"]), stateTags: Object.freeze(["pain-verified"]), wording: Object.freeze(["busy", "bandwidth", "resources", "staffing"]),
    provenance: Object.freeze({ pageStart: 136, pageEnd: 139, section: "Chapter 4: Situational Objection, No Resources/Bandwidth" }),
  }),
  Object.freeze({
    id: "existing-solution", sourceId: LOTLIFT_KNOWLEDGE_SOURCES.coldCallExecution.id,
    title: "Explore an existing solution without attacking it", summary: "Respect the current process, then inspect one likely workflow gap.",
    guidance: "Agree that keeping a working solution can make sense. Ask one neutral question about the verified problem area; never badmouth a vendor or invent customer proof.",
    stages: Object.freeze(["discovery", "qualification"]), candidateIds: Object.freeze(["guided-objection-discovery", "gap-after-hours"]), objectionClasses: Object.freeze(["existing-solution", "crm"]), stateTags: Object.freeze(["after-hours", "crm"]), wording: Object.freeze(["crm", "vinsolutions", "already have", "in house", "current process"]),
    provenance: Object.freeze({ pageStart: 140, pageEnd: 146, section: "Chapter 4: Existing Solution Objections Overview" }),
  }),
]);
