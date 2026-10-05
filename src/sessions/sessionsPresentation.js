export function sessionPageNumbers(currentPage, lastPage) {
  if (lastPage <= 1) return [];
  if (lastPage <= 5) return Array.from({ length: lastPage }, (_, index) => index + 1);
  if (currentPage <= 3) return [1, 2, 3, "gap-end", lastPage];
  if (currentPage >= lastPage - 2) return [1, "gap-start", lastPage - 2, lastPage - 1, lastPage];
  return [1, "gap-start", currentPage, "gap-end", lastPage];
}
