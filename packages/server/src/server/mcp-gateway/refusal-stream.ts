import { StringDecoder } from "node:string_decoder";

/** A JSON-RPC request id. */
export type JsonRpcId = string | number;

/** The id of one request as read from its body. */
export interface RequestIdRead {
  /** The id as JSON.parse reads it, or null for an id longer than `MAX_REQUEST_ID_CHARS`. */
  id: JsonRpcId | null;
  /** The id exactly as the body wrote it, to name it in an answer; `null` for an id not kept. */
  json: string;
}

/**
 * The longest request id the gateway keeps, in characters of its JSON text.
 * JSON-RPC sets no limit; this one only bounds memory, at the size of the
 * largest answer the gateway holds. A longer id is named `null` in the error,
 * the id JSON-RPC 2.0 gives an answer to a request whose id could not be read.
 */
export const MAX_REQUEST_ID_CHARS = 16 * 1024 * 1024;

/** The longest spelling of the member name `id`: both letters escaped, `\u0069\u0064`. */
const MAX_ID_NAME_SPELLING = 12;

type Container =
  | {
      kind: "object";
      expectKey: boolean;
      /** For a request object: the id read so far, if any. The last `id` member wins. */
      requestId?: RequestIdRead;
    }
  | { kind: "array" };

/**
 * Reads the JSON-RPC ids of a request body as it streams through, at any size
 * and in any member order, keeping only the ids: the top-level `id` of a
 * request, or the `id` of each request in a batch. Member names are compared
 * decoded, so `"\u0069d"` is `id`; a nested `id`, such as one inside
 * `params`, is never taken for the request's. Of duplicate `id` members the
 * last counts, as with JSON.parse, once the body is complete; while it still
 * arrives, the first one read stands for the request.
 */
export class JsonRpcIdScanner {
  private readonly decoder = new StringDecoder("utf8");
  private readonly stack: Container[] = [];
  private readonly found: RequestIdRead[] = [];
  private inString = false;
  private escaped = false;
  private stringRole: "key" | "id" | "other" = "other";
  private captured: string[] = [];
  private capturedLength = 0;
  private overflow = false;
  private lastKey: string | null = null;
  private idValuePending = false;
  private number: string | null = null;
  private provisional: RequestIdRead | undefined;
  private ended = false;

  /** The requests' ids read so far, each with its JSON text. */
  get requests(): readonly RequestIdRead[] {
    const root = this.stack[0];
    if (root?.kind === "object" && this.stack.length > 0 && this.provisional) {
      return [this.provisional];
    }
    return this.found;
  }

  /** The requests' ids read so far. */
  get ids(): ReadonlyArray<JsonRpcId | null> {
    return this.requests.map((read) => read.id);
  }

  /** No further id is needed: a request's id was read, or the body is complete. */
  get settled(): boolean {
    return this.ended || (this.stack[0]?.kind === "object" && this.provisional !== undefined);
  }

  push(chunk: Buffer): void {
    if (!this.ended) this.scan(this.decoder.write(chunk));
  }

  /** The body is complete. */
  end(): void {
    if (this.ended) return;
    this.scan(this.decoder.end());
    this.finishNumber();
    this.ended = true;
  }

  private top(): Container | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** Inside a request object: the body itself, or an element of a batch. */
  private atRequestLevel(): boolean {
    const [outer, inner] = this.stack;
    if (this.stack.length === 1) return outer?.kind === "object";
    return this.stack.length === 2 && outer?.kind === "array" && inner?.kind === "object";
  }

  private scan(text: string): void {
    for (const char of text) {
      if (this.ended) return;
      if (this.inString) {
        this.scanString(char);
        continue;
      }
      if (this.number !== null) {
        if (/[0-9eE.+-]/.test(char)) {
          if (this.number.length < MAX_REQUEST_ID_CHARS) this.number += char;
          else this.overflow = true;
          continue;
        }
        this.finishNumber();
      }
      this.scanStructure(char);
    }
  }

  private scanString(char: string): void {
    if (this.escaped) {
      this.escaped = false;
    } else if (char === "\\") {
      this.escaped = true;
    } else if (char === '"') {
      this.inString = false;
      this.finishString();
      return;
    }
    if (this.stringRole === "other") return;
    const limit = this.stringRole === "key" ? MAX_ID_NAME_SPELLING : MAX_REQUEST_ID_CHARS;
    if (this.capturedLength < limit) {
      this.captured.push(char);
      this.capturedLength += char.length;
    } else {
      this.overflow = true;
    }
  }

  private finishString(): void {
    if (this.stringRole === "key") {
      this.lastKey = this.overflow ? null : decodeJsonString(this.captured.join(""));
      return;
    }
    if (this.stringRole !== "id") return;
    if (this.overflow) {
      this.setRequestId({ id: null, json: "null" });
      return;
    }
    const raw = this.captured.join("");
    const id = decodeJsonString(raw);
    this.setRequestId(id === null ? undefined : { id, json: `"${raw}"` });
  }

  private finishNumber(): void {
    if (this.number === null) return;
    const raw = this.number;
    this.number = null;
    if (this.overflow) {
      this.setRequestId({ id: null, json: "null" });
      return;
    }
    let id: unknown;
    try {
      id = JSON.parse(raw);
    } catch {
      id = undefined;
    }
    this.setRequestId(typeof id === "number" ? { id, json: raw } : undefined);
  }

  /** The value of the request object's `id` member: the last one counts. */
  private setRequestId(read: RequestIdRead | undefined): void {
    const top = this.top();
    if (top?.kind !== "object") return;
    top.requestId = read;
    // While a body still arrives, its first id stands for the request.
    if (this.stack.length === 1 && this.provisional === undefined) this.provisional = read;
  }

  private startCapture(role: "key" | "id" | "other"): void {
    this.inString = true;
    this.stringRole = role;
    this.captured = [];
    this.capturedLength = 0;
    this.overflow = false;
  }

  private scanStructure(char: string): void {
    const top = this.top();
    switch (char) {
      case "{":
        this.valueIsNotAnId();
        this.stack.push({ kind: "object", expectKey: true });
        return;
      case "[":
        this.valueIsNotAnId();
        this.stack.push({ kind: "array" });
        return;
      case "}":
      case "]":
        this.close();
        return;
      case ":":
        if (top?.kind === "object") top.expectKey = false;
        this.idValuePending = this.atRequestLevel() && this.lastKey === "id";
        return;
      case ",":
        if (top?.kind === "object") top.expectKey = true;
        this.idValuePending = false;
        return;
      case '"':
        if (top?.kind === "object" && top.expectKey) this.startCapture("key");
        else this.startCapture(this.idValuePending ? "id" : "other");
        this.idValuePending = false;
        return;
      default:
        this.scanScalar(char);
    }
  }

  /** A character of a number or literal, or whitespace. */
  private scanScalar(char: string): void {
    if (/\s/.test(char)) return;
    if (this.idValuePending && /[-0-9]/.test(char)) {
      this.number = char;
      this.overflow = false;
    } else {
      this.valueIsNotAnId();
    }
    this.idValuePending = false;
  }

  /** An `id` member whose value is an object, an array or a literal: the request has no usable id. */
  private valueIsNotAnId(): void {
    if (this.idValuePending) this.setRequestId(undefined);
    this.idValuePending = false;
  }

  private close(): void {
    const closedRequest = this.atRequestLevel();
    const closed = this.stack.pop();
    if (closedRequest && closed?.kind === "object" && closed.requestId) {
      this.found.push(closed.requestId);
    }
    if (this.stack.length === 0) {
      this.provisional = undefined;
      this.ended = true;
    }
  }
}

/** The value of a JSON string's content, or null when it is not valid JSON. */
function decodeJsonString(raw: string): string | null {
  try {
    const value: unknown = JSON.parse(`"${raw}"`);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

const LF = 0x0a;
const CR = 0x0d;

/**
 * Passes an event stream on in whole events: the bytes up to the blank line
 * that ends an event go on at once, and an event whose blank line has not
 * arrived is held back. Cutting the stream off then never completes, or
 * breaks, an event the caller has only part of. Lines end with LF, CRLF or CR.
 *
 * An event is bounded by its full size, from its first byte to its last byte
 * before the line endings that end it, however the stream is chunked: an
 * event over `maxEventBytes` is never passed on, even when its last bytes
 * and blank line arrive in one chunk. The events before it are, and the
 * relay passes nothing further.
 */
export class EventStreamRelay {
  private held: Buffer[] = [];
  // Stream offsets: of the next byte to arrive, and of the current event's first byte.
  private consumed = 0;
  private eventStart = 0;
  private lineEmpty = true;
  private afterCR = false;
  private lastWasBoundary = false;
  private over = false;

  constructor(private readonly maxEventBytes: number) {}

  /** An event grew past `maxEventBytes`; it and everything after it are dropped. */
  get oversized(): boolean {
    return this.over;
  }

  /** What of the held bytes and `chunk` ends on an event boundary; the rest is held. */
  take(chunk: Buffer): Buffer {
    if (this.over) return Buffer.alloc(0);
    const base = this.consumed;
    this.consumed += chunk.length;
    for (let index = 0; index < chunk.length && !this.over; index += 1) {
      this.read(chunk[index], base + index);
    }
    if (this.eventStart <= base) {
      // No event ended in this chunk.
      if (this.over) this.drop();
      else this.held.push(chunk);
      return Buffer.alloc(0);
    }
    const ended = this.eventStart - base;
    const whole = Buffer.concat([...this.held, chunk.subarray(0, ended)]);
    this.held = !this.over && ended < chunk.length ? [chunk.subarray(ended)] : [];
    return whole;
  }

  private read(byte: number, at: number): void {
    if (this.afterCR) {
      this.afterCR = false;
      // The LF of a CRLF whose CR already ended the line.
      if (byte === LF) {
        if (this.lastWasBoundary) this.eventEnds(at);
        return;
      }
    }
    if (byte === LF || byte === CR) {
      this.lastWasBoundary = this.lineEmpty;
      if (this.lineEmpty) this.eventEnds(at);
      this.lineEmpty = true;
      this.afterCR = byte === CR;
      return;
    }
    this.lineEmpty = false;
    this.lastWasBoundary = false;
    // The event so far, up to this byte: line endings that end it never count.
    if (at + 1 - this.eventStart > this.maxEventBytes) this.over = true;
  }

  /** The blank line at `at` ends the event: the next one starts after it. */
  private eventEnds(at: number): void {
    this.eventStart = at + 1;
  }

  /** At the stream's end: whatever is held, passed on as it came. */
  rest(): Buffer {
    const rest = Buffer.concat(this.held);
    this.drop();
    return rest;
  }

  /** At a refusal, or an event over the bound: the unfinished event is dropped. */
  drop(): void {
    this.held = [];
  }
}
