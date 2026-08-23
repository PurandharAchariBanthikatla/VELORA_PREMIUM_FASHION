const { money, escapeHtml, toast, auth, api, API_BASE } = window.Velora;

if (!auth.getAccessToken() || !auth.getUser()) {
  window.location.href = "index.html";
}

let user = auth.getUser();
if (user?.role === "admin") {
  window.location.href = "admin/index.html";
}

window.Velora.setSessionExpiredHandler(() => {
  auth.clearSession();
  window.location.href = "index.html";
});

const el = (id) => document.getElementById(id);
let ordersCache = [];
let addressesCache = [];
let orderStatusFilter = "";

// ---------------- Navigation ----------------

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".dash-section").forEach((section) => {
      section.style.display = section.id === `view-${btn.dataset.view}` ? "block" : "none";
    });
    if (btn.dataset.view === "orders") loadOrders();
    if (btn.dataset.view === "wishlist") loadWishlist();
    if (btn.dataset.view === "addresses") loadAddresses();
    if (btn.dataset.view === "notifications") loadNotifications();
    if (btn.dataset.view === "support") loadTickets();
  });
});

document.querySelectorAll(".settings-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".settings-tab").forEach((b) => b.classList.toggle("active", b === btn));
    el("settings-profile").style.display = btn.dataset.settings === "profile" ? "block" : "none";
    el("settings-security").style.display = btn.dataset.settings === "security" ? "block" : "none";
  });
});

el("logoutBtn").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* best effort */ }
  auth.clearSession();
  window.location.href = "index.html";
});

// ---------------- Profile / Security ----------------

el("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = el("profileMessage");
  message.style.display = "none";
  try {
    const data = await api("/api/auth/me", {
      method: "PUT",
      body: { name: el("profileName").value.trim(), phone: el("profilePhone").value.trim(), address: el("profileAddress").value.trim() }
    });
    user = data.user;
    auth.setSession({ user });
    renderWelcome();
    toast("Profile updated");
  } catch (error) {
    message.textContent = error.message;
    message.style.display = "block";
  }
});

el("passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = el("passwordMessage");
  const success = el("passwordSuccess");
  message.style.display = "none";
  success.style.display = "none";
  try {
    await api("/api/auth/password", {
      method: "PUT",
      body: {
        currentPassword: el("currentPassword").value,
        newPassword: el("newPassword").value
      }
    });
    success.textContent = "Password updated successfully.";
    success.style.display = "block";
    el("passwordForm").reset();
    toast("Password updated");
  } catch (error) {
    message.textContent = error.message;
    message.style.display = "block";
  }
});

function renderWelcome() {
  el("welcomeName").textContent = `Welcome, ${user.name}`;
  el("welcomeEmail").textContent = user.email;
  el("profileName").value = user.name || "";
  el("profileEmail").value = user.email || "";
  el("profilePhone").value = user.phone || "";
  el("profileAddress").value = (user.addresses && user.addresses[0]?.line1) || (typeof user.addresses?.[0] === "string" ? user.addresses[0] : "") || "";
}

// ---------------- Orders + Tracking ----------------

const STATUS_STEPS = ["confirmed", "processing", "shipped", "delivered"];
const STATUS_ICON = { confirmed: "✓", processing: "⚙", shipped: "🚚", delivered: "🏠" };

function trackingTimeline(order) {
  if (order.status === "cancelled") {
    return `
      <div class="tracking-timeline">
        <div class="tracking-step cancelled">
          <div class="dot">×</div>
          <div class="tracking-label">Cancelled</div>
        </div>
      </div>
    `;
  }

  const historyByStatus = {};
  (order.statusHistory || []).forEach((h) => { historyByStatus[h.status] = h.at; });
  const currentIndex = STATUS_STEPS.indexOf(order.status);

  return `
    <div class="tracking-timeline">
      ${STATUS_STEPS.map((step, index) => {
        const done = index < currentIndex || (index === currentIndex && order.status === "delivered");
        const current = index === currentIndex && order.status !== "delivered";
        const at = historyByStatus[step];
        const cls = done ? "done" : current ? "current" : "";
        return `
          <div class="tracking-step ${cls}">
            <div class="dot">${STATUS_ICON[step]}</div>
            <div class="tracking-label">${step}</div>
            ${at ? `<span class="tracking-time">${new Date(at).toLocaleDateString()}</span>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function orderCard(order) {
  const canReturnOrReview = order.status === "delivered";
  return `
    <div class="order-detail-card" data-order-id="${order.id}">
      <div class="order-card-head">
        <strong>${escapeHtml(order.orderNumber)}</strong>
        <span class="status-pill status-${order.status}">${escapeHtml(order.status)}</span>
      </div>
      <span class="order-date">${new Date(order.createdAt).toLocaleString()}</span>
      ${trackingTimeline(order)}
      <div class="order-items" style="margin-top:1rem">
        ${order.items.map((i) => `
          <div class="order-item-row">
            <span>${escapeHtml(i.title)} × ${i.quantity} <span style="color:var(--grey)">(${money(i.unitPrice * i.quantity)})</span></span>
            ${canReturnOrReview ? `
              <span class="order-item-actions">
                <button class="icon-btn" data-action="return" data-product-id="${escapeHtml(i.productId)}" data-title="${escapeHtml(i.title)}" data-qty="${i.quantity}">Request Return</button>
                <button class="icon-btn" data-action="review" data-product-id="${escapeHtml(i.productId)}" data-title="${escapeHtml(i.title)}">Write Review</button>
              </span>
            ` : ""}
          </div>
        `).join("")}
      </div>
      <div style="margin-top:0.75rem;font-size:0.75rem;color:var(--grey)">Shipping to: ${escapeHtml(order.shippingAddress || "-")}</div>
      ${order.summary?.discount ? `<div class="summary-line discount-line"><span>Coupon discount</span><strong>-${money(order.summary.discount)}</strong></div>` : ""}
      <div class="summary-line summary-total"><span>Total</span><strong>${money(order.summary?.total)}</strong></div>
      <div class="order-card-actions">
        ${order.paidAt ? `<button class="btn-secondary" data-action="invoice">Download Invoice</button>` : ""}
      </div>
    </div>
  `;
}

// Event delegation for order-card buttons (invoice download, return
// request, write review) — the cards are re-rendered on every filter
// change, so a single listener on the wrapper avoids re-binding per card.
el("ordersListWrap").addEventListener("click", async (event) => {
  const card = event.target.closest(".order-detail-card");
  if (!card) return;
  const orderId = card.dataset.orderId;
  const order = ordersCache.find((o) => o.id === orderId);
  const btn = event.target.closest("[data-action]");
  if (!btn) return;

  if (btn.dataset.action === "invoice") {
    try {
      await window.Velora.downloadFile(`/api/orders/${orderId}/invoice`, `invoice-${order.orderNumber}.pdf`);
    } catch (error) {
      toast(error.message, true);
    }
  } else if (btn.dataset.action === "return") {
    openReturnModal(order, btn.dataset.productId, btn.dataset.title, Number(btn.dataset.qty));
  } else if (btn.dataset.action === "review") {
    openReviewModal(order, btn.dataset.productId, btn.dataset.title);
  }
});

function openReturnModal(order, productId, title, maxQty) {
  const { openModal, closeModal } = window.Velora;
  const overlay = openModal(`
    <h3>Request a Return</h3>
    <p style="color:var(--grey);font-size:0.85rem;margin-bottom:1rem">${escapeHtml(title)} — Order ${escapeHtml(order.orderNumber)}</p>
    <form id="returnForm">
      <label>Quantity to return
        <input type="number" id="returnQty" min="1" max="${maxQty}" value="1" required />
      </label>
      <label>Reason
        <textarea id="returnReason" rows="3" required placeholder="e.g. Wrong size, changed my mind, item damaged..."></textarea>
      </label>
      <p class="login-error" id="returnFormError" style="display:none"></p>
      <div class="v-modal-actions">
        <button class="btn-primary" type="submit">Submit Request</button>
        <button class="btn-secondary" type="button" id="returnCancelBtn">Cancel</button>
      </div>
    </form>
  `);
  overlay.querySelector("#returnCancelBtn").addEventListener("click", closeModal);
  overlay.querySelector("#returnForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = overlay.querySelector("#returnFormError");
    errorEl.style.display = "none";
    try {
      await api(`/api/orders/${order.id}/returns`, {
        method: "POST",
        body: { productId, quantity: Number(overlay.querySelector("#returnQty").value), reason: overlay.querySelector("#returnReason").value.trim() }
      });
      closeModal();
      toast("Return request submitted.");
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.style.display = "block";
    }
  });
}

function openReviewModal(order, productId, title) {
  const { openModal, closeModal } = window.Velora;
  let rating = 5;
  const overlay = openModal(`
    <h3>Write a Review</h3>
    <p style="color:var(--grey);font-size:0.85rem;margin-bottom:1rem">${escapeHtml(title)}</p>
    <form id="reviewForm">
      <label>Rating
        <div class="star-rating-input" id="starInput">${[1,2,3,4,5].map((n) => `<span class="star selected" data-star="${n}">★</span>`).join("")}</div>
      </label>
      <label>Title (optional) <input type="text" id="reviewTitle" maxlength="120" /></label>
      <label>Your Review <textarea id="reviewBody" rows="4" required></textarea></label>
      <p class="login-error" id="reviewFormError" style="display:none"></p>
      <div class="v-modal-actions">
        <button class="btn-primary" type="submit">Submit Review</button>
        <button class="btn-secondary" type="button" id="reviewCancelBtn">Cancel</button>
      </div>
    </form>
  `);
  const stars = [...overlay.querySelectorAll(".star")];
  function paintStars() { stars.forEach((s) => s.classList.toggle("selected", Number(s.dataset.star) <= rating)); }
  stars.forEach((s) => s.addEventListener("click", () => { rating = Number(s.dataset.star); paintStars(); }));
  overlay.querySelector("#reviewCancelBtn").addEventListener("click", closeModal);
  overlay.querySelector("#reviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = overlay.querySelector("#reviewFormError");
    errorEl.style.display = "none";
    try {
      await api(`/api/products/${productId}/reviews`, {
        method: "POST",
        body: { rating, title: overlay.querySelector("#reviewTitle").value.trim(), body: overlay.querySelector("#reviewBody").value.trim() }
      });
      closeModal();
      toast("Thanks for your review!");
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.style.display = "block";
    }
  });
}

async function loadOrders() {
  const wrap = el("ordersListWrap");
  wrap.innerHTML = "Loading...";
  try {
    const data = await api("/api/orders");
    ordersCache = data.orders || [];
    renderOrdersList();

    const totalSpent = ordersCache.reduce((sum, o) => sum + (o.summary?.total || 0), 0);
    window.Velora.animateCount(el("statOrders"), ordersCache.length);
    window.Velora.animateCount(el("statSpent"), totalSpent, { formatter: money });

    const rowFor = (o) => `
      <tr>
        <td>${escapeHtml(o.orderNumber)}</td>
        <td>${new Date(o.createdAt).toLocaleDateString()}</td>
        <td>${o.items.reduce((n, i) => n + i.quantity, 0)} item(s)</td>
        <td>${money(o.summary?.total)}</td>
        <td><span class="status-pill status-${o.status}">${escapeHtml(o.status)}</span></td>
      </tr>
    `;
    el("recentOrdersBody").innerHTML = ordersCache.length
      ? ordersCache.slice(0, 5).map(rowFor).join("")
      : '<tr><td colspan="5">No orders yet — start shopping!</td></tr>';
  } catch (error) {
    wrap.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

function renderOrdersList() {
  const list = orderStatusFilter ? ordersCache.filter((o) => o.status === orderStatusFilter) : ordersCache;
  const wrap = el("ordersListWrap");
  wrap.innerHTML = list.length
    ? list.map(orderCard).join("")
    : '<p class="status">No orders in this category.</p>';
}

el("orderStatusTabs").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-status]");
  if (!btn) return;
  document.querySelectorAll("#orderStatusTabs .dash-pill-tab").forEach((b) => b.classList.toggle("active", b === btn));
  orderStatusFilter = btn.dataset.status;
  renderOrdersList();
});

// ---------------- Wishlist ----------------

async function loadWishlist() {
  try {
    const data = await api("/api/account/wishlist");
    const ids = data.wishlist || [];
    window.Velora.animateCount(el("statWishlist"), ids.length);

    if (ids.length === 0) {
      el("wishlistBody").innerHTML = '<tr><td colspan="3">Your wishlist is empty.</td></tr>';
      return;
    }

    const results = await Promise.all(ids.map((id) => fetch(`${API_BASE}/api/products/${id}`).then((r) => (r.ok ? r.json() : null))));
    const products = results.filter(Boolean);
    el("wishlistBody").innerHTML = products.map((p) => `
      <tr>
        <td><img src="${escapeHtml(p.image)}" alt="" style="width:42px;height:52px;object-fit:cover;margin-right:0.6rem;vertical-align:middle;border-radius:6px" />${escapeHtml(p.title)}</td>
        <td>${money(p.sellingPrice)}</td>
        <td><a class="icon-btn" href="index.html">View in store</a></td>
      </tr>
    `).join("");
  } catch {
    el("wishlistBody").innerHTML = '<tr><td colspan="3">Could not load wishlist items.</td></tr>';
  }
}

// ---------------- Saved Addresses ----------------

function addressCardHtml(address) {
  const lines = [address.line1, address.line2, [address.city, address.state].filter(Boolean).join(", "), address.pincode].filter(Boolean);
  return `
    <div class="address-card ${address.isDefault ? "is-default" : ""}" data-id="${address.id}">
      <div class="address-label">${escapeHtml(address.label)} ${address.isDefault ? '<span class="default-chip">Default</span>' : ""}</div>
      <div class="address-text">${lines.map(escapeHtml).join("<br>")}${address.phone ? `<br>Phone: ${escapeHtml(address.phone)}` : ""}</div>
      <div class="address-actions">
        <button class="icon-btn" data-action="edit">Edit</button>
        ${!address.isDefault ? '<button class="icon-btn" data-action="default">Set Default</button>' : ""}
        <button class="icon-btn danger" data-action="delete">Delete</button>
      </div>
    </div>
  `;
}

async function loadAddresses() {
  const grid = el("addressGrid");
  grid.innerHTML = "Loading...";
  try {
    const data = await api("/api/account/addresses");
    addressesCache = data.addresses || [];
    window.Velora.animateCount(el("statAddresses"), addressesCache.length);

    grid.innerHTML = addressesCache.map(addressCardHtml).join("") + `
      <button class="address-card-add" type="button" id="addAddressBtn">+ Add New Address</button>
    `;

    el("addAddressBtn").addEventListener("click", () => openAddressForm(null));

    grid.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".address-card");
        const id = card.dataset.id;
        const address = addressesCache.find((a) => a.id === id);
        if (btn.dataset.action === "edit") openAddressForm(address);
        if (btn.dataset.action === "delete") {
          if (!confirm("Delete this address?")) return;
          try {
            await api(`/api/account/addresses/${id}`, { method: "DELETE" });
            toast("Address deleted");
            loadAddresses();
          } catch (error) { toast(error.message, true); }
        }
        if (btn.dataset.action === "default") {
          try {
            await api(`/api/account/addresses/${id}/default`, { method: "PUT" });
            toast("Default address updated");
            loadAddresses();
          } catch (error) { toast(error.message, true); }
        }
      });
    });
  } catch (error) {
    grid.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

function openAddressForm(address) {
  const form = el("addressForm");
  form.style.display = "grid";
  el("addressMessage").style.display = "none";
  el("addressId").value = address?.id || "";
  el("aLabel").value = address?.label || "";
  el("aPhone").value = address?.phone || "";
  el("aLine1").value = address?.line1 || "";
  el("aLine2").value = address?.line2 || "";
  el("aCity").value = address?.city || "";
  el("aState").value = address?.state || "";
  el("aPincode").value = address?.pincode || "";
  el("aDefault").checked = Boolean(address?.isDefault);
  form.scrollIntoView({ behavior: "smooth" });
}

el("cancelAddressBtn").addEventListener("click", () => { el("addressForm").style.display = "none"; });

el("addressForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = el("addressMessage");
  message.style.display = "none";
  const payload = {
    label: el("aLabel").value.trim(),
    phone: el("aPhone").value.trim(),
    line1: el("aLine1").value.trim(),
    line2: el("aLine2").value.trim(),
    city: el("aCity").value.trim(),
    state: el("aState").value.trim(),
    pincode: el("aPincode").value.trim(),
    isDefault: el("aDefault").checked
  };
  try {
    const id = el("addressId").value;
    if (id) {
      await api(`/api/account/addresses/${id}`, { method: "PUT", body: payload });
      toast("Address updated");
    } else {
      await api("/api/account/addresses", { method: "POST", body: payload });
      toast("Address added");
    }
    el("addressForm").style.display = "none";
    loadAddresses();
  } catch (error) {
    message.textContent = error.message;
    message.style.display = "block";
  }
});

// ---------------- Notifications ----------------
// Derived from order status history (no separate backend table needed) —
// read/unread state persists per-account in localStorage.

function notifStorageKey() {
  return `veloraNotifRead_${user.id}`;
}

function getReadSet() {
  try { return new Set(JSON.parse(localStorage.getItem(notifStorageKey()) || "[]")); } catch { return new Set(); }
}

function markRead(ids) {
  const readSet = getReadSet();
  ids.forEach((id) => readSet.add(id));
  localStorage.setItem(notifStorageKey(), JSON.stringify([...readSet]));
}

const NOTIF_COPY = {
  confirmed: (o) => `Your order ${o.orderNumber} has been confirmed.`,
  processing: (o) => `Order ${o.orderNumber} is now being processed.`,
  shipped: (o) => `Great news — order ${o.orderNumber} has shipped!`,
  delivered: (o) => `Order ${o.orderNumber} was delivered. Enjoy!`,
  cancelled: (o) => `Order ${o.orderNumber} was cancelled.`
};

const NOTIF_ICON = { confirmed: "✓", processing: "⚙", shipped: "🚚", delivered: "🎉", cancelled: "×" };

function buildNotifications() {
  const notifs = [];
  ordersCache.forEach((order) => {
    (order.statusHistory || []).forEach((h) => {
      notifs.push({
        id: `${order.id}-${h.status}`,
        icon: NOTIF_ICON[h.status] || "•",
        title: (NOTIF_COPY[h.status] || (() => `Order ${order.orderNumber} updated to ${h.status}.`))(order),
        at: h.at
      });
    });
  });
  return notifs.sort((a, b) => new Date(b.at) - new Date(a.at));
}

async function loadNotifications() {
  const list = el("notifList");
  list.innerHTML = "Loading...";
  if (ordersCache.length === 0) {
    try {
      const data = await api("/api/orders");
      ordersCache = data.orders || [];
    } catch {
      list.innerHTML = '<p class="status">Could not load notifications.</p>';
      return;
    }
  }

  const notifs = buildNotifications();
  const readSet = getReadSet();
  const unreadCount = notifs.filter((n) => !readSet.has(n.id)).length;

  const badge = el("notifBadge");
  if (unreadCount > 0) {
    badge.textContent = unreadCount;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }

  list.innerHTML = notifs.length
    ? notifs.map((n) => `
      <div class="notif-card ${readSet.has(n.id) ? "" : "unread"}" data-id="${n.id}">
        <div class="notif-icon">${n.icon}</div>
        <div class="notif-body">
          <div class="notif-title">${escapeHtml(n.title)}</div>
          <div class="notif-meta">${new Date(n.at).toLocaleString()}</div>
        </div>
        ${readSet.has(n.id) ? "" : '<div class="notif-dot"></div>'}
      </div>
    `).join("")
    : '<p class="status">No notifications yet — place an order to see updates here.</p>';

  list.querySelectorAll(".notif-card").forEach((card) => {
    card.addEventListener("click", () => {
      markRead([card.dataset.id]);
      card.classList.remove("unread");
      card.querySelector(".notif-dot")?.remove();
      const remaining = list.querySelectorAll(".notif-card.unread").length;
      if (remaining > 0) { badge.textContent = remaining; } else { badge.style.display = "none"; }
    });
  });
}

el("markAllReadBtn").addEventListener("click", () => {
  markRead(buildNotifications().map((n) => n.id));
  loadNotifications();
});

// ---------------- Support ----------------

let ticketsCache = [];
let activeTicketId = null;

el("newTicketBtn").addEventListener("click", () => {
  el("ticketForm").style.display = "grid";
  el("ticketListWrap").style.display = "none";
});
el("cancelTicketBtn").addEventListener("click", () => {
  el("ticketForm").style.display = "none";
  el("ticketListWrap").style.display = "block";
  el("ticketForm").reset();
});

el("ticketForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = el("ticketMessage");
  message.style.display = "none";
  try {
    await api("/api/support", {
      method: "POST",
      body: { subject: el("ticketSubject").value.trim(), orderId: el("ticketOrder").value.trim() || undefined, body: el("ticketBody").value.trim() }
    });
    toast("Support ticket submitted.");
    el("ticketForm").reset();
    el("ticketForm").style.display = "none";
    el("ticketListWrap").style.display = "block";
    loadTickets();
  } catch (error) {
    message.textContent = error.message;
    message.style.display = "block";
  }
});

async function loadTickets() {
  const wrap = el("ticketListWrap");
  wrap.innerHTML = "Loading...";
  el("ticketThreadWrap").style.display = "none";
  try {
    const data = await api("/api/support");
    ticketsCache = data.tickets || [];
    wrap.innerHTML = ticketsCache.length
      ? ticketsCache.map((t) => `
        <div class="ticket-list-item" data-id="${t.id}">
          <div>
            <div style="font-weight:600">${escapeHtml(t.subject)}</div>
            <div style="font-size:0.75rem;color:var(--grey)">Updated ${new Date(t.updatedAt).toLocaleString()}</div>
          </div>
          <span class="status-pill status-${t.status === "closed" ? "cancelled" : t.status === "pending" ? "processing" : "confirmed"}">${escapeHtml(t.status)}</span>
        </div>
      `).join("")
      : '<p class="status">No support tickets yet. Use "New Ticket" if you need help with anything.</p>';

    wrap.querySelectorAll(".ticket-list-item").forEach((item) => {
      item.addEventListener("click", () => openTicketThread(item.dataset.id));
    });
  } catch (error) {
    wrap.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

async function openTicketThread(id) {
  activeTicketId = id;
  el("ticketListWrap").style.display = "none";
  el("ticketThreadWrap").style.display = "block";
  el("ticketMessages").innerHTML = "Loading...";
  try {
    const { ticket, messages } = await api(`/api/support/${id}`);
    el("ticketThreadSubject").textContent = ticket.subject;
    el("ticketThreadStatus").textContent = `Status: ${ticket.status}${ticket.orderNumber ? ` · Order ${ticket.orderNumber}` : ""}`;
    el("ticketMessages").innerHTML = messages.map((m) => `
      <div class="support-message ${m.senderRole}">
        <div class="meta">${escapeHtml(m.senderName)} · ${new Date(m.createdAt).toLocaleString()}</div>
        <div>${escapeHtml(m.body)}</div>
      </div>
    `).join("");
  } catch (error) {
    el("ticketMessages").innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

el("backToTicketsBtn").addEventListener("click", () => {
  el("ticketThreadWrap").style.display = "none";
  el("ticketListWrap").style.display = "block";
  loadTickets();
});

el("ticketReplyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const textarea = el("ticketReplyBody");
  if (!textarea.value.trim()) return;
  try {
    await api(`/api/support/${activeTicketId}/messages`, { method: "POST", body: { body: textarea.value.trim() } });
    textarea.value = "";
    openTicketThread(activeTicketId);
  } catch (error) {
    toast(error.message, true);
  }
});

// ---------------- Init ----------------

renderWelcome();
loadOrders().then(loadNotifications);
loadWishlist();
