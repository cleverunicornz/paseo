import { StringDecoder } from "node:string_decoder";

/** A JSON-RPC request id. */
export type JsonRpcId = string | number;

type Container = { kind: "object"; expectKey: boolean } | { kind: "array" };

/** Longer ids or keys are not ids the gateway answers for. */
const MAX_CAPTURE = 1024;

/**
 * Reads the JSON-RPC ids of a request body as it streams through, at any size
 * and in any member order, keeping only the ids: the top-level `id` of a
 * request, or the `id` of each request in a batch. A nested `id`, such as one
 * inside `params`, is never taken for the request's.
 */
export class JsonRpcIdScanner {
  private readonly decoder = new StringDecoder("utf8");
  private readonly stack: Container[] = [];
  private readonly found: JsonRpcId[] = [];
  private inString = false;
  private escaped = false;
  private stringRole: "key" | "id" | "other" = "other";
  private captured = "";
  private overflow = false;
  private lastKey: string | null = null;
  private idValuePending = false;
  private number: string | null = null;
  private ended = false;

  /** The ids read so far. */
  get ids(): readonly JsonRpcId[] {
    return this.found;
  }

  /** No further id can follow: a request's id was read, or the body is complete. */
  get settled(): boolean {
    return this.ended || (this.stack[0]?.kind === "object" && this.found.length > 0);
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
          if (this.number.length < MAX_CAPTURE) this.number += char;
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
    if (this.captured.length < MAX_CAPTURE) this.captured += char;
    else this.overflow = true;
  }

  private finishString(): void {
    if (this.stringRole === "key") {
      this.lastKey = this.overflow ? null : this.captured;
      return;
    }
    if (this.stringRole !== "id" || this.overflow) return;
    try {
      const id: unknown = JSON.parse(`"${this.captured}"`);
      if (typeof id === "string") this.found.push(id);
    } catch {
      // Not a JSON string: no id.
    }
  }

  private finishNumber(): void {
    if (this.number === null) return;
    const id = Number(this.number);
    if (this.number.length < MAX_CAPTURE && Number.isFinite(id)) this.found.push(id);
    this.number = null;
  }

  private scanStructure(char: string): void {
    const top = this.top();
    switch (char) {
      case "{":
        this.idValuePending = false;
        this.stack.push({ kind: "object", expectKey: true });
        return;
      case "[":
        this.idValuePending = false;
        this.stack.push({ kind: "array" });
        return;
      case "}":
      case "]":
        this.stack.pop();
        if (this.stack.length === 0) this.ended = true;
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
        this.inString = true;
        this.captured = "";
        this.overflow = false;
        if (top?.kind === "object" && top.expectKey) this.stringRole = "key";
        else this.stringRole = this.idValuePending ? "id" : "other";
        this.idValuePending = false;
        return;
      default:
        this.scanScalar(char);
    }
  }

  /** A character of a number or literal, or whitespace. */
  private scanScalar(char: string): void {
    if (this.idValuePending && /[-0-9]/.test(char)) this.number = char;
    if (!/\s/.test(char)) this.idValuePending = false;
  }
}

const LF = 0x0a;
const CR = 0x0d;

/**
 * Passes an event stream on in whole events: the bytes up to the blank line
 * that ends an event go on at once, and an event whose blank line has not
 * arrived is held back. Cutting the stream off then never completes, or
 * breaks, an event the caller has only part of. Lines end with LF, CRLF or CR.
 */
export class EventStreamRelay {
  private held: Buffer[] = [];
  private lineEmpty = true;
  private afterCR = false;
  private lastWasBoundary = false;

  /** What of the held bytes and `chunk` ends on an event boundary; the rest is held. */
  take(chunk: Buffer): Buffer {
    let boundary = -1;
    for (let index = 0; index < chunk.length; index += 1) {
      const byte = chunk[index];
      if (this.afterCR) {
        this.afterCR = false;
        // The LF of a CRLF whose CR already ended the line.
        if (byte === LF) {
          if (this.lastWasBoundary) boundary = index + 1;
          continue;
        }
      }
      if (byte === LF || byte === CR) {
        this.lastWasBoundary = this.lineEmpty;
        if (this.lineEmpty) boundary = index + 1;
        this.lineEmpty = true;
        this.afterCR = byte === CR;
      } else {
        this.lineEmpty = false;
        this.lastWasBoundary = false;
      }
    }
    if (boundary < 0) {
      this.held.push(chunk);
      return Buffer.alloc(0);
    }
    const whole = Buffer.concat([...this.held, chunk.subarray(0, boundary)]);
    this.held = boundary < chunk.length ? [chunk.subarray(boundary)] : [];
    return whole;
  }

  /** At the stream's end: whatever is held, passed on as it came. */
  rest(): Buffer {
    const rest = Buffer.concat(this.held);
    this.held = [];
    return rest;
  }

  /** At a refusal: the unfinished event is dropped. */
  drop(): void {
    this.held = [];
  }
}
