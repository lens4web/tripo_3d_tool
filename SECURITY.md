# Security review

Updated 2026-10-17 for the public repository `lens4web/tripo_3d_tool` and public deployment https://tripo3d.lens4web.com. This documents source architecture, dependency audit, infrastructure defense-in-depth, and local security verification.

## Public repository safety audit

- **Zero credential leakage**: Verified complete absence of API keys, private keys, credentials, `.env` files, and local generation history (`data.json`) across the entire Git commit tree and working tree.
- **Strict ignore rules**: Sensitive assets (`.env`, `data.json`, `*.pem`, `*.key`, `*.log`, credentials directories) are explicitly enforced via `.gitignore` and verified uncommitted.
- **Zero known dependency vulnerabilities**: Regular verification via `npm audit --omit=dev` confirms 0 known vulnerabilities across production runtime dependencies.

## Credentials and sessions

- API keys are submitted only to `POST /api/session`, then held in server process memory. They are not returned in responses, saved in files/database, logged or retained in browser application storage. The frontend clears the password field after submission and removes legacy localStorage/sessionStorage entries.
- A cryptographically random 256-bit token identifies each user's isolated session. The browser keeps only an opaque HttpOnly, SameSite=Strict cookie; production uses a Secure `__Host-` cookie. JavaScript cannot read this cookie. Applying another key rotates the session token and revokes the previous one.
- Keys are retained in server process memory and are removed from the session map upon explicit Disconnect, when applying a replacement key, or on process restart. Sessions do not expire on an automatic timer, giving the user full manual control over when to revoke their access. Removed strings become eligible for runtime garbage collection; this is not guaranteed physical memory zeroization.
- GET /api/session returns only connection status. API and download routes require a server session; a supplied browser X-Tripo-Key/Authorization header cannot override its key. Upstream requests contain only the stored Tripo bearer key and required content type, never the session cookie or arbitrary client credentials.
- Applying a key checks its input format only; it does not verify the account. The green indicator means applied, not verified by Tripo. The API's authentication response determines whether a key is valid.
- Creating sessions is limited to 20 requests per 15 minutes/IP and 500 simultaneous server sessions. The key necessarily passes through the browser input/request while being submitted and remains accessible to server administrators in process memory. Use a trusted host with valid HTTPS.

## Public site protections

- nginx is deliberately public, as requested, with no site-password gate. Keys provide per-session Tripo access, not a login system. Public pages, crawlers and social previews do not need a key. Robots excludes /api/; robots.txt is not access control.
- The Node process binds only to loopback. Production requires an HTTPS PUBLIC_ORIGIN and ignores the test-only API base override. Only loopback nginx is trusted for forwarded client IP/protocol. nginx replaces forwarding headers and preserves the opaque session cookie.
- Mutating API requests require an exact same-origin Origin header. Cross-site Fetch Metadata and unrecognized hostnames are rejected. No cross-origin access is enabled. API bodies require appropriate content types.
- Helmet applies a restrictive CSP: local scripts/styles plus the Umami script at https://pulse.lens4web.com/app-script and analytics connections to https://pulse.lens4web.com, no unsafe-inline, no objects or frames. Server-rendered inert JSON-LD receives its exact SHA-256 CSP hash. Locale input is selected from a fixed allowlist and translated values are escaped on the server or written using textContent in the browser.
- Public assets are explicitly allowlisted. Keys, environment files, application source, data.json and Git metadata are not served. API/private responses use no-store. The UI reads no session token and only language/theme preferences are stored in localStorage.
- Upload bodies are capped at 21 MB including multipart framing; JSON at 1 MB and session requests at 1 KB. API responses are capped at 2 MB and requests time out after 120 seconds. Tripo validates image contents; browser image checks are convenience checks.
- API calls are limited to 180 requests/minute/IP, plus 25 task-creation/upload requests per five minutes/IP. nginx adds request limiting. Limits are in memory and reset on restart; use one Node process.
- Downloads allow HTTPS only on cdn.tripo3d.ai, its subdomains and the observed storage host tripo-data.rg1.data.tripo3d.com. Credentials and non-default ports are forbidden. Each redirect is validated. Files are limited to 150 MB, six concurrent downloads and 180 seconds; requests abort on client disconnect.
- Files are attachments, with nosniff. PNG/JPEG/WebP MIME types are preserved; other files use application/octet-stream to prevent executable HTML/SVG delivery on the app origin.
- nginx access logging is disabled to avoid logging signed file URLs. Error logs can still include request URIs and must remain limited to server administrators. Neither application nor configuration logs credential headers/bodies.
- systemd runs the app as an unprivileged user with a read-only application directory, disabled core dumps and process/filesystem restrictions. data.json, local credentials, dependencies and system files are excluded from Git/release archives.

## Review results and deployment limits

- The vulnerable http-proxy-middleware dependency chain was replaced with a fixed-host Node fetch proxy. The current npm production audit reports zero known vulnerabilities; this reflects the advisory database at review time.
- Local tests cover all generation modes, session submission without browser storage, key isolation/revocation, origin/host checks, request limits, multipart forwarding, download redirects/MIME handling, six-language completeness, system theme preferences and server-rendered SEO content.
- Browser checks cover desktop/mobile layout, Russian/English controls, light/dark mode, API indicators, feedback/attribution and manual language switching. No paid generation requests were sent.
- Real TLS/cookie delivery, nginx -t and systemd startup must be checked on the target Linux server. They are not available on this Mac; the public domain has not been deployed by this change.
- This remains a single-process public tool with bounded in-memory sessions. Monitor resource usage and bandwidth; distributed abuse can exceed per-IP controls. Multiple processes/servers require a reviewed shared session store and coordinated quotas. A session cookie is a credential: a stolen cookie can use its session until revocation or restart.
- Generated files/task history are not persisted. Refresh resets visible progress but leaves the server session active; it does not cancel Tripo tasks. Download signed results while available.

References: [Express security](https://expressjs.com/en/advanced/best-practice-security/), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Google localized pages](https://developers.google.com/search/docs/specialty/international/localized-versions).
