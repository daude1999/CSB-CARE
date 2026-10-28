export function employeeRoute(
  employeeId: string,
  branch: string,
  returnTo?: string,
): string {
  const params = new URLSearchParams({ branch });
  if (returnTo) params.set("returnTo", returnTo);
  return `/people/${encodeURIComponent(employeeId)}?${params.toString()}`;
}
