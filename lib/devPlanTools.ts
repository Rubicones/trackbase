/**
 * Whether the dev-only plan tooling is reachable.
 *
 * There is no billing yet, so *assigning* a plan is a privileged operation with
 * no legitimate self-serve path: nothing a user does may set `profiles.plan`.
 * Until Stripe exists, plan assignment is a development affordance only, and
 * every endpoint that writes a plan gates on this flag.
 *
 * `next build` sets NODE_ENV to production for every deployment, Vercel
 * previews included, so this is false everywhere except `next dev`.
 *
 * Lives in `lib/` rather than in a route module so both the server routes and
 * the client context can read the same constant without importing a route
 * handler (which would drag `POST`/`GET` exports into another module's graph).
 * `contexts/PaywallContext.tsx` re-exports it for client components.
 */
export const DEV_PLAN_TOOLS_AVAILABLE = process.env.NODE_ENV === 'development'
