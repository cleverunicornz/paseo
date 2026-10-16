export declare const GOTGENES_CHILD_SESSION_MARKER = "PASEO_GOTGENES_CHILD_SESSION";
/**
 * Runs inside Pi. The spawn result omits the child's session file, so the parent's public service
 * is the live source. Each child session loads its own copy of gotgenes, which republishes the
 * global service and deletes it on exit, so the parent's service is captured at session_start.
 */
export declare const gotgenesRuntimeBridge = "\n  let gotgenesParent;\n  pi.on(\"session_start\", (_event, ctx) => {\n    gotgenesParent = { ctx, service: globalThis[Symbol.for(\"@gotgenes/pi-subagents:service\")] };\n  });\n  pi.events.on(\"subagents:child:session-created\", (event) => {\n    const parent = gotgenesParent;\n    let attempts = 0;\n    // The record gets its session file after the child's extensions bind.\n    const report = () => {\n      const record = parent?.service?.listAgents().find((agent) =>\n        agent.outputFile?.includes(event.sessionId),\n      );\n      if (record) {\n        parent.ctx.ui.notify(\n          \"PASEO_GOTGENES_CHILD_SESSION \" +\n            JSON.stringify({ agentId: record.id, file: record.outputFile }),\n          \"info\",\n        );\n      } else if (++attempts < 240) {\n        setTimeout(report, 250);\n      }\n    };\n    setTimeout(report, 0);\n  });\n";
//# sourceMappingURL=runtime-bridge.d.ts.map