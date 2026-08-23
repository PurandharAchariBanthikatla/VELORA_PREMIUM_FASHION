import PDFDocument from "pdfkit";

// Streams a simple, legible invoice PDF for a paid order directly to an
// HTTP response — no temp files, no external rendering service. Kept
// deliberately plain (no custom fonts/logo) so it renders correctly with
// only PDFKit's built-in fonts, which need no extra assets deployed with
// the container image.
export function streamInvoicePdf(res, { order, settings }) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${order.orderNumber}.pdf"`);
  doc.pipe(res);

  const money = (n) => `${settings.currency === "INR" ? "Rs. " : settings.currency + " "}${Number(n || 0).toFixed(2)}`;

  doc.fontSize(20).font("Helvetica-Bold").text(settings.storeName || "VELORA", { continued: false });
  doc.fontSize(10).font("Helvetica").fillColor("#555").text(settings.tagline || "Premium Fashion & Lifestyle");
  doc.moveDown(1.5);

  doc.fillColor("#000").fontSize(14).font("Helvetica-Bold").text("TAX INVOICE");
  doc.moveDown(0.5);
  doc.fontSize(10).font("Helvetica");
  doc.text(`Invoice / Order Number: ${order.orderNumber}`);
  doc.text(`Order Date: ${new Date(order.createdAt).toLocaleString()}`);
  if (order.paidAt) doc.text(`Payment Date: ${new Date(order.paidAt).toLocaleString()}`);
  doc.text(`Payment Status: ${order.payment?.status || "n/a"}`);
  doc.moveDown(1);

  doc.font("Helvetica-Bold").text("Billed To:");
  doc.font("Helvetica").text(order.customer.name);
  doc.text(order.customer.email);
  doc.text(order.shippingAddress || "-", { width: 495 });
  doc.moveDown(1);

  const tableTop = doc.y;
  doc.font("Helvetica-Bold");
  doc.text("Item", 50, tableTop, { width: 260 });
  doc.text("Qty", 320, tableTop, { width: 50, align: "right" });
  doc.text("Unit Price", 380, tableTop, { width: 80, align: "right" });
  doc.text("Amount", 465, tableTop, { width: 80, align: "right" });
  doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor("#ccc").stroke();

  let y = tableTop + 22;
  doc.font("Helvetica");
  for (const item of order.items) {
    doc.text(item.title, 50, y, { width: 260 });
    doc.text(String(item.quantity), 320, y, { width: 50, align: "right" });
    doc.text(money(item.unitPrice), 380, y, { width: 80, align: "right" });
    doc.text(money(item.unitPrice * item.quantity), 465, y, { width: 80, align: "right" });
    y += 20;
  }
  doc.moveTo(50, y + 4).lineTo(545, y + 4).strokeColor("#ccc").stroke();
  y += 14;

  const summaryLine = (label, value, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica");
    doc.text(label, 380, y, { width: 80, align: "right" });
    doc.text(value, 465, y, { width: 80, align: "right" });
    y += 18;
  };
  summaryLine("Subtotal", money(order.summary.subtotal));
  if (order.summary.discount) summaryLine(`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`, `-${money(order.summary.discount)}`);
  summaryLine("Shipping", money(order.summary.shipping));
  summaryLine("Tax", money(order.summary.taxes));
  summaryLine("Total", money(order.summary.total), true);

  doc.moveDown(3);
  doc.fontSize(8).fillColor("#888").text(
    `This is a computer-generated invoice for ${settings.storeName || "VELORA"} and does not require a signature. ` +
    `For questions, contact ${settings.supportEmail || "support@velora.com"}.`,
    50, doc.y, { width: 495 }
  );

  doc.end();
}
