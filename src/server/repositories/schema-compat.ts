export function isMissingColumnError(error: unknown) {
  const value = error as { code?: string; message?: string; details?: string } | null;
  const text = `${value?.message ?? ""}\n${value?.details ?? ""}`;
  return (
    value?.code === "PGRST204" ||
    value?.code === "42703" ||
    /column .* does not exist/i.test(text) ||
    /could not find .* column/i.test(text) ||
    /schema cache/i.test(text)
  );
}

export function isMissingRelationError(error: unknown) {
  const value = error as { code?: string; message?: string; details?: string } | null;
  const text = `${value?.message ?? ""}\n${value?.details ?? ""}`;
  return (
    value?.code === "42P01" ||
    /relation .* does not exist/i.test(text) ||
    /could not find .* table/i.test(text) ||
    /schema cache/i.test(text)
  );
}
