/** Request headers the platform sets for itself in src/middleware.ts. A value sent by a client is always overwritten. */

/** The request's own path, for the server: row-level security scope and request logging. */
export const PATH_HEADER = "x-csb-pathname";
