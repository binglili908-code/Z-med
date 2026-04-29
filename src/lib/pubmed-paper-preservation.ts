type ExistingPaperSnapshot = {
  abstract?: string | null;
  is_open_access?: boolean | null;
  oa_pdf_url?: string | null;
};

type OpenAccessResolution = {
  resolved: boolean;
  is_open_access: boolean;
  oa_pdf_url: string | null;
};

export function preserveFetchedPaperFields(args: {
  fetchedAbstract: string | null;
  openAccess: OpenAccessResolution;
  existing?: ExistingPaperSnapshot | null;
}) {
  return {
    abstract: args.fetchedAbstract ?? args.existing?.abstract ?? null,
    is_open_access: args.openAccess.resolved
      ? args.openAccess.is_open_access
      : Boolean(args.existing?.is_open_access ?? false),
    oa_pdf_url: args.openAccess.resolved
      ? args.openAccess.oa_pdf_url
      : args.existing?.oa_pdf_url ?? null,
  };
}
