/**
 * Outside session mode an agent runs the model it was created with for its
 * whole life; a different model needs a new session. Session mode holds every
 * agent to the session's member instead (see session-member-gate.ts).
 */
export class ModelPinError extends Error {
  constructor(
    readonly pinned: string | null,
    readonly attempted: string | null,
  ) {
    super(
      `This agent's model is ${describeModel(pinned)}. This agent would run ${describeModel(attempted)}. A different model needs a new session.`,
    );
    this.name = "ModelPinError";
  }
}

function describeModel(model: string | null): string {
  return model ?? "its provider's default model";
}

/** ASCII-only lowercasing, as the session member gate compares. */
function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function normalizeModel(model: string | null | undefined): string | null {
  const trimmed = typeof model === "string" ? model.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The refusal for running `attempted` on an agent pinned to `pinned`, or null
 * when it is the same model. Models are compared ASCII-case-insensitively and
 * otherwise as given, so a suffixed variant such as `[1m]` is another model.
 * No model means the provider's default, which only matches no model.
 */
export function modelPinRefusal(
  pinned: string | null | undefined,
  attempted: string | null | undefined,
): ModelPinError | null {
  const pin = normalizeModel(pinned);
  const model = normalizeModel(attempted);
  if (pin === null && model === null) return null;
  if (pin !== null && model !== null && asciiLowercase(pin) === asciiLowercase(model)) return null;
  return new ModelPinError(pin, model);
}

/** Throws the refusal for running `attempted` when the session is pinned to another model. */
export function assertModelPin(
  pinned: string | undefined,
  attempted: string | null | undefined,
): void {
  if (pinned === undefined) return;
  const refusal = modelPinRefusal(pinned, attempted);
  if (refusal) throw refusal;
}
