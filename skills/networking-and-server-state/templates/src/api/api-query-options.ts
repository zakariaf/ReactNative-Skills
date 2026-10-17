// src/api/api-query-options.ts
// The declared return types of the queryOptions and mutationOptions factories in src/api/<resource>/
// (exported functions name their return type). The query key carries the data type as a tag, which
// is what makes queryClient.getQueryData(taskKeys.detail(id)) typed without a cast.
import type {
  InfiniteData,
  QueryKey,
  QueryKeyWithDataTag,
  UnusedSkipTokenInfiniteOptions,
  UnusedSkipTokenOptions,
  UseMutationOptions,
} from '@tanstack/react-query';

/** What a query factory returns: options whose key is tagged with `TData`, errors are ApiErrors. */
export type ApiQueryOptions<TData, TKey extends QueryKey> = UnusedSkipTokenOptions<
  TData,
  Error,
  TData,
  TKey
> &
  QueryKeyWithDataTag<TKey, TData>;

/** What a paged (infinite) query factory returns: pages of `TPage`, fetched by `TPageParam`. */
export type ApiInfiniteQueryOptions<
  TPage,
  TKey extends QueryKey,
  TPageParam,
> = UnusedSkipTokenInfiniteOptions<
  TPage,
  Error,
  InfiniteData<TPage, TPageParam>,
  TKey,
  TPageParam
> &
  QueryKeyWithDataTag<TKey, InfiniteData<TPage>>;

/** What a mutation factory returns; `TSnapshot` is what onMutate saves for a rollback. */
export type ApiMutationOptions<TData, TVariables, TSnapshot = unknown> = UseMutationOptions<
  TData,
  Error,
  TVariables,
  TSnapshot
>;
