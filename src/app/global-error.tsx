"use client";

/**
 * Last-resort page for a failure in the root layout itself, which replaces the whole document, so it carries its own
 * html and body and plain inline styles (the app's stylesheets may not have loaded).
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f5f3", color: "#0b1530" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="alert" style={{ maxWidth: 480, width: "100%", background: "#fff", border: "1px solid #e3e6ec", borderRadius: 10, padding: 24 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>The platform couldn&apos;t load just now</h1>
            <p style={{ fontSize: 15, lineHeight: "22px", color: "#334155" }}>
              This is usually a brief connection problem on our side. Nothing you entered has been lost. Please try again in a few seconds.
            </p>
            {error.digest ? <p style={{ fontSize: 12, color: "#64748b" }}>Ref: {error.digest}</p> : null}
            <button type="button" onClick={() => window.location.reload()} style={{ background: "#0b2a4a", color: "#fff", border: 0, borderRadius: 6, padding: "8px 16px", fontSize: 14, cursor: "pointer" }}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
