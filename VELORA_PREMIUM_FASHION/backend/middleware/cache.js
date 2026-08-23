// Response cache-control policy. Personalized/private API routes (auth,
// account, orders, admin, cart, coupon validation) must never be cached by
// a shared/edge cache — the Helm chart's ingress annotations already
// document this intent (see networkPolicy/ingress comments in values.yaml),
// but nothing in the app actually set the header, so a CDN or intermediate
// proxy placed in front of this app per DEPLOYMENT_PRODUCTION.md could have
// cached a `/api/account/*` or `/api/admin/*` response and served one
// customer's private data to another. This closes that gap.
export function noStoreApi(_req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}

// Public, rarely-changing GET endpoints are safe to cache briefly at the
// edge/CDN — cuts repeat load for a storefront that gets shared traffic.
export function publicCache(seconds) {
  return (_req, res, next) => {
    res.setHeader("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
    next();
  };
}
