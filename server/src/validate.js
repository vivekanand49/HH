// Tiny helper: parse req.body/query with a zod schema, answer 400 on failure.
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const err = new Error(`${issue.path.join('.') || 'input'}: ${issue.message}`);
    err.status = 400;
    throw err;
  }
  return result.data;
}
