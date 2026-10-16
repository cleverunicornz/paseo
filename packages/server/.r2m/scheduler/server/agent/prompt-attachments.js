import { getForgeDefinitionOrNeutral } from "@getpaseo/protocol/forge-manifest";
const REVIEW_LINE_MARKERS = { add: "+", remove: "-", context: " " };
export function buildAgentPrompt(text, images, attachments) {
    const normalized = text.trim();
    const hasImages = (images?.length ?? 0) > 0;
    const hasAttachments = (attachments?.length ?? 0) > 0;
    if (!hasImages && !hasAttachments) {
        return normalized;
    }
    const chatHistoryAttachments = [];
    const otherAttachments = [];
    for (const attachment of attachments ?? []) {
        if (attachment.type === "text" && attachment.contextKind === "chat_history") {
            chatHistoryAttachments.push(attachment);
        }
        else {
            otherAttachments.push(attachment);
        }
    }
    const blocks = [...chatHistoryAttachments];
    if (normalized.length > 0) {
        blocks.push({ type: "text", text: normalized });
    }
    for (const image of images ?? []) {
        blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
    }
    blocks.push(...otherAttachments);
    return blocks;
}
export function renderPromptAttachmentAsText(attachment) {
    switch (attachment.type) {
        case "forge_change_request": {
            return renderChangeRequestAttachment({
                forge: attachment.forge,
                number: attachment.number,
                title: attachment.title,
                url: attachment.url,
                body: attachment.body,
                projectPath: attachment.projectPath,
                baseRefName: attachment.baseRefName,
                headRefName: attachment.headRefName,
            });
        }
        // COMPAT(githubAttachmentKinds): render legacy wire attachments until
        // 2027-01-17, when supported client and daemon floors are >= v0.2.0.
        case "github_pr": {
            return renderChangeRequestAttachment({
                forge: "github",
                number: attachment.number,
                title: attachment.title,
                url: attachment.url,
                body: attachment.body,
                baseRefName: attachment.baseRefName,
                headRefName: attachment.headRefName,
            });
        }
        case "forge_issue": {
            return renderIssueAttachment({
                forge: attachment.forge,
                number: attachment.number,
                title: attachment.title,
                url: attachment.url,
                body: attachment.body,
                projectPath: attachment.projectPath,
            });
        }
        // COMPAT(githubAttachmentKinds): render legacy wire attachments until
        // 2027-01-17, when supported client and daemon floors are >= v0.2.0.
        case "github_issue": {
            return renderIssueAttachment({
                forge: "github",
                number: attachment.number,
                title: attachment.title,
                url: attachment.url,
                body: attachment.body,
            });
        }
        case "text": {
            return attachment.text;
        }
        case "review": {
            const lines = [`Paseo review attachment (${attachment.mode})`, `CWD: ${attachment.cwd}`];
            if (attachment.baseRef) {
                lines.push(`Base: ${attachment.baseRef}`);
            }
            attachment.comments.forEach((comment, index) => {
                lines.push("", `Comment ${index + 1}: ${comment.filePath}:${comment.side}:${comment.lineNumber}`, comment.body, comment.context.hunkHeader);
                const target = comment.context.targetLine;
                for (const line of comment.context.lines) {
                    const isTarget = line.oldLineNumber === target.oldLineNumber &&
                        line.newLineNumber === target.newLineNumber &&
                        line.type === target.type &&
                        line.content === target.content;
                    const prefix = isTarget ? "> " : "  ";
                    const oldLn = padLineNumber(line.oldLineNumber);
                    const newLn = padLineNumber(line.newLineNumber);
                    lines.push(`${prefix}${oldLn} ${newLn} ${REVIEW_LINE_MARKERS[line.type]}${line.content}`);
                }
            });
            return lines.join("\n");
        }
        case "uploaded_file": {
            return [
                `Uploaded file: ${attachment.fileName}`,
                `Path: ${attachment.path}`,
                `MIME: ${attachment.mimeType}`,
                `Size: ${attachment.size} bytes`,
            ].join("\n");
        }
        default:
            throw new Error("unreachable");
    }
}
function renderChangeRequestAttachment(input) {
    const lines = [
        `${formatForgeLabel(input.forge)} ${formatChangeRequestAbbrev(input.forge)} ${formatChangeRequestNumber(input.forge, input.number)}: ${input.title}`,
        input.url,
    ];
    if (input.projectPath) {
        lines.push(`Project: ${input.projectPath}`);
    }
    if (input.baseRefName) {
        lines.push(`Base: ${input.baseRefName}`);
    }
    if (input.headRefName) {
        lines.push(`Head: ${input.headRefName}`);
    }
    if (input.body) {
        lines.push("", input.body);
    }
    return lines.join("\n");
}
function renderIssueAttachment(input) {
    const lines = [
        `${formatForgeLabel(input.forge)} Issue ${formatIssueNumber(input.forge, input.number)}: ${input.title}`,
        input.url,
    ];
    if (input.projectPath) {
        lines.push(`Project: ${input.projectPath}`);
    }
    if (input.body) {
        lines.push("", input.body);
    }
    return lines.join("\n");
}
function formatForgeLabel(forge) {
    return getForgeDefinitionOrNeutral(forge).displayName;
}
function formatChangeRequestAbbrev(forge) {
    return getForgeDefinitionOrNeutral(forge).changeRequestAbbrev;
}
function formatChangeRequestNumber(forge, number) {
    return `${getForgeDefinitionOrNeutral(forge).changeRequestNumberPrefix}${number}`;
}
function formatIssueNumber(forge, number) {
    return `${getForgeDefinitionOrNeutral(forge).issueNumberPrefix}${number}`;
}
function padLineNumber(lineNumber) {
    return (lineNumber?.toString() ?? "-").padStart(2);
}
export function buildAgentBranchNameSeed(firstAgentContext) {
    if (!firstAgentContext) {
        return undefined;
    }
    const parts = [];
    const prompt = firstAgentContext.prompt?.trim();
    if (prompt) {
        parts.push(["<user-prompt>", prompt, "</user-prompt>"].join("\n"));
    }
    const renderedAttachments = [];
    for (const attachment of firstAgentContext.attachments ?? []) {
        const rendered = renderPromptAttachmentAsText(attachment).trim();
        if (rendered) {
            renderedAttachments.push(rendered);
        }
    }
    if (renderedAttachments.length > 0) {
        parts.push(["<attachments>", renderedAttachments.join("\n\n"), "</attachments>"].join("\n"));
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined;
}
//# sourceMappingURL=prompt-attachments.js.map