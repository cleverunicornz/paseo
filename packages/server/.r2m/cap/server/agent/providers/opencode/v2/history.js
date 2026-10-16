export async function messages(client, sessionID) {
    const result = [];
    let cursor;
    do {
        const page = await client.message.list({
            sessionID,
            ...(cursor ? { cursor } : { order: "asc" }),
            limit: 100,
        });
        result.push(...page.data);
        cursor = page.cursor.next ?? undefined;
    } while (cursor);
    return result;
}
//# sourceMappingURL=history.js.map