const { money, escapeHtml, toast, auth, api } = window.Velora;

const state = {
  products: [],
  category: "all",
  search: "",
  sort: "featured",
  cart: JSON.parse(localStorage.getItem("veloraCart") || "[]"), // [{id, qty}]
  wishlist: JSON.parse(localStorage.getItem("veloraWishlist") || "[]"), // [id]
  user: auth.getUser(),
  orders: [],
  stockWarnings: {}, // productId -> warning message
  appliedCoupon: null,
  settings: { currency: 'INR', freeShippingThreshold: 5000, taxPercent: 5 }
};

const el = (id) => document.getElementById(id);
const grid = el("productsGrid");
const productCount = el("productCount");
const collectionTitle = el("collectionTitle");
const cartBadge = el("cartBadge");
const wishBadge = el("wishBadge");
const ordersBadge = el("ordersBadge");
const userGreeting = el("userGreeting");
const authButton = el("authButton");
const panelOverlay = el("panelOverlay");
const loginOverlay = el("loginOverlay");
const detailOverlay = el("productDetail");
const detailBox = el("detailBox");

window.Velora.setSessionExpiredHandler(() => {
  auth.clearSession();
  state.user = null;
  updateBadges();
  toast("Your session expired. Please sign in again.", true);
});

function saveLocal() {
  localStorage.setItem("veloraCart", JSON.stringify(state.cart));
  localStorage.setItem("veloraWishlist", JSON.stringify(state.wishlist));
  updateBadges();
}

function setBadgeCount(badgeEl, value) {
  const next = String(value);
  if (badgeEl.textContent !== next) {
    badgeEl.textContent = next;
    badgeEl.classList.remove("bump");
    // Force reflow so the animation can restart even if it's already running.
    void badgeEl.offsetWidth;
    badgeEl.classList.add("bump");
  }
}

function updateBadges() {
  setBadgeCount(cartBadge, state.cart.reduce((n, i) => n + i.qty, 0));
  setBadgeCount(wishBadge, state.wishlist.length);
  setBadgeCount(ordersBadge, state.orders.length);

  if (state.user) {
    userGreeting.textContent = `Hi, ${state.user.name.split(" ")[0]}`;
    authButton.textContent = "Sign Out";
    authButton.dataset.mode = "signout";
  } else {
    userGreeting.textContent = "";
    authButton.textContent = "Sign In";
    authButton.dataset.mode = "signin";
  }

  const adminLink = el("adminNavLink");
  if (state.user?.role === "admin") {
    if (!adminLink) {
      const link = document.createElement("a");
      link.id = "adminNavLink";
      link.className = "nav-link";
      link.href = "admin/index.html";
      link.textContent = "Admin Panel";
      el("userGreeting").insertAdjacentElement("afterend", link);
    }
  } else if (adminLink) {
    adminLink.remove();
  }

  const accountLink = el("accountNavLink");
  if (state.user && state.user.role !== "admin") {
    if (!accountLink) {
      const link = document.createElement("a");
      link.id = "accountNavLink";
      link.className = "nav-icon-btn";
      link.href = "account.html";
      link.textContent = "My Account";
      cartBadge.closest(".nav-icon-btn").insertAdjacentElement("beforebegin", link);
    }
  } else if (accountLink) {
    accountLink.remove();
  }
}

// ---------------- Cart sync (server-side when signed in) ----------------

let cartSyncTimer = null;

function queueCartSync() {
  if (!state.user) return;
  window.clearTimeout(cartSyncTimer);
  cartSyncTimer = window.setTimeout(async () => {
    try {
      await api("/api/account/cart", { method: "PUT", body: { cart: state.cart } });
    } catch {
      // Non-fatal: cart stays correct locally even if the sync failed.
    }
  }, 500);
}

async function mergeServerCartOnLogin() {
  try {
    const data = await api("/api/account/cart");
    const serverCart = data.cart || [];
    const merged = [...state.cart];
    serverCart.forEach((serverItem) => {
      const existing = merged.find((i) => i.id === serverItem.id);
      if (existing) existing.qty = Math.max(existing.qty, serverItem.qty);
      else merged.push(serverItem);
    });
    state.cart = merged;
    saveLocal();
    queueCartSync();
  } catch {
    // If this fails, the local cart is still usable.
  }
}

// ---------------- Products ----------------

function skeletonGrid(count = 8) {
  return Array.from({ length: count })
    .map(() => '<div class="product-card-skeleton"><div class="skeleton-img shimmer"></div><div class="skeleton-line shimmer" style="width:60%"></div><div class="skeleton-line shimmer" style="width:85%"></div><div class="skeleton-line shimmer" style="width:40%"></div></div>')
    .join("");
}

async function loadStoreSettings() { try { const d=await api('/api/store/settings',{skipAuth:true}); state.settings={...state.settings,...d.settings}; } catch {} }

async function loadProducts() {
  const params = new URLSearchParams({ category: state.category, search: state.search, sort: state.sort });
  grid.innerHTML = skeletonGrid();
  try {
    const data = await api(`/api/products?${params}`, { skipAuth: true });
    state.products = data.products;
    renderProducts();
  } catch (error) {
    grid.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
    productCount.textContent = "Backend offline";
  }
}

function renderProducts() {
  grid.innerHTML = "";
  collectionTitle.textContent = state.category === "all" ? "All Products" : `${state.category[0].toUpperCase()}${state.category.slice(1)} Collection`;
  productCount.textContent = `${state.products.length} pieces`;

  if (state.products.length === 0) {
    grid.innerHTML = '<div class="no-products"><h3>No products found</h3><p>Try a different search or filter.</p></div>';
    return;
  }

  state.products.forEach((product, index) => {
    const card = document.createElement("article");
    card.className = "product-card reveal-up";
    card.style.animationDelay = `${Math.min(index, 24) * 35}ms`;
    const isWished = state.wishlist.includes(product.id);
    const isNew = product.discountPercent >= 50;
    const outOfStock = Number(product.stock ?? 25) <= 0;

    card.innerHTML = `
      <div class="product-img-wrap">
        ${isNew ? '<span class="product-badge new">Trending</span>' : ""}
        ${outOfStock ? '<span class="product-badge">Sold Out</span>' : ""}
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy" />
        <div class="product-actions">
          <button class="product-action-btn add-btn" type="button" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Sold Out" : "Add to Bag"}</button>
          <button class="product-action-btn wishlist-action-btn heart-btn" type="button">${isWished ? "Saved" : "Wishlist"}</button>
        </div>
      </div>
      <div class="product-info">
        <div class="product-brand">${escapeHtml(product.brand)}</div>
        <h3 class="product-name">${escapeHtml(product.title)}</h3>
        <div class="product-category">${escapeHtml(product.gender)} · ${escapeHtml(product.category)}</div>
        <div class="product-price">${money(product.sellingPrice)}<span class="original">${money(product.mrp)}</span></div>
        <div class="product-stars">${"★".repeat(Math.round(product.rating))}${"☆".repeat(5 - Math.round(product.rating))} (${product.rating})</div>
      </div>
    `;

    card.querySelector(".add-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!outOfStock) addToCart(product.id);
    });
    card.querySelector(".heart-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleWishlist(product.id);
    });
    card.addEventListener("click", () => openProductDetail(product));

    grid.appendChild(card);
  });
}

function openProductDetail(product) {
  const outOfStock = Number(product.stock ?? 25) <= 0;
  detailBox.innerHTML = `
    <div class="detail-grid">
      <div class="detail-image"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" /></div>
      <div class="detail-info">
        <div class="product-brand">${escapeHtml(product.brand)}</div>
        <h2>${escapeHtml(product.title)}</h2>
        <div class="product-price">${money(product.sellingPrice)}<span class="original">${money(product.mrp)}</span> <em>${product.discountPercent}% off</em></div>
        <p class="detail-desc">${escapeHtml(product.description)}</p>
        <div class="product-category">${escapeHtml(product.gender)} · ${escapeHtml(product.category)} · ${escapeHtml(product.color || "")}</div>
        <div class="product-stars">${"★".repeat(Math.round(product.rating))}${"☆".repeat(5 - Math.round(product.rating))} (${product.rating}${product.reviewCount ? `, ${product.reviewCount} review${product.reviewCount === 1 ? "" : "s"}` : ""})</div>
        <p class="stock-line">${outOfStock ? "Out of stock" : `${product.stock ?? 25} in stock`}</p>
        <div class="detail-actions">
          <button class="btn-primary" id="detailAddBtn" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Sold Out" : "Add to Bag"}</button>
          <button class="btn-secondary" id="detailWishBtn">${state.wishlist.includes(product.id) ? "Remove from Wishlist" : "Add to Wishlist"}</button>
        </div>
      </div>
    </div>
    <div class="reviews-section" id="reviewsSection">
      <div class="dash-toolbar">
        <h3 style="margin:0">Customer Reviews</h3>
        <button class="btn-secondary" id="writeReviewBtn" style="display:none">Write a Review</button>
      </div>
      <div id="reviewsList">Loading reviews...</div>
    </div>
  `;
  el("detailAddBtn")?.addEventListener("click", () => { if (!outOfStock) addToCart(product.id); });
  el("detailWishBtn")?.addEventListener("click", () => { toggleWishlist(product.id); openProductDetail(product); });
  detailOverlay.classList.add("active");
  detailOverlay.setAttribute("aria-hidden", "false");
  loadProductReviews(product);
}

async function loadProductReviews(product) {
  const listEl = el("reviewsList");
  try {
    const { reviews, summary } = await api(`/api/products/${product.id}/reviews`, { skipAuth: true });
    listEl.innerHTML = reviews.length
      ? reviews.map((r) => `
        <div class="review-item">
          <div class="review-meta">
            <span>${escapeHtml(r.reviewerName || "Verified Buyer")}</span>
            <span>${new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
          <div class="review-stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
          ${r.title ? `<div class="review-title">${escapeHtml(r.title)}</div>` : ""}
          <p>${escapeHtml(r.body)}</p>
        </div>
      `).join("")
      : `<p class="status">No reviews yet${summary.count === 0 ? " — be the first to share your experience." : "."}</p>`;
  } catch {
    listEl.innerHTML = '<p class="status">Could not load reviews.</p>';
  }

  const writeBtn = el("writeReviewBtn");
  if (!state.user || state.user.role === "admin") { writeBtn.style.display = "none"; return; }
  try {
    const { eligible } = await api(`/api/products/${product.id}/reviews/eligibility`);
    writeBtn.style.display = eligible ? "inline-flex" : "none";
    writeBtn.onclick = () => openWriteReviewModal(product);
  } catch {
    writeBtn.style.display = "none";
  }
}

function openWriteReviewModal(product) {
  const { openModal, closeModal } = window.Velora;
  let rating = 5;
  const overlay = openModal(`
    <h3>Write a Review</h3>
    <p style="color:var(--grey);font-size:0.85rem;margin-bottom:1rem">${escapeHtml(product.title)}</p>
    <form id="detailReviewForm">
      <label>Rating
        <div class="star-rating-input" id="detailStarInput">${[1,2,3,4,5].map((n) => `<span class="star selected" data-star="${n}">★</span>`).join("")}</div>
      </label>
      <label>Title (optional) <input type="text" id="detailReviewTitle" maxlength="120" /></label>
      <label>Your Review <textarea id="detailReviewBody" rows="4" required></textarea></label>
      <p class="login-error" id="detailReviewError" style="display:none"></p>
      <div class="v-modal-actions">
        <button class="btn-primary" type="submit">Submit Review</button>
        <button class="btn-secondary" type="button" id="detailReviewCancel">Cancel</button>
      </div>
    </form>
  `);
  const stars = [...overlay.querySelectorAll(".star")];
  stars.forEach((s) => s.addEventListener("click", () => {
    rating = Number(s.dataset.star);
    stars.forEach((x) => x.classList.toggle("selected", Number(x.dataset.star) <= rating));
  }));
  overlay.querySelector("#detailReviewCancel").addEventListener("click", closeModal);
  overlay.querySelector("#detailReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = overlay.querySelector("#detailReviewError");
    errorEl.style.display = "none";
    try {
      await api(`/api/products/${product.id}/reviews`, {
        method: "POST",
        body: { rating, title: overlay.querySelector("#detailReviewTitle").value.trim(), body: overlay.querySelector("#detailReviewBody").value.trim() }
      });
      closeModal();
      toast("Thanks for your review!");
      loadProductReviews(product);
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.style.display = "block";
    }
  });
}

el("detailClose").addEventListener("click", () => {
  detailOverlay.classList.remove("active");
  detailOverlay.setAttribute("aria-hidden", "true");
});

// ---------------- Cart / Wishlist ----------------

function addToCart(productId) {
  const existing = state.cart.find((i) => i.id === productId);
  if (existing) existing.qty += 1;
  else state.cart.push({ id: productId, qty: 1 });
  saveLocal();
  queueCartSync();
  toast("Added to your bag");
  openPanel("cartPanel");
}

async function syncWishlistToServer() {
  if (!state.user) return;
  try {
    await api("/api/account/wishlist", { method: "PUT", body: { wishlist: state.wishlist } });
  } catch {
    // Non-fatal.
  }
}

function toggleWishlist(productId) {
  const exists = state.wishlist.includes(productId);
  state.wishlist = exists ? state.wishlist.filter((id) => id !== productId) : [...state.wishlist, productId];
  saveLocal();
  syncWishlistToServer();
  renderProducts();
}

function cartLines() {
  return state.cart
    .map((item) => ({ ...item, product: state.products.find((p) => p.id === item.id) || allProductsCacheFind(item.id) }))
    .filter((line) => line.product);
}

const productIndex = new Map();
function allProductsCacheFind(id) {
  return productIndex.get(id);
}

function cartSummary() {
  const subtotal = cartLines().reduce((sum, line) => sum + line.product.sellingPrice * line.qty, 0);
  const discount = state.appliedCoupon && subtotal > 0 ? Math.min(state.appliedCoupon.discount, subtotal) : 0;
  const discountedSubtotal = Math.max(0, subtotal - discount);
  const shipping = discountedSubtotal >= Number(state.settings.freeShippingThreshold) || discountedSubtotal === 0 ? 0 : 299;
  const taxes = Math.round(discountedSubtotal * Number(state.settings.taxPercent) / 100);
  return { subtotal, discount, shipping, taxes, total: discountedSubtotal + shipping + taxes };
}

function renderCartPanel() {
  const body = el("cartBody");
  const footer = el("cartFooter");
  const lines = cartLines();

  if (lines.length === 0) {
    body.innerHTML = '<p class="status">Your bag is empty.</p>';
    footer.innerHTML = "";
    return;
  }

  body.innerHTML = lines.map((line) => {
    const warning = state.stockWarnings[line.id];
    return `
    <div class="drawer-item" data-id="${line.id}">
      <img src="${escapeHtml(line.product.image)}" alt="" />
      <div class="drawer-item-details">
        <strong>${escapeHtml(line.product.title)}</strong>
        <span>${escapeHtml(line.product.brand)}</span>
        <div class="qty-row">
          <button class="qty-btn" data-action="dec">-</button>
          <span>${line.qty}</span>
          <button class="qty-btn" data-action="inc">+</button>
        </div>
        <b>${money(line.product.sellingPrice * line.qty)}</b>
        ${warning ? `<div class="stock-warning">${escapeHtml(warning)}</div>` : ""}
      </div>
      <button class="remove-btn" data-action="remove" aria-label="Remove">×</button>
    </div>
  `;
  }).join("");

  body.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".drawer-item").dataset.id;
      const item = state.cart.find((i) => i.id === id);
      if (btn.dataset.action === "inc") item.qty += 1;
      if (btn.dataset.action === "dec") item.qty = Math.max(1, item.qty - 1);
      if (btn.dataset.action === "remove") state.cart = state.cart.filter((i) => i.id !== id);
      saveLocal();
      queueCartSync();
      renderCartPanel();
    });
  });

  const summary = cartSummary();
  footer.innerHTML = `
    <div class="summary-line"><span>Subtotal</span><strong>${money(summary.subtotal)}</strong></div>
    <div class="summary-line"><span>Shipping</span><strong>${summary.shipping ? money(summary.shipping) : "Free"}</strong></div>
    <div class="summary-line"><span>Taxes</span><strong>${money(summary.taxes)}</strong></div>
    <div class="summary-line summary-total"><span>Total</span><strong>${money(summary.total)}</strong></div>
    <button class="btn-primary" id="checkoutBtn" type="button">Checkout</button>
  `;
  el("checkoutBtn").addEventListener("click", beginCheckout);
}

function renderWishlistPanel() {
  const body = el("wishlistBody");
  const items = state.wishlist.map((id) => allProductsCacheFind(id)).filter(Boolean);

  if (items.length === 0) {
    body.innerHTML = '<p class="status">Your wishlist is empty.</p>';
    return;
  }

  body.innerHTML = items.map((product) => `
    <div class="drawer-item" data-id="${product.id}">
      <img src="${escapeHtml(product.image)}" alt="" />
      <div class="drawer-item-details">
        <strong>${escapeHtml(product.title)}</strong>
        <span>${escapeHtml(product.brand)}</span>
        <b>${money(product.sellingPrice)}</b>
        <button class="btn-secondary small" data-action="move">Move to Bag</button>
      </div>
      <button class="remove-btn" data-action="remove" aria-label="Remove">×</button>
    </div>
  `).join("");

  body.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".drawer-item").dataset.id;
      if (btn.dataset.action === "remove") toggleWishlist(id);
      if (btn.dataset.action === "move") { addToCart(id); toggleWishlist(id); }
      renderWishlistPanel();
    });
  });
}

async function renderOrdersPanel() {
  const body = el("ordersBody");
  if (!state.user) {
    body.innerHTML = '<p class="status">Sign in to view your order history.</p>';
    return;
  }
  body.innerHTML = '<p class="status">Loading orders...</p>';
  try {
    const data = await api("/api/orders");
    state.orders = data.orders;
    updateBadges();
    if (state.orders.length === 0) {
      body.innerHTML = '<p class="status">You have not placed any orders yet.</p>';
      return;
    }
    body.innerHTML = state.orders.map((order) => `
      <div class="order-card">
        <div class="order-card-head">
          <strong>${order.orderNumber}</strong>
          <span class="status-pill status-${order.status}">${order.status}</span>
        </div>
        <span class="order-date">${new Date(order.createdAt).toLocaleString()}</span>
        <div class="order-items">
          ${order.items.map((i) => `<div>${escapeHtml(i.title)} × ${i.quantity}</div>`).join("")}
        </div>
        <div class="summary-line summary-total"><span>Total</span><strong>${money(order.summary.total)}</strong></div>
      </div>
    `).join("");
  } catch (error) {
    body.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

// ---------------- Panels ----------------

function openPanel(id) {
  panelOverlay.classList.add("active");
  el(id).classList.add("open");
  el(id).setAttribute("aria-hidden", "false");
  if (id === "cartPanel") renderCartPanel();
  if (id === "wishlistPanel") renderWishlistPanel();
  if (id === "ordersPanel") renderOrdersPanel();
}

function closeAllPanels() {
  document.querySelectorAll(".side-panel.open").forEach((panel) => {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  });
  panelOverlay.classList.remove("active");
}

document.querySelectorAll("[data-close-panel]").forEach((btn) => btn.addEventListener("click", closeAllPanels));
panelOverlay.addEventListener("click", closeAllPanels);

el("cartButton").addEventListener("click", () => openPanel("cartPanel"));
el("wishlistButton").addEventListener("click", () => openPanel("wishlistPanel"));
el("ordersButton").addEventListener("click", () => {
  if (!state.user) { openLogin("login"); return; }
  openPanel("ordersPanel");
});

// ---------------- Checkout ----------------

async function beginCheckout() {
  if (cartLines().length === 0) return;
  if (!state.user) {
    closeAllPanels();
    openLogin("login");
    toast("Please sign in to checkout");
    return;
  }

  state.appliedCoupon = null;

  // Validate stock right before checkout so a customer sees "only 2 left"
  // instead of finding out for the first time at the payment step.
  state.stockWarnings = {};
  try {
    const result = await api("/api/cart/validate", {
      method: "POST",
      skipAuth: true,
      body: { items: state.cart.map((i) => ({ productId: i.id, quantity: i.qty })) }
    });
    result.items.forEach((item) => {
      if (!item.available) state.stockWarnings[item.productId] = item.reason;
    });
  } catch {
    // If validation itself fails, fall through — the order endpoint still
    // enforces stock as the final source of truth.
  }

  if (Object.keys(state.stockWarnings).length > 0) {
    renderCartPanel();
    openPanel("cartPanel");
    toast("Please review your bag — some items changed availability", true);
    return;
  }

  renderCheckoutForm();
  openPanel("checkoutPanel");
}

function renderCheckoutForm() {
  const form = el("checkoutForm");
  const summary = cartSummary();
  form.innerHTML = `
    <label class="form-group">Shipping Address
      <textarea id="shipAddress" rows="2" placeholder="Street, City, State, PIN" required>${escapeHtml(state.user?.addresses?.[0]?.line1 || (typeof state.user?.addresses?.[0] === "string" ? state.user.addresses[0] : "") || "")}</textarea>
    </label>
<div class="form-group"><strong>Secure payment</strong><p>Card details are entered only on Stripe-hosted checkout. VELORA never receives or stores your card number.</p></div>
    <div class="summary-items">
      ${cartLines().map((line) => `<div><span>${escapeHtml(line.product.title)} × ${line.qty}</span><strong>${money(line.product.sellingPrice * line.qty)}</strong></div>`).join("")}
    </div>
    <div id="couponArea"></div>
    <div class="summary-line"><span>Subtotal</span><strong>${money(summary.subtotal)}</strong></div>
    <div class="summary-line discount-line" id="discountLine" style="display:${summary.discount ? "flex" : "none"}"><span>Coupon discount</span><strong id="discountValue">-${money(summary.discount)}</strong></div>
    <div class="summary-line"><span>Shipping</span><strong id="shippingValue">${summary.shipping ? money(summary.shipping) : "Free"}</strong></div>
    <div class="summary-line"><span>Taxes</span><strong id="taxesValue">${money(summary.taxes)}</strong></div>
    <div class="summary-line summary-total"><span>Total</span><strong id="totalValue">${money(summary.total)}</strong></div>
    <p class="login-error" id="checkoutMessage"></p>
  `;

  renderCouponArea();


  const footer = el("checkoutFooter");
  footer.innerHTML = '<button class="btn-primary" id="placeOrderBtn" type="button">Pay securely with Stripe</button>';
  el("placeOrderBtn").addEventListener("click", placeOrder);
}

function refreshCheckoutSummary() {
  const summary = cartSummary();
  const discountLine = el("discountLine");
  if (discountLine) {
    discountLine.style.display = summary.discount ? "flex" : "none";
    el("discountValue").textContent = `-${money(summary.discount)}`;
  }
  el("shippingValue").textContent = summary.shipping ? money(summary.shipping) : "Free";
  el("taxesValue").textContent = money(summary.taxes);
  el("totalValue").textContent = money(summary.total);
}

function renderCouponArea() {
  const area = el("couponArea");
  if (!area) return;

  if (state.appliedCoupon) {
    area.innerHTML = `
      <div class="coupon-applied-banner">
        <span>Coupon <strong>${escapeHtml(state.appliedCoupon.code)}</strong> applied - you saved ${money(state.appliedCoupon.discount)}</span>
        <button type="button" id="removeCouponBtn">Remove</button>
      </div>
    `;
    el("removeCouponBtn").addEventListener("click", () => {
      state.appliedCoupon = null;
      renderCouponArea();
      refreshCheckoutSummary();
    });
  } else {
    area.innerHTML = `
      <div class="coupon-apply-row">
        <input type="text" id="couponInput" placeholder="Have a coupon code?" />
        <button type="button" id="applyCouponBtn">Apply</button>
      </div>
      <p class="login-error" id="couponError" style="display:none"></p>
    `;
    el("applyCouponBtn").addEventListener("click", applyCoupon);
    el("couponInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyCoupon(); }
    });
  }
}

async function applyCoupon() {
  const input = el("couponInput");
  const errorEl = el("couponError");
  const code = input.value.trim();
  if (!code) return;
  errorEl.style.display = "none";

  try {
    const subtotal = cartSummary().subtotal;
    const result = await api("/api/coupons/validate", {
      method: "POST",
      skipAuth: true,
      body: { code, subtotal }
    });
    if (!result.valid) {
      errorEl.textContent = result.reason || "This coupon isn't valid.";
      errorEl.style.display = "block";
      return;
    }
    state.appliedCoupon = { code: result.coupon.code, discount: result.discount };
    renderCouponArea();
    refreshCheckoutSummary();
    toast(`Coupon ${result.coupon.code} applied`);
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = "block";
  }
}

async function placeOrder() {
  const message = el("checkoutMessage"); const button = el("placeOrderBtn"); const address = el("shipAddress").value.trim();
  message.textContent=""; if(!address){message.textContent="Please enter a shipping address.";return;}
  button.disabled=true; button.innerHTML='<span class="spinner-inline"></span>Opening secure checkout...';
  try {
    const data=await api('/api/payments/checkout',{method:'POST',body:{items:state.cart.map(i=>({productId:i.id,quantity:i.qty})),shippingAddress:address,couponCode:state.appliedCoupon?.code}});
    window.location.href=data.checkoutUrl;
  } catch(error){message.textContent=error.message;button.disabled=false;button.textContent='Pay securely with Stripe';}
}

// ---------------- Auth ----------------

function openLogin(tab) {
  loginOverlay.classList.add("active");
  loginOverlay.setAttribute("aria-hidden", "false");
  switchAuthTab(tab || "login");
}

function closeLogin() {
  loginOverlay.classList.remove("active");
  loginOverlay.setAttribute("aria-hidden", "true");
}

function switchAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => btn.classList.toggle("active", btn.dataset.authTab === tab));
  el("loginForm").classList.toggle("active", tab === "login");
  el("registerForm").classList.toggle("active", tab === "register");
  el("forgotForm").classList.toggle("active", tab === "forgot");
}

document.querySelectorAll("[data-auth-tab]").forEach((btn) => btn.addEventListener("click", () => switchAuthTab(btn.dataset.authTab)));

loginOverlay.addEventListener("click", (e) => { if (e.target === loginOverlay) closeLogin(); });

async function afterAuthSuccess(data) {
  auth.setSession(data.refreshToken ? data : { ...data, token: data.token });
  state.user = data.user;
  saveLocal();
  await mergeServerCartOnLogin();
  closeLogin();
  toast(`Welcome, ${data.user.name.split(" ")[0]}`);
  if (data.user.role === "admin") {
    window.location.href = "admin/index.html";
    return;
  }
  if (cartLines().length > 0) beginCheckout();
}

el("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorEl = el("loginError");
  errorEl.style.display = "none";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      skipAuth: true,
      body: { email: el("loginEmail").value.trim(), password: el("loginPassword").value }
    });
    await afterAuthSuccess(data);
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = "block";
  }
});

el("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorEl = el("registerError");
  errorEl.style.display = "none";
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      skipAuth: true,
      body: { name: el("regName").value.trim(), email: el("regEmail").value.trim(), password: el("regPassword").value }
    });
    await afterAuthSuccess(data);
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = "block";
  }
});

el("forgotPasswordLink").addEventListener("click", () => switchAuthTab("forgot"));
el("backToLoginLink").addEventListener("click", () => switchAuthTab("login"));

el("forgotForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorEl = el("forgotError");
  const successEl = el("forgotSuccess");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  try {
    const data = await api("/api/auth/forgot-password", {
      method: "POST",
      skipAuth: true,
      body: { email: el("forgotEmail").value.trim() }
    });
    successEl.textContent = data.devResetLink
      ? `${data.message} (Dev mode — no email server configured: open ${data.devResetLink} to reset it.)`
      : data.message;
    successEl.style.display = "block";
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = "block";
  }
});

el("guestButton")?.addEventListener("click", closeLogin);

authButton.addEventListener("click", async () => {
  if (authButton.dataset.mode === "signout") {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* best effort */ }
    auth.clearSession();
    state.user = null;
    state.orders = [];
    saveLocal();
    toast("Signed out");
    closeAllPanels();
  } else {
    openLogin("login");
  }
});

// ---------------- Filters ----------------

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.category = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item.dataset.filter === state.category));
    document.querySelector("#collections")?.scrollIntoView({ behavior: "smooth" });
    loadStoreSettings().then(loadProducts);
  });
});

el("searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  window.clearTimeout(window.searchTimer);
  window.searchTimer = window.setTimeout(loadProducts, 300);
});

el("sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  loadStoreSettings().then(loadProducts);
});

el("themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("veloraTheme", document.body.classList.contains("dark") ? "dark" : "light");
});

if (localStorage.getItem("veloraTheme") === "dark") document.body.classList.add("dark");

// ---------------- Init ----------------

async function loadAllProductsIndex() {
  try {
    const data = await api("/api/products?limit=0", { skipAuth: true });
    data.products.forEach((p) => productIndex.set(p.id, p));
  } catch {
    // ignore - falls back to page-scoped state.products
  }
}

async function init() {
  const loader = el("loader");
  const hideLoader = () => {
    if (!loader || loader.dataset.hidden) return;
    loader.dataset.hidden = "true";
    loader.classList.add("hidden");
    window.setTimeout(() => loader.remove(), 700);
    document.body.classList.add("page-ready");
  };
  // Never let a slow or failed request leave the splash screen stuck forever.
  const safetyTimer = window.setTimeout(hideLoader, 6000);

  try {
    document.querySelector('[data-filter="all"]')?.classList.add("active");

    if (auth.getAccessToken()) {
      try {
        const me = await api("/api/auth/me");
        state.user = me.user;
        auth.setSession({ user: me.user });
      } catch {
        auth.clearSession();
        state.user = null;
      }
    }

    saveLocal();
    await Promise.all([loadStoreSettings(), loadAllProductsIndex(), loadProducts()]);
    if (state.user) await mergeServerCartOnLogin();
  } finally {
    window.clearTimeout(safetyTimer);
    hideLoader();
  }
}

init();
