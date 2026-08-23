const { money, escapeHtml, toast, auth, api, API_BASE } = window.Velora;

const user = auth.getUser();

if (!auth.getAccessToken() || !user || user.role !== "admin") {
  window.location.href = "login.html";
}

window.Velora.setSessionExpiredHandler(() => {
  auth.clearSession();
  window.location.href = "login.html";
});

const el = (id) => document.getElementById(id);
let allOrders = [];
let allCoupons = [];
let productPage = { page: 1, pages: 1, pageSize: 20 };
let inventoryFilter = { search: "", stockFilter: "" };

// ---------------- Navigation ----------------

const titles = {
  overview: "Dashboard Overview",
  products: "Product Catalog",
  categories: "Categories",
  orders: "Order Management",
  customers: "Customer Directory",
  inventory: "Inventory",
  analytics: "Analytics",
  coupons: "Coupons",
  reviews: "Product Reviews",
  returns: "Returns & Refunds",
  support: "Support Tickets",
  settings: "Store Settings",
  activity: "Recent Admin Activity"
};

document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".dash-section").forEach((section) => {
      section.style.display = section.id === `view-${btn.dataset.view}` ? "block" : "none";
    });
    el("pageTitle").textContent = titles[btn.dataset.view];
    if (btn.dataset.view === "products") loadProducts();
    if (btn.dataset.view === "categories") loadCategories();
    if (btn.dataset.view === "orders" && allOrders.length === 0) loadOrders();
    if (btn.dataset.view === "customers") loadCustomers();
    if (btn.dataset.view === "inventory") loadInventory();
    if (btn.dataset.view === "analytics") loadAnalytics();
    if (btn.dataset.view === "coupons") loadCoupons();
    if (btn.dataset.view === "reviews") loadReviews();
    if (btn.dataset.view === "returns") loadReturns();
    if (btn.dataset.view === "support") loadAdminTickets();
    if (btn.dataset.view === "settings") loadSettings();
    if (btn.dataset.view === "activity") loadActivity();
  });
});

el("logoutBtn").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* best effort */ }
  auth.clearSession();
  window.location.href = "../index.html";
});

el("adminName").textContent = `Signed in as ${user.name}`;

// ---------------- Mini bar chart helper ----------------

function renderMiniBarChart(containerEl, entries, { formatter } = {}) {
  if (!entries.length) {
    containerEl.innerHTML = '<p class="status">No data yet.</p>';
    return;
  }
  const max = Math.max(...entries.map((e) => e.value), 1);
  containerEl.innerHTML = entries.map((e) => {
    const heightPct = Math.max(4, Math.round((e.value / max) * 100));
    const display = formatter ? formatter(e.value) : e.value;
    return `<div class="bar" style="height:${heightPct}%" title="${escapeHtml(e.label)}: ${escapeHtml(String(display))}"></div>`;
  }).join("");
}

// ---------------- Overview ----------------

async function loadStats() {
  try {
    const stats = await api("/api/admin/stats");
    window.Velora.animateCount(el("statRevenue"), stats.totalRevenue, { formatter: money });
    window.Velora.animateCount(el("statOrders"), stats.totalOrders);
    window.Velora.animateCount(el("statCustomers"), stats.totalCustomers);
    window.Velora.animateCount(el("statProducts"), stats.totalProducts);
    window.Velora.animateCount(el("statLowStock"), stats.lowStock);
    window.Velora.animateCount(el("statCoupons"), stats.activeCoupons || 0);

    const revenueEntries = Object.entries(stats.revenueByDay || {})
      .slice(-14)
      .map(([day, total]) => ({ label: day, value: total }));
    renderMiniBarChart(el("revenueChart"), revenueEntries, { formatter: money });

    const statusEntries = Object.entries(stats.ordersByStatus || {}).map(([status, count]) => ({ label: status, value: count }));
    renderMiniBarChart(el("statusChart"), statusEntries);

    el("topProductsBody").innerHTML = stats.topProducts.length
      ? stats.topProducts.map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>${p.qty}</td><td>${money(p.revenue)}</td></tr>`).join("")
      : '<tr><td colspan="3">No sales yet.</td></tr>';

    el("recentOrdersBody").innerHTML = stats.recentOrders.length
      ? stats.recentOrders.map((o) => `
        <tr>
          <td>${escapeHtml(o.orderNumber)}</td>
          <td>${escapeHtml(o.customer?.name || "-")}</td>
          <td>${new Date(o.createdAt).toLocaleDateString()}</td>
          <td>${money(o.summary?.total)}</td>
          <td><span class="status-pill status-${o.status}">${escapeHtml(o.status)}</span></td>
        </tr>
      `).join("")
      : '<tr><td colspan="5">No orders yet.</td></tr>';

    return stats;
  } catch (error) {
    toast(error.message, true);
    return null;
  }
}

// ---------------- Products ----------------

let productSearchTimer = null;

async function loadProducts(page) {
  try {
    const params = new URLSearchParams({
      page: page || productPage.page,
      pageSize: productPage.pageSize,
      search: el("productSearch").value.trim()
    });
    const data = await api(`/api/admin/products?${params}`);
    productPage = { page: data.page, pages: data.pages, pageSize: data.pageSize };
    renderProducts(data.products);
    el("pageIndicator").textContent = `Page ${data.page} of ${data.pages} (${data.total} products)`;
    el("prevPageBtn").disabled = data.page <= 1;
    el("nextPageBtn").disabled = data.page >= data.pages;
  } catch (error) {
    el("productsBody").innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderProducts(products) {
  el("productsBody").innerHTML = products.length
    ? products.map((p) => `
      <tr>
        <td><img src="${escapeHtml(p.image)}" alt="" />${escapeHtml(p.title)}</td>
        <td>${escapeHtml(p.category)} / ${escapeHtml(p.gender)}</td>
        <td>${money(p.sellingPrice)} <span style="text-decoration:line-through;color:var(--grey)">${money(p.mrp)}</span></td>
        <td>${p.stock ?? 25}</td>
        <td>${p.rating}</td>
        <td>
          <button class="icon-btn" data-action="edit" data-id="${p.id}">Edit</button>
          <button class="icon-btn danger" data-action="delete" data-id="${p.id}">Delete</button>
        </td>
      </tr>
    `).join("")
    : '<tr><td colspan="6">No products found.</td></tr>';

  el("productsBody").querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.action === "edit") {
        const product = await api(`/api/products/${btn.dataset.id}`, { skipAuth: true });
        openProductForm(product);
      }
      if (btn.dataset.action === "delete") deleteProduct(btn.dataset.id, btn.closest("tr").querySelector("td").textContent.trim());
    });
  });
}

el("productSearch").addEventListener("input", () => {
  window.clearTimeout(productSearchTimer);
  productSearchTimer = window.setTimeout(() => loadProducts(1), 300);
});

el("prevPageBtn").addEventListener("click", () => loadProducts(productPage.page - 1));
el("nextPageBtn").addEventListener("click", () => loadProducts(productPage.page + 1));

function openProductForm(product) {
  el("productForm").style.display = "grid";
  el("productMessage").style.display = "none";
  el("uploadStatus").textContent = "";
  if (product) {
    el("productId").value = product.id;
    el("pTitle").value = product.title;
    el("pBrand").value = product.brand || "";
    el("pSellingPrice").value = product.sellingPrice;
    el("pMrp").value = product.mrp;
    el("pCategory").value = product.category || "";
    el("pGender").value = product.gender || "Unisex";
    el("pColor").value = product.color || "";
    el("pStock").value = product.stock ?? 25;
    el("pImage").value = product.image || "";
    el("pDescription").value = product.description || "";
    el("productSubmitBtn").textContent = "Update Product";
  } else {
    el("productId").value = "";
    ["pTitle", "pBrand", "pCategory", "pColor", "pImage", "pDescription"].forEach((id) => (el(id).value = ""));
    el("pSellingPrice").value = "";
    el("pMrp").value = "";
    el("pGender").value = "Unisex";
    el("pStock").value = 25;
    el("productSubmitBtn").textContent = "Save Product";
  }
  el("productForm").scrollIntoView({ behavior: "smooth" });
}

el("newProductBtn").addEventListener("click", () => openProductForm(null));
el("cancelProductBtn").addEventListener("click", () => { el("productForm").style.display = "none"; });

el("pImageFile").addEventListener("change", async () => {
  const file = el("pImageFile").files[0];
  if (!file) return;

  const status = el("uploadStatus");
  status.textContent = "Uploading...";

  try {
    const formData = new FormData();
    formData.append("image", file);
    const response = await fetch(`${API_BASE}/api/admin/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.getAccessToken()}` },
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Upload failed.");
    el("pImage").value = data.url;
    status.textContent = `Uploaded: ${data.url}`;
    toast("Image uploaded");
  } catch (error) {
    status.textContent = error.message;
    toast(error.message, true);
  }
});

el("productForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = el("productMessage");
  message.style.display = "none";

  const payload = {
    title: el("pTitle").value.trim(),
    brand: el("pBrand").value.trim(),
    sellingPrice: Number(el("pSellingPrice").value),
    mrp: Number(el("pMrp").value) || Number(el("pSellingPrice").value),
    category: el("pCategory").value.trim(),
    gender: el("pGender").value,
    color: el("pColor").value.trim(),
    stock: Number(el("pStock").value),
    image: el("pImage").value.trim(),
    description: el("pDescription").value.trim()
  };

  try {
    const id = el("productId").value;
    if (id) {
      await api(`/api/admin/products/${id}`, { method: "PUT", body: payload });
      toast("Product updated");
    } else {
      await api("/api/admin/products", { method: "POST", body: payload });
      toast("Product created");
    }
    el("productForm").style.display = "none";
    await loadProducts();
    loadStats();
  } catch (error) {
    message.textContent = error.message;
    message.style.display = "block";
  }
});

async function deleteProduct(id, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  try {
    await api(`/api/admin/products/${id}`, { method: "DELETE" });
    toast("Product deleted");
    await loadProducts();
    loadStats();
  } catch (error) {
    toast(error.message, true);
  }
}

// ---------------- Categories ----------------

async function loadCategories() {
  const grid = el("categoryGrid");
  grid.innerHTML = "Loading...";
  try {
    const data = await api("/api/admin/categories");
    grid.innerHTML = data.categories.length
      ? data.categories.map((c) => `
        <div class="category-card">
          <div class="name">${escapeHtml(c.name)}</div>
          <div class="meta">${c.productCount} product(s) · ${c.totalStock} units in stock</div>
          <div class="meta">${c.genders.map(escapeHtml).join(", ")}</div>
        </div>
      `).join("")
      : '<p class="status">No categories yet — add a product to get started.</p>';
  } catch (error) {
    grid.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

// ---------------- Orders ----------------

async function loadOrders() {
  try {
    const data = await api("/api/admin/orders");
    allOrders = data.orders;
    renderOrders();
  } catch (error) {
    el("ordersBody").innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderOrders() {
  const filter = el("orderStatusFilter").value;
  const list = filter ? allOrders.filter((o) => o.status === filter) : allOrders;

  el("ordersBody").innerHTML = list.length
    ? list.map((o) => `
      <tr>
        <td>${escapeHtml(o.orderNumber)}</td>
        <td>${escapeHtml(o.customer?.name || "-")}<br><small style="color:var(--grey)">${escapeHtml(o.customer?.email || "")}</small></td>
        <td>${new Date(o.createdAt).toLocaleString()}</td>
        <td>${o.items.reduce((n, i) => n + i.quantity, 0)} item(s)</td>
        <td>${money(o.summary?.total)}</td>
        <td><span class="status-pill status-${o.status}">${escapeHtml(o.status)}</span></td>
        <td>
          <select data-id="${o.id}" class="statusSelect">
            ${["confirmed", "processing", "shipped", "delivered", "cancelled"].map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
      </tr>
    `).join("")
    : '<tr><td colspan="7">No orders found.</td></tr>';

  el("ordersBody").querySelectorAll(".statusSelect").forEach((select) => {
    select.addEventListener("change", async () => {
      try {
        await api(`/api/admin/orders/${select.dataset.id}/status`, { method: "PUT", body: { status: select.value } });
        toast("Order status updated");
        await loadOrders();
        loadStats();
      } catch (error) {
        toast(error.message, true);
      }
    });
  });
}

el("orderStatusFilter").addEventListener("change", renderOrders);

// ---------------- Customers ----------------

async function loadCustomers() {
  try {
    const data = await api("/api/admin/users");
    el("customersBody").innerHTML = data.users.length
      ? data.users.map((u) => `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.phone || "-")}</td>
          <td>${u.orderCount}</td>
          <td>${money(u.totalSpent)}</td>
          <td>${new Date(u.createdAt).toLocaleDateString()}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="6">No customers yet.</td></tr>';
  } catch (error) {
    el("customersBody").innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

// ---------------- Inventory ----------------

let inventorySearchTimer = null;

async function loadInventory() {
  const body = el("inventoryBody");
  body.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  try {
    const params = new URLSearchParams();
    if (inventoryFilter.search) params.set("search", inventoryFilter.search);
    if (inventoryFilter.stockFilter) params.set("stockFilter", inventoryFilter.stockFilter);
    const data = await api(`/api/admin/inventory?${params}`);

    window.Velora.animateCount(el("invTotalUnits"), data.totalUnits);
    window.Velora.animateCount(el("invLowStock"), data.lowStock);
    window.Velora.animateCount(el("invOutStock"), data.outOfStock);

    body.innerHTML = data.products.length
      ? data.products.map((p) => {
        const badgeClass = p.stock <= 0 ? "out" : p.stock <= 5 ? "low" : "ok";
        const badgeText = p.stock <= 0 ? "Out of stock" : p.stock <= 5 ? "Low stock" : "In stock";
        return `
          <tr>
            <td><img src="${escapeHtml(p.image)}" alt="" style="width:36px;height:44px;object-fit:cover;border-radius:6px;margin-right:0.5rem;vertical-align:middle" />${escapeHtml(p.title)}</td>
            <td>${escapeHtml(p.category)}</td>
            <td><span class="stock-badge ${badgeClass}">${p.stock} · ${badgeText}</span></td>
            <td>
              <div class="stock-input-row">
                <input type="number" min="0" value="${p.stock}" data-id="${p.id}" class="stockInput" />
                <button type="button" class="stockSaveBtn" data-id="${p.id}">Update</button>
              </div>
            </td>
          </tr>
        `;
      }).join("")
      : '<tr><td colspan="4">No products match this filter.</td></tr>';

    body.querySelectorAll(".stockSaveBtn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const input = body.querySelector(`.stockInput[data-id="${btn.dataset.id}"]`);
        try {
          await api(`/api/admin/inventory/${btn.dataset.id}/stock`, { method: "PUT", body: { stock: Number(input.value) } });
          toast("Stock updated");
          loadInventory();
          loadStats();
        } catch (error) {
          toast(error.message, true);
        }
      });
    });
  } catch (error) {
    body.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  }
}

el("inventorySearch").addEventListener("input", () => {
  window.clearTimeout(inventorySearchTimer);
  inventoryFilter.search = el("inventorySearch").value.trim();
  inventorySearchTimer = window.setTimeout(loadInventory, 300);
});

document.querySelectorAll("#view-inventory [data-stock]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#view-inventory [data-stock]").forEach((b) => b.classList.toggle("active", b === btn));
    inventoryFilter.stockFilter = btn.dataset.stock;
    loadInventory();
  });
});

// ---------------- Analytics ----------------

async function loadAnalytics() {
  const stats = await loadStats();
  if (!stats) return;

  const revenueEntries = Object.entries(stats.revenueByDay || {}).map(([day, total]) => ({ label: day, value: total }));
  renderMiniBarChart(el("analyticsRevenueChart"), revenueEntries, { formatter: money });

  const statusEntries = Object.entries(stats.ordersByStatus || {}).map(([status, count]) => ({ label: status, value: count }));
  renderMiniBarChart(el("analyticsStatusChart"), statusEntries);

  el("analyticsTopBody").innerHTML = stats.topProducts.length
    ? stats.topProducts.map((p) => `<tr><td>${escapeHtml(p.title)}</td><td>${p.qty}</td><td>${money(p.revenue)}</td></tr>`).join("")
    : '<tr><td colspan="3">No sales yet.</td></tr>';
}

// ---------------- Coupons ----------------

async function loadCoupons() {
  const body = el("couponsBody");
  body.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
  try {
    const data = await api("/api/admin/coupons");
    allCoupons = data.coupons;
    body.innerHTML = allCoupons.length
      ? allCoupons.map((c) => `
        <tr>
          <td><span class="coupon-chip">${escapeHtml(c.code)}</span></td>
          <td>${c.type === "percent" ? "Percent" : "Fixed"}</td>
          <td>${c.type === "percent" ? `${c.value}%` : money(c.value)}</td>
          <td>${money(c.minOrder)}</td>
          <td>${c.usedCount}${c.maxUses ? ` / ${c.maxUses}` : ""}</td>
          <td>${c.active ? '<span class="status-pill status-confirmed">Active</span>' : '<span class="status-pill status-cancelled">Inactive</span>'}</td>
          <td>${c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td>
          <td>
            <button class="icon-btn" data-action="edit" data-id="${c.id}">Edit</button>
            <button class="icon-btn danger" data-action="delete" data-id="${c.id}">Delete</button>
          </td>
        </tr>
      `).join("")
      : '<tr><td colspan="8">No coupons yet.</td></tr>';

    body.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const coupon = allCoupons.find((c) => c.id === btn.dataset.id);
        if (btn.dataset.action === "edit") openCouponForm(coupon);
        if (btn.dataset.action === "delete") deleteCoupon(coupon);
      });
    });
  } catch (error) {
    body.innerHTML = `<tr><td colspan="8">${escapeHtml(error.message)}</td></tr>`;
  }
}

function openCouponForm(coupon) {
  el("couponForm").style.display = "grid";
  el("couponMessage").style.display = "none";
  el("couponId").value = coupon?.id || "";
  el("cCode").value = coupon?.code || "";
  el("cType").value = coupon?.type || "percent";
  el("cValue").value = coupon?.value ?? "";
  el("cMinOrder").value = coupon?.minOrder ?? 0;
  el("cMaxUses").value = coupon?.maxUses ?? "";
  el("cExpiresAt").value = coupon?.expiresAt ? new Date(coupon.expiresAt).toISOString().slice(0, 10) : "";
  el("cActive").checked = coupon ? coupon.active : true;
  el("couponForm").scrollIntoView({ behavior: "smooth" });
}

el("newCouponBtn").addEventListener("click", () => openCouponForm(null));
el("cancelCouponBtn").addEventListener("click", () => { el("couponForm").style.display = "none"; });

el("couponForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = el("couponMessage");
  message.style.display = "none";
  const payload = {
    code: el("cCode").value.trim().toUpperCase(),
    type: el("cType").value,
    value: Number(el("cValue").value),
    minOrder: Number(el("cMinOrder").value) || 0,
    maxUses: el("cMaxUses").value ? Number(el("cMaxUses").value) : null,
    expiresAt: el("cExpiresAt").value || null,
    active: el("cActive").checked
  };
  try {
    const id = el("couponId").value;
    if (id) {
      await api(`/api/admin/coupons/${id}`, { method: "PUT", body: payload });
      toast("Coupon updated");
    } else {
      await api("/api/admin/coupons", { method: "POST", body: payload });
      toast("Coupon created");
    }
    el("couponForm").style.display = "none";
    loadCoupons();
    loadStats();
  } catch (error) {
    message.textContent = error.message;
    message.style.display = "block";
  }
});

async function deleteCoupon(coupon) {
  if (!confirm(`Delete coupon "${coupon.code}"?`)) return;
  try {
    await api(`/api/admin/coupons/${coupon.id}`, { method: "DELETE" });
    toast("Coupon deleted");
    loadCoupons();
    loadStats();
  } catch (error) {
    toast(error.message, true);
  }
}

// ---------------- Settings ----------------

async function loadSettings() {
  try {
    const data = await api("/api/admin/settings");
    const s = data.settings;
    el("sStoreName").value = s.storeName;
    el("sTagline").value = s.tagline;
    el("sSupportEmail").value = s.supportEmail;
    el("sSupportPhone").value = s.supportPhone;
    el("sCurrency").value = s.currency;
    el("sFreeShipping").value = s.freeShippingThreshold;
    el("sTaxPercent").value = s.taxPercent;
  } catch (error) {
    toast(error.message, true);
  }
}

el("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = el("settingsMessage");
  const success = el("settingsSuccess");
  message.style.display = "none";
  success.style.display = "none";
  try {
    await api("/api/admin/settings", {
      method: "PUT",
      body: {
        storeName: el("sStoreName").value.trim(),
        tagline: el("sTagline").value.trim(),
        supportEmail: el("sSupportEmail").value.trim(),
        supportPhone: el("sSupportPhone").value.trim(),
        currency: el("sCurrency").value.trim().toUpperCase(),
        freeShippingThreshold: Number(el("sFreeShipping").value),
        taxPercent: Number(el("sTaxPercent").value)
      }
    });
    success.textContent = "Settings saved.";
    success.style.display = "block";
    toast("Settings updated");
  } catch (error) {
    message.textContent = error.message;
    message.style.display = "block";
  }
});

// ---------------- Reviews ----------------

let reviewStatusFilter = "";

el("reviewStatusTabs").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-status]");
  if (!btn) return;
  document.querySelectorAll("#reviewStatusTabs .dash-pill-tab").forEach((b) => b.classList.toggle("active", b === btn));
  reviewStatusFilter = btn.dataset.status;
  loadReviews();
});

async function loadReviews() {
  const body = el("reviewsBody");
  body.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
  try {
    const data = await api(`/api/admin/reviews${reviewStatusFilter ? `?status=${reviewStatusFilter}` : ""}`);
    const reviews = data.reviews;
    body.innerHTML = reviews.length
      ? reviews.map((r) => `
        <tr>
          <td>${escapeHtml(r.productTitle)}</td>
          <td>${escapeHtml(r.reviewerName)}</td>
          <td>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</td>
          <td style="max-width:260px">${r.title ? `<strong>${escapeHtml(r.title)}</strong><br>` : ""}${escapeHtml(r.body)}</td>
          <td><span class="status-pill status-${r.status === "published" ? "confirmed" : "cancelled"}">${escapeHtml(r.status)}</span></td>
          <td>
            <button class="icon-btn" data-action="toggle" data-id="${r.id}" data-status="${r.status}">${r.status === "published" ? "Hide" : "Publish"}</button>
            <button class="icon-btn danger" data-action="delete" data-id="${r.id}">Delete</button>
          </td>
        </tr>
      `).join("")
      : '<tr><td colspan="6">No reviews yet.</td></tr>';

    body.querySelectorAll("[data-action='toggle']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/admin/reviews/${btn.dataset.id}`, { method: "PUT", body: { status: btn.dataset.status === "published" ? "hidden" : "published" } });
          toast("Review updated");
          loadReviews();
        } catch (error) { toast(error.message, true); }
      });
    });
    body.querySelectorAll("[data-action='delete']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this review permanently?")) return;
        try {
          await api(`/api/admin/reviews/${btn.dataset.id}`, { method: "DELETE" });
          toast("Review deleted");
          loadReviews();
        } catch (error) { toast(error.message, true); }
      });
    });
  } catch (error) {
    body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
  }
}

// ---------------- Returns ----------------

let returnStatusFilter = "";

el("returnStatusTabs").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-status]");
  if (!btn) return;
  document.querySelectorAll("#returnStatusTabs .dash-pill-tab").forEach((b) => b.classList.toggle("active", b === btn));
  returnStatusFilter = btn.dataset.status;
  loadReturns();
});

async function loadReturns() {
  const body = el("returnsBody");
  body.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
  try {
    const data = await api(`/api/admin/returns${returnStatusFilter ? `?status=${returnStatusFilter}` : ""}`);
    const returns = data.returns;
    body.innerHTML = returns.length
      ? returns.map((r) => `
        <tr>
          <td>${escapeHtml(r.orderNumber)}</td>
          <td>${escapeHtml(r.customerName)}<br><span style="color:var(--grey);font-size:0.75rem">${escapeHtml(r.customerEmail)}</span></td>
          <td>${escapeHtml(r.productTitle)}</td>
          <td>${r.quantity}</td>
          <td style="max-width:220px">${escapeHtml(r.reason)}</td>
          <td><span class="status-pill status-${r.status === "refunded" || r.status === "approved" ? "confirmed" : r.status === "rejected" ? "cancelled" : "processing"}">${escapeHtml(r.status)}</span></td>
          <td>
            ${r.status === "requested" || r.status === "approved" ? `
              <button class="icon-btn" data-action="approve" data-id="${r.id}">Approve</button>
              <button class="icon-btn" data-action="refund" data-id="${r.id}">Refund</button>
              <button class="icon-btn danger" data-action="reject" data-id="${r.id}">Reject</button>
            ` : "—"}
          </td>
        </tr>
      `).join("")
      : '<tr><td colspan="7">No return requests.</td></tr>';

    body.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => resolveReturn(btn.dataset.id, btn.dataset.action));
    });
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function resolveReturn(id, action) {
  const statusMap = { approve: "approved", reject: "rejected", refund: "refunded" };
  const status = statusMap[action];
  let refundAmount;
  if (status === "refunded") {
    const input = prompt("Refund amount (leave blank for the full item amount):");
    if (input === null) return;
    if (input.trim()) refundAmount = Number(input.trim());
  }
  const adminNote = prompt("Optional note to the customer (leave blank to skip):") || undefined;
  try {
    await api(`/api/admin/returns/${id}`, { method: "PUT", body: { status, refundAmount, adminNote } });
    toast(status === "refunded" ? "Refund processed" : `Return ${status}`);
    loadReturns();
  } catch (error) {
    toast(error.message, true);
  }
}

// ---------------- Support ----------------

let supportStatusFilter = "";
let allAdminTickets = [];
let activeAdminTicketId = null;

el("supportStatusTabs").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-status]");
  if (!btn) return;
  document.querySelectorAll("#supportStatusTabs .dash-pill-tab").forEach((b) => b.classList.toggle("active", b === btn));
  supportStatusFilter = btn.dataset.status;
  loadAdminTickets();
});

async function loadAdminTickets() {
  el("adminTicketThreadWrap").style.display = "none";
  const wrap = el("adminTicketListWrap");
  wrap.style.display = "block";
  wrap.innerHTML = "Loading...";
  try {
    const data = await api(`/api/admin/support${supportStatusFilter ? `?status=${supportStatusFilter}` : ""}`);
    allAdminTickets = data.tickets;
    wrap.innerHTML = allAdminTickets.length
      ? `<div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Subject</th><th>Customer</th><th>Order</th><th>Updated</th><th>Status</th></tr></thead><tbody>${
          allAdminTickets.map((t) => `
            <tr class="ticket-list-item" data-id="${t.id}" style="cursor:pointer">
              <td>${escapeHtml(t.subject)}</td>
              <td>${escapeHtml(t.customerName)}<br><span style="color:var(--grey);font-size:0.75rem">${escapeHtml(t.customerEmail)}</span></td>
              <td>${t.orderNumber ? escapeHtml(t.orderNumber) : "—"}</td>
              <td>${new Date(t.updatedAt).toLocaleString()}</td>
              <td><span class="status-pill status-${t.status === "closed" ? "cancelled" : t.status === "pending" ? "processing" : "confirmed"}">${escapeHtml(t.status)}</span></td>
            </tr>
          `).join("")
        }</tbody></table></div>`
      : '<p class="status">No support tickets.</p>';

    wrap.querySelectorAll("[data-id]").forEach((row) => {
      row.addEventListener("click", () => openAdminTicketThread(row.dataset.id));
    });
  } catch (error) {
    wrap.innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

async function openAdminTicketThread(id) {
  activeAdminTicketId = id;
  el("adminTicketListWrap").style.display = "none";
  el("adminTicketThreadWrap").style.display = "block";
  el("adminTicketMessages").innerHTML = "Loading...";
  try {
    const { ticket, messages } = await api(`/api/admin/support/${id}`);
    el("adminTicketSubject").textContent = ticket.subject;
    el("adminTicketMeta").textContent = `${ticket.customerName} (${ticket.customerEmail}) · Status: ${ticket.status}${ticket.orderNumber ? ` · Order ${ticket.orderNumber}` : ""}`;
    el("adminTicketMessages").innerHTML = messages.map((m) => `
      <div class="support-message ${m.senderRole}">
        <div class="meta">${escapeHtml(m.senderName)} · ${new Date(m.createdAt).toLocaleString()}</div>
        <div>${escapeHtml(m.body)}</div>
      </div>
    `).join("");
  } catch (error) {
    el("adminTicketMessages").innerHTML = `<p class="status">${escapeHtml(error.message)}</p>`;
  }
}

el("adminBackToTicketsBtn").addEventListener("click", loadAdminTickets);

el("adminTicketThreadWrap").querySelectorAll("[data-set-status]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      await api(`/api/admin/support/${activeAdminTicketId}/status`, { method: "PUT", body: { status: btn.dataset.setStatus } });
      toast("Ticket status updated");
      openAdminTicketThread(activeAdminTicketId);
    } catch (error) { toast(error.message, true); }
  });
});

el("adminTicketReplyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const textarea = el("adminTicketReplyBody");
  if (!textarea.value.trim()) return;
  try {
    await api(`/api/admin/support/${activeAdminTicketId}/messages`, { method: "POST", body: { body: textarea.value.trim() } });
    textarea.value = "";
    openAdminTicketThread(activeAdminTicketId);
  } catch (error) { toast(error.message, true); }
});

// ---------------- Activity Log ----------------

async function loadActivity() {
  try {
    const data = await api("/api/admin/audit");
    el("activityBody").innerHTML = data.audit.length
      ? data.audit.map((entry) => `
        <tr>
          <td>${new Date(entry.at).toLocaleString()}</td>
          <td>${escapeHtml(entry.adminName || "-")}</td>
          <td>${escapeHtml(entry.action)} ${escapeHtml(entry.entity)}</td>
          <td>${escapeHtml(entry.summary)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="4">No activity recorded yet.</td></tr>';
  } catch (error) {
    el("activityBody").innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
  }
}

loadStats();
