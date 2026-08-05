import "server-only";

const PAGE_SIZE = 1000;

type PageResponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/** Read every PostgREST page so reports do not silently stop at the API row limit. */
export async function fetchAllSupabasePages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}
