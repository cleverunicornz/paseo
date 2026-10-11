import { describe, expect, test } from "vitest";
import { EventStreamRelay, JsonRpcIdScanner } from "./refusal-stream.js";

/** Scans `body` in chunks of `size` bytes, ending the body when `complete`. */
function scan(body: string, options: { size?: number; complete?: boolean } = {}) {
  const scanner = new JsonRpcIdScanner();
  const bytes = Buffer.from(body, "utf8");
  const size = options.size ?? bytes.length;
  for (let offset = 0; offset < bytes.length; offset += size) {
    scanner.push(bytes.subarray(offset, offset + size));
  }
  if (options.complete !== false) scanner.end();
  return { ids: [...scanner.ids], settled: scanner.settled };
}

describe("JsonRpcIdScanner", () => {
  test("reads the request's id wherever it sits and however large the body is", () => {
    const large = JSON.stringify({
      method: "tools/call",
      params: { name: "read", arguments: { text: "x".repeat(256 * 1024) } },
      jsonrpc: "2.0",
      id: 7,
    });
    expect(scan(large)).toEqual({ ids: [7], settled: true });
    expect(scan(large, { size: 1000 })).toEqual({ ids: [7], settled: true });
    expect(scan('{"jsonrpc":"2.0","id":"req-1","method":"tools/call"}')).toEqual({
      ids: ["req-1"],
      settled: true,
    });
    expect(scan('{ "jsonrpc" : "2.0" , "id" : 12 }')).toEqual({ ids: [12], settled: true });
  });

  test("reads the id of a body still arriving as soon as it has passed, and not before", () => {
    expect(scan('{"params":{},"id":12,"method":', { complete: false })).toEqual({
      ids: [12],
      settled: true,
    });
    expect(scan('{"jsonrpc":"2.0","id":7,"method":"tools/', { complete: false })).toEqual({
      ids: [7],
      settled: true,
    });
    // A number may go on; it is the id only once it has ended.
    expect(scan('{"id":12', { complete: false })).toEqual({ ids: [], settled: false });
    expect(scan('{"id":12', { size: 3, complete: false }).settled).toBe(false);
    expect(scan('{"params":{"id":99},"method":"x","id":', { complete: false })).toEqual({
      ids: [],
      settled: false,
    });
  });

  test("never takes a nested id, and reads escaped and multi-byte string ids", () => {
    expect(scan('{"params":{"id":99,"nested":[{"id":98}]},"method":"x","id":12}')).toEqual({
      ids: [12],
      settled: true,
    });
    expect(scan('{"method":"x","jsonrpc":"2.0","id":"escaped\\"id","params":{}}').ids).toEqual([
      'escaped"id',
    ]);
    expect(scan('{"id":"zwölf-✓","method":"x"}', { size: 1 }).ids).toEqual(["zwölf-✓"]);
  });

  test("compares member names decoded, so any escaped spelling of `id` is the id", () => {
    for (const name of [String.raw`\u0069d`, String.raw`i\u0064`, String.raw`\u0069\u0064`]) {
      expect(scan(`{"${name}":7,"method":"x"}`, { size: 3 })).toEqual({ ids: [7], settled: true });
    }
    // Other names that merely look alike are not the id.
    expect(scan(String.raw`{"\u0049d":8,"i\u0064 ":9,"method":"x"}`).ids).toEqual([]);
  });

  test("keeps a string or number id of any length in full", () => {
    for (const id of ["x".repeat(1025), "y".repeat(1024 * 1024)]) {
      expect(scan(JSON.stringify({ jsonrpc: "2.0", id, method: "x" }), { size: 4096 }).ids).toEqual(
        [id],
      );
    }
    expect(scan(`{"id":${"9".repeat(1100)},"method":"x"}`).ids).toEqual([Number("9".repeat(1100))]);
  });

  test("names an id longer than 16 MiB, which the gateway does not keep, as null", () => {
    const id = "z".repeat(16 * 1024 * 1024 + 1);
    expect(scan(`{"jsonrpc":"2.0","id":"${id}","method":"x"}`, { size: 1024 * 1024 }).ids).toEqual([
      null,
    ]);
  }, 60_000);

  test("of duplicate ids takes the last, as JSON.parse does, once the body is complete", () => {
    expect(scan('{"id":7,"method":"x","id":8}').ids).toEqual([8]);
    expect(scan('[{"id":1,"id":2},{"id":3}]').ids).toEqual([2, 3]);
    // While the body still arrives, the first id read stands for the request.
    expect(scan('{"id":7,"method":"x","id":', { complete: false })).toEqual({
      ids: [7],
      settled: true,
    });
  });

  test("reads every id of a batch once the batch is complete", () => {
    const batch =
      '[{"jsonrpc":"2.0","id":12,"method":"x"},{"jsonrpc":"2.0","method":"n"},{"id":13}]';
    expect(scan(batch, { size: 5 })).toEqual({ ids: [12, 13], settled: true });
    expect(scan(batch.slice(0, 45), { complete: false })).toEqual({ ids: [12], settled: false });
  });

  test("finds no id in a notification, an empty body or an id that is not a string or number", () => {
    expect(scan('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toEqual({
      ids: [],
      settled: true,
    });
    expect(scan("")).toEqual({ ids: [], settled: true });
    expect(scan('{"id":null,"method":"x"}').ids).toEqual([]);
    expect(scan('{"id":{"n":1},"method":"x"}').ids).toEqual([]);
  });
});

/** Feeds `chunks` to a relay and returns what it passed on after each, and what it held. */
function relay(chunks: string[]) {
  const events = new EventStreamRelay();
  const passed = chunks.map((chunk) => events.take(Buffer.from(chunk)).toString("utf8"));
  return { passed, held: events.rest().toString("utf8") };
}

describe("EventStreamRelay", () => {
  test("passes whole events on at once and holds an event until its blank line arrives", () => {
    expect(
      relay([
        ': ready\n\nevent: message\ndata: {"a":1}\n\n',
        'event: message\ndata: {"b":',
        "2}\n",
        "\n",
      ]),
    ).toEqual({
      passed: [
        ': ready\n\nevent: message\ndata: {"a":1}\n\n',
        "",
        "",
        'event: message\ndata: {"b":2}\n\n',
      ],
      held: "",
    });
  });

  test("holds a whole event whose terminating blank line has not arrived", () => {
    expect(relay(['event: message\ndata: {"result":{}}', "\n"])).toEqual({
      passed: ["", ""],
      held: 'event: message\ndata: {"result":{}}\n',
    });
  });

  test("ends events on CRLF and CR lines too, a CRLF split across chunks included", () => {
    expect(relay(["data: 1\r\n\r", "\ndata: 2\r\r", "data: 3\r\n"])).toEqual({
      passed: ["data: 1\r\n\r", "\ndata: 2\r\r", ""],
      held: "data: 3\r\n",
    });
  });

  test("drops the unfinished event at a refusal", () => {
    const events = new EventStreamRelay();
    expect(events.take(Buffer.from('data: {"a":1}\n\ndata: {"b"')).toString()).toBe(
      'data: {"a":1}\n\n',
    );
    events.drop();
    expect(events.rest().length).toBe(0);
  });
});
