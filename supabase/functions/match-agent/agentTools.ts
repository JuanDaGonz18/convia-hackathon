/**
 * The tools the agent may call, per phase (the allowlist is enforced by the loop, not the prompt).
 * Every tool takes a "plan" note: one sentence on what the model is doing and why, shown in the
 * trace ("How the agent decided"). The loop removes it before validating the other arguments.
 */
import type { ToolSpec } from '../_shared/llm.ts';
import { READ_TOOLS } from './tools.ts';

export type Phase = 'spec' | 'search';

const PLAN = { type: 'string', description: 'One short sentence: what you are doing now and why.' };

/** A read tool's schema with the required plan note added. */
function withPlan(spec: ToolSpec): ToolSpec {
  const parameters = spec.function.parameters as { properties: Record<string, unknown>; required?: string[] };
  return {
    type: 'function',
    function: {
      ...spec.function,
      parameters: { ...parameters, properties: { plan: PLAN, ...parameters.properties }, required: ['plan', ...(parameters.required ?? [])] },
    },
  };
}

const read = Object.fromEntries(READ_TOOLS.map((tool) => [tool.function.name, withPlan(tool)]));

// The agent names places by the references of the accepted spec, not by coordinates it would have to copy.
const searchParams = read.search_trips.function.parameters as { properties: Record<string, unknown> };
searchParams.properties.origin = { type: ['string', 'null'], description: 'The accepted origin reference (e.g. "place:1"), or null if the spec has none.' };
searchParams.properties.destination = { type: 'string', description: 'The accepted destination reference (e.g. "place:2").' };

const SUBMIT_REQUEST_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'submit_request_spec',
    description: 'Submit what you understood from the request, BEFORE searching. Places are references returned by resolve_place in this run (e.g. "place:2"). The app checks it and answers accepted, or with errors to fix.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan', 'destination', 'date', 'time'],
      properties: {
        plan: PLAN,
        origin: { type: ['string', 'null'], description: 'Reference like "place:1", or null if the user did not say where from.' },
        destination: { type: 'string', description: 'Reference like "place:2".' },
        date: { type: 'string', description: 'YYYY-MM-DD in Colombia.' },
        time: { type: 'string', description: 'HH:MM, 24 h, Colombia.' },
        flex_minutes: { type: 'integer', minimum: 15, maximum: 180, description: 'Default 60.' },
        seats: { type: 'integer', minimum: 1, maximum: 4, description: 'Default 1.' },
        max_price_cop: { type: ['integer', 'null'], description: 'Only if the user gave a budget.' },
        language: { type: 'string', enum: ['es', 'en'] },
      },
    },
  },
};

const ASK_CLARIFICATION: ToolSpec = {
  type: 'function',
  function: {
    name: 'ask_clarification',
    description: 'Ask the user one short question when a place is ambiguous or unknown, or the day or time is missing. Ends the run.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan', 'question'],
      properties: { plan: PLAN, question: { type: 'string', description: "The question, in the user's language." } },
    },
  },
};

const PROPOSE_REQUEST_SEAT: ToolSpec = {
  type: 'function',
  function: {
    name: 'propose_request_seat',
    description: 'Propose requesting a seat on a trip returned by search_trips in this run. The app verifies the trip and every claim in your explanation; nothing is booked: the user confirms in the app. Answers verified, or with failures to fix.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan', 'trip_id', 'explanation'],
      properties: {
        plan: PLAN,
        trip_id: { type: 'string' },
        explanation: { type: 'string', description: "One or two sentences in the user's language on why this trip fits. Every number must come from the tool results." },
      },
    },
  },
};

const ANSWER_NO_MATCH: ToolSpec = {
  type: 'function',
  function: {
    name: 'answer_no_match',
    description: 'Tell the user no trip fits the accepted request (after search_trips), mentioning the alternatives it returned, if any. Ends the run.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan', 'explanation'],
      properties: { plan: PLAN, explanation: { type: 'string', description: "In the user's language. Every number must come from the tool results." } },
    },
  },
};

const DECLINE: ToolSpec = {
  type: 'function',
  function: {
    name: 'decline',
    description: 'Answer a request you must not or cannot fulfil (private data such as phone numbers or full plates, anything that is not finding a ride), explaining briefly what you can do instead. Ends the run.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['plan', 'message'],
      properties: { plan: PLAN, message: { type: 'string', description: "In the user's language. No numbers." } },
    },
  },
};

export const AGENT_TOOLS: Record<string, ToolSpec> = {
  ...read,
  submit_request_spec: SUBMIT_REQUEST_SPEC,
  ask_clarification: ASK_CLARIFICATION,
  propose_request_seat: PROPOSE_REQUEST_SEAT,
  answer_no_match: ANSWER_NO_MATCH,
  decline: DECLINE,
};

/** Which tools each phase allows. Anything else is rejected without running. */
export const PHASE_TOOLS: Record<Phase, string[]> = {
  spec: ['resolve_place', 'submit_request_spec', 'ask_clarification', 'decline'],
  search: ['search_trips', 'trip_details', 'propose_request_seat', 'answer_no_match', 'ask_clarification', 'decline'],
};

export const toolsFor = (phase: Phase) => PHASE_TOOLS[phase].map((name) => AGENT_TOOLS[name]);
