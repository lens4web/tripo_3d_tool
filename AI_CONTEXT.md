# Tripo V3 character pipeline

This public web app at https://tripo3d.lens4web.com (also available locally) turns character images into a 3D model through the Tripo V3 API. Run `npm start`, then open `http://127.0.0.1:3000`. Run `npm test` for local contract and proxy tests. Live generation needs the user's Tripo API key and consumes credits; the tests do not call Tripo.

## Authoritative API documentation

- [V3 introduction](https://developers.tripo3d.ai/en/docs/introduction)
- [Image to image](https://developers.tripo3d.ai/en/docs/generation-image-to-image)
- [Image to multiview](https://developers.tripo3d.ai/en/docs/generation-image-to-multiview)
- [Multiview to model, H series](https://developers.tripo3d.ai/en/docs/generation-multiview-to-model/standard) and [P series](https://developers.tripo3d.ai/en/docs/generation-multiview-to-model/p)
- [Model conversion](https://developers.tripo3d.ai/en/docs/models-convert)
- [Task query](https://developers.tripo3d.ai/en/docs/task-query), [file upload](https://developers.tripo3d.ai/en/docs/files), [pricing](https://developers.tripo3d.ai/en/pricing)

The former `https://platform.tripo3d.ai/docs/api` link is not the source used to verify V3 contracts. Some V2 endpoints use similar names but different payloads. Recheck the V3 endpoint page before changing a request.

## Project files

- `server.js`: Express server with Helmet, route/body/origin limits, controlled Node fetch proxy and streamed downloads. Serves localized HTML, explicitly listed browser/brand assets, robots, sitemap and healthz. site.js renders crawlable metadata; i18n.js holds six-language strings; preferences.js selects language and theme. It listens only on loopback. Production requires PUBLIC_ORIGIN and uses a fixed Tripo upstream; TRIPO_API_BASE is for local tests only. Keys are submitted to POST /api/session and stored only in server memory, keyed by a random opaque HttpOnly cookie. API calls retrieve the key from that session and construct Authorization upstream; cookies/client credentials are never forwarded. Exported createApp supports isolated tests.
- `index.html`: interface with data-i18n attributes for English, Russian, Spanish, German, French and Chinese. Browser language/system theme are defaults; manual choices persist in localStorage. `app.js`: DOM interaction and asynchronous pipeline. `pipeline.js`: shared validation, payload construction, and cost estimates. `pipeline.test.js`: offline tests.
- Keys are never retained in browser storage. Legacy localStorage/sessionStorage entries are deleted on load. The server session does not expire on a timer; Disconnect or process restart removes it. Session cookies are HttpOnly/SameSite=Strict and Secure in production. Applying a key stores it but does not verify it. nginx is public, with no Basic authentication. API/downloads still require a session.

## Pipeline and exact V3 fields

1. Upload JPEG/PNG with `POST /v3/files`. Read `data.file_token`.
2. In `Single object / prop` mode, call `POST /v3/generation/image-to-model` with `{input: file_token, model, texture: true, pbr: true, texture_quality: "standard", ...}`. Skip multiview hallucination and T-pose.
3. In `Any pose` mode, call `POST /v3/generation/image-to-image` with `{input: file_token, template: "t_pose", model: "seedream_v5"}`. Poll `GET /v3/tasks/{task_id}` and read `output.generated_image_url`. Pass that URL to the next step.
4. In `Any pose` and `T-pose or A-pose` modes, call `POST /v3/generation/image-to-multiview` with `{input: image_url_or_file_token}`. Read the four separate URLs `front_view_url`, `left_view_url`, `back_view_url`, `right_view_url` for display/download. Pass the multiview task to model generation as `inputs: [{task_id: multiview_task_id}]`.
5. In `Separate views` mode, upload at least a front image and one more view. Pass tokens as `inputs: [{front: token}, {left: token}, ...]`; omit missing optional views.
6. Call `POST /v3/generation/multiview-to-model` with `inputs`, `model`, texture settings and optional `face_limit`. Read `output.model_url`.
7. Call `POST /v3/models/convert` with `{input: model_task_id, format: "FBX" | "GLTF" | "OBJ" | "STL", bake, ...}`. For FBX set `fbx_preset: "mixamo"`. Read `output.model_url`.

For these V3 endpoints, do **not** use `files`, `original_task_id`, or `original_model_task_id` as replacements for the fields above. Those names occur in other API versions or tasks.

## Settings and limitations

- Quad output is available only with FBX conversion, because the conversion API forces FBX when `quad=true`. The UI disables quad for the other formats. STL is geometry-only, so the UI also disables texture baking for STL.
- `face_limit` is validated against the selected model's documented range. A blank field omits it for adaptive topology. When quad conversion is selected, the limit is also sent to conversion; otherwise that step would use its own 10,000-face default.
- The cost display is an estimate from published standard prices. P1/P2 standard textured generation costs 110 credits; H-series multiview costs 30. Advanced conversion (quad) costs 10 rather than the basic 5. Actual `credits_consumed` is shown when returned by tasks.
- FBX export uses the Mixamo preset and runs the free riggability check on the generated GLB. It warns if the model is not confirmed as a riggable biped. Conversion does not add a skeleton; producing one requires the separate rig endpoint.
- Automatic downloading uses the local server's same-origin CDN proxy. It accepts HTTPS URLs on `cdn.tripo3d.ai`, its subdomains and `tripo-data.rg1.data.tripo3d.com`, with every redirect checked. Files are bounded attachments; generated images use the same proxy. Nested generate_multiview_image outputs are also supported. If Tripo returns a different host or the download fails, the UI also provides an original file link. This path has not been verified with a live paid API task.
- The app requires a current browser with `AbortSignal.timeout`, `fetch`, and `ReadableStream` support. The server requires a Node version with built-in `fetch` and `Readable.fromWeb` (Node 18+).

User-facing UI/logs are localized through TripoI18n; preserve complete message sets across all six languages. Upstream technical error details may remain in their original language. The local tests mock API contracts; they cannot guarantee that a generated character has correct geometry or is suitable for rigging.

## Deployment

Use deploy/nginx.conf and deploy/tripo3d.service with .env.example. Node 24 LTS is recommended (minimum 22). See DEPLOY_RU.md, README.md and SECURITY.md. Do not deploy as static HTML; nginx proxies the public site to a loopback Node service, preserving session cookies. Use one Node process because sessions are not shared. Do not commit data.json, credentials or release archives.

Brand assets: assets/icon.svg plus ready raster icons/social-card.png, favicon.ico and site.webmanifest. scripts/build-brand-assets.py is an optional Pillow generator, not a runtime dependency. Page metadata, canonical/hreflang URLs and .env/nginx origin are fixed to https://tripo3d.lens4web.com.
