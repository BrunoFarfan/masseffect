# Deployment

Mass Effect is a static site on Cloudflare Workers Static Assets. There is no
Worker script, API, database or runtime framework. Wrangler is a pinned development
dependency; the browser still downloads only ordinary HTML, CSS and ES modules.

| Branch       | Environment  | Worker               | URL                                                        |
| ------------ | ------------ | -------------------- | ---------------------------------------------------------- |
| `staging`    | `preview`    | `masseffect-preview` | https://masseffect-preview.bruno-farfan-miquel.workers.dev |
| `production` | `production` | `masseffect`         | https://masseffect.bruni.to                                |

`staging` is the development/default branch. Changes reach production through a
`staging` → `production` pull request, never a direct production push. Production
requires the `checks` and `production promotion source` checks and an up-to-date
branch. Protections apply to administrators; force pushes and branch deletion
are disabled. GitHub environments restrict preview to staging and production to
production. `main` is retained as historical context, not a deployment branch.

## GitHub Actions

Pushes to either release branch run syntax checks, numerical/build regressions,
and a Wrangler dry run before deployment. Pull requests run checks without access
to deployment secrets. Production deployments are serialized; superseded preview
deployments can be cancelled. A manual run of **CI and deploy** on either release
branch retries the same checked deployment path.

Add an Actions secret named `CLOUDFLARE_API_TOKEN` to this repository. Prefer a
dedicated token scoped to the configured account, with **Workers Scripts: Edit**,
and **Workers Routes: Edit** and **Zone: Read** for `bruni.to`. An existing token
with these permissions can also be reused. The account ID is public configuration
in `wrangler.jsonc`, not a secret. No D1, KV or R2 permissions are needed. Never
copy Wrangler's local OAuth credential into GitHub. A missing token deliberately
fails the deployment job rather than reporting a false success.

After each deployment, HTTPS smoke tests verify the exact commit, every published
asset's SHA-256 hash and MIME type, security headers, and that repository-only files
return 404. The preview has `X-Robots-Tag: noindex, nofollow`; it is **public**, not
access-controlled. Production has no indexing restriction.

The existing `bruni.to` Cloudflare Web Analytics setting can inject its beacon into
production HTML for browser requests. Production CSP permits only its documented
`static.cloudflareinsights.com` script and `cloudflareinsights.com` collection
origins in addition to same-origin game assets. Preview remains same-origin-only.
This does not add an analytics dependency to the game or change zone-wide settings.

## Local commands

Install Node.js 22+ and just, then `npm ci` to install the pinned deployment tooling.
Local gameplay (`just run`) and numerical tests do not require those dependencies.

```sh
just check
just test
just deploy-check preview
just deploy-check production
```

`just build preview` or `just build production` replaces only generated `dist/`.
The build explicitly includes `index.html`, `style.css` and `src/*.js`, plus generated
security headers and `release.json`. Tests, docs, dependencies, local screenshots
and credentials are never uploaded. There is no bundling or minification.

For authorized manual recovery/bootstrap, authenticate using `npx wrangler login`
and deploy the appropriate **clean, committed release branch**:

```sh
just deploy preview
just smoke https://masseffect-preview.bruno-farfan-miquel.workers.dev preview
```

Use `production` in both commands and the production URL for a production release.
Cloudflare provisions DNS and TLS through the configured Worker Custom Domain;
do not create a competing CNAME. Asset responses revalidate so unchanged module
URLs do not keep an old release in the browser cache. Reload existing open tabs
after a release to load its code.

To revert a release, revert the change on staging, check it on preview, and promote
the revert through another production PR. Keep staging current with production's
merge commits before the next promotion.
