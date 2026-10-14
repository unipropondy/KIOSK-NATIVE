import { API_URL } from "@/config";
import BillPDFGenerator from "./BillPDFGenerator";
import {
  formatToSingaporeDate,
  formatToSingaporeTime,
  formatToSingaporeDateTime,
} from "../utils/timezoneHelper";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function generateItemsTable(items: any[], symbol: string) {
  if (!items || !items.length) return "<p>No items</p>";
  return `<table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="amount">Qty</th>
        <th class="amount">Price</th>
        <th class="amount">Total</th>
      </tr>
    </thead>
    <tbody>
      ${items
      .map(
        (i) =>
          `<tr>
              <td>${i.name || i.Name || i.DishName || "Item"}</td>
              <td class="amount">${i.quantity || i.qty || 0}</td>
              <td class="amount">${symbol}${(i.price || 0).toFixed(2)}</td>
              <td class="amount">${symbol}${(i.revenue || (i.price || 0) * (i.quantity || 1)).toFixed(2)}</td>
            </tr>`
      )
      .join("")}
    </tbody>
  </table>`;
}

function generateTableFromObject(obj: Record<string, any>, symbol: string) {
  const entries = Object.entries(obj || {});
  if (!entries.length) return "<p>No data</p>";
  return `<table><tbody>${entries
    .map(
      ([k, v]) =>
        `<tr><td>${k}</td><td class="amount">${symbol}${Number(v).toFixed(2)}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

// ─────────────────────────────────────────────
// iframe print helper (Web only fallback)
// ─────────────────────────────────────────────
function printHtmlInIframe(iframeId: string, html: string, delayMs = 400) {
  if (typeof document === "undefined") return;
  let frame = document.getElementById(iframeId) as HTMLIFrameElement | null;
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = iframeId;
    frame.style.display = "none";
    document.body.appendChild(frame);
  }
  const doc = frame.contentWindow?.document || frame.contentDocument;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    let printed = false;
    const trigger = () => {
      if (printed) return;
      printed = true;
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    };
    frame.contentWindow?.addEventListener("load", trigger);
    setTimeout(trigger, delayMs);
  }
}

// ─────────────────────────────────────────────
// Print Bridge helpers
// ─────────────────────────────────────────────
async function isBridgeOnline(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/print-jobs/bridge-status`);
    const data = await response.json();
    return !!(data && data.success && data.online);
  } catch (e) {
    console.warn("[UniversalPrinter] Failed to check print bridge status:", e);
    return false;
  }
}

async function queuePrintJob(
  printerType: number,
  kitchenTypeValue?: string,
  content?: string
): Promise<boolean> {
  console.log("========== QUEUE PRINT ==========");
  console.log("Printer Type:", printerType);
  console.log("Kitchen Type:", kitchenTypeValue);
  try {
    const storeId = "STORE_001";
    const response = await fetch(`${API_URL}/api/print-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer unipro-pos-bridge-token-2026",
        "x-store-id": storeId,
      },
      body: JSON.stringify({
        printerType,
        kitchenTypeValue:
          kitchenTypeValue !== undefined ? String(kitchenTypeValue) : undefined,
        content,
      }),
    });
    const data = await response.json();
    if (data.success !== true || !data.jobId) return false;

    // Poll for bridge completion (up to 8 seconds)
    const jobId = data.jobId;
    const start = Date.now();
    while (Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const statusRes = await fetch(
          `${API_URL}/api/print-jobs/status/${jobId}`
        );
        const statusData = await statusRes.json();
        if (statusData.success && statusData.status === "COMPLETED") {
          console.log(`✅ [UniversalPrinter] Print job ${jobId} completed`);
          return true;
        }
        if (statusData.success && statusData.status === "FAILED") {
          console.warn(
            `❌ [UniversalPrinter] Print job ${jobId} failed:`,
            statusData.error
          );
          return false;
        }
      } catch (err) {
        console.error("[UniversalPrinter] Status poll error:", err);
      }
    }
    console.warn(`[UniversalPrinter] Print job ${jobId} timed out`);
    return false;
  } catch (e) {
    console.warn("[UniversalPrinter] Failed to queue print job:", e);
    return false;
  }
}

// ─────────────────────────────────────────────
// KOT log helper
// ─────────────────────────────────────────────
async function logPrintJob(orderId?: string | null, orderNo?: string | null, type?: string) {
  try {
    await fetch(`${API_URL}/api/order/log-print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: orderId && orderId.length > 30 ? orderId : null,
        orderNumber: orderNo,
        printType: 1,
        isEdit: type === "ADDITIONAL",
        isReprint: type === "REPRINT",
        isHold: false,
      }),
    });
    console.log("📝 Print job logged to PrintReport");
  } catch (logErr) {
    console.warn("Failed to log print to DB:", logErr);
  }
}

// ─────────────────────────────────────────────
// KOT HTML Generator
// ─────────────────────────────────────────────
function generateKOTHTML(data: any, type: string) {
  let title =
    type === "KDS_PRINT"
      ? "KDS PRINT"
      : type === "REPRINT"
        ? "REPRINT"
        : type === "ADDITIONAL"
          ? "ADDITIONAL"
          : (data.kitchenName || data.kitchenTypeName || data.KitchenTypeName || "NEW ORDER");
  title = title.replace(/\s*KOT\s*/gi, "").trim();

  const items = data.items || [];
  const tableNo = data.tableNo || "N/A";
  const orderNo = data.orderNo || data.orderId || "N/A";
  const waiter = data.waiterName || "Staff";
  const kotDateStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  const kotTimeStr = formatToSingaporeTime(new Date(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timestamp = `${kotDateStr} ${kotTimeStr}`;
  const kitchenName = data.kitchenName || "";

  const renderItem = (item: any) => {
    const noteText =
      item.note || item.notes || item.Remarks || item.remarks || "";
    const comboSels = (() => {
      if (item.comboSelections) return item.comboSelections;
      if (typeof item.ComboDetailsJSON === "string" && item.ComboDetailsJSON) {
        try {
          const p = JSON.parse(item.ComboDetailsJSON);
          return Array.isArray(p) ? p : p.groups;
        } catch {
          return [];
        }
      }
      if (Array.isArray(item.ComboDetailsJSON)) return item.ComboDetailsJSON;
      return [];
    })();
    const hasCombo = Array.isArray(comboSels) && comboSels.length > 0;
    const isTakeaway = !!(
      item.isTakeaway ||
      item.IsTakeaway ||
      item.isTakeAway ||
      item.IsTakeAway
    );

    return `
      <div class="item-row">
        <div class="item-main">
          <div class="item-qty">${item.quantity || item.qty || 1}</div>
          <div class="item-name">
            ${item.name || item.Name || item.DishName || item.ProductName || "Item"}
            ${item.songName || item.SongName
        ? `<div style="font-size:20px;font-weight:normal;color:#555;margin-top:4px;">🎵 ${item.songName || item.SongName
        }</div>`
        : ""
      }
          </div>
        </div>
        ${isTakeaway
        ? `<div class="modifier-list"><span class="modifier-item" style="font-weight:bold;">- Takeaway</span></div>`
        : ""
      }
        ${item.modifiers && item.modifiers.length > 0
        ? `<div class="modifier-list">${item.modifiers
          .map(
            (m: any) =>
              `<span class="modifier-item">- ${m.name || m.ModifierName
              }</span>`
          )
          .join("")}</div>`
        : ""
      }
        ${hasCombo
        ? `<div class="modifier-list">${comboSels
          .map(
            (g: any) => `
                  <div style="font-weight:bold;margin-top:2px;">${g.groupName}:</div>
                  ${g.items
                ? g.items
                  .map(
                    (opt: any) =>
                      `<span class="modifier-item" style="padding-left:10px;">↳ ${opt.name}</span>`
                  )
                  .join("")
                : ""
              }
                `
          )
          .join("")}</div>`
        : ""
      }
        ${noteText ? `<div class="remarks">* NOTE: ${noteText}</div>` : ""}
      </div>`;
  };

  let itemListHTML = "";
  if (type === "KDS_PRINT") {
    const kitchenGroups: Record<string, any[]> = {};
    items.forEach((item: any) => {
      const kName = (
        item.PrinterName ||
        item.KitchenTypeName ||
        item.kitchenTypeName ||
        item.dishGroupName ||
        item.categoryName ||
        "KITCHEN"
      )
        .toUpperCase()
        .trim();
      if (!kitchenGroups[kName]) kitchenGroups[kName] = [];
      kitchenGroups[kName].push(item);
    });
    itemListHTML = Object.entries(kitchenGroups)
      .map(
        ([kName, groupItems]) => `
        <div style="font-size:18px;font-weight:bold;margin-top:15px;border-bottom:2px solid #000;padding-bottom:3px;text-transform:uppercase;">
          <b>${kName}</b>
        </div>
        ${groupItems.map(renderItem).join("")}`
      )
      .join("");
  } else {
    itemListHTML = items.map(renderItem).join("");
  }

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: 80mm auto; margin: 0; }
    body { font-family: 'Arial', sans-serif; width: 80mm; padding: 0; margin: 0; color: #000; background: #fff; }
    .kot-container { padding: 1mm 2mm; width: 76mm; }
    .header-box { background: #000 !important; color: #fff !important; padding: 3px 8px; text-align: left; font-weight: bold; font-size: 24px; display: inline-block; margin-bottom: 2px; text-transform: uppercase; -webkit-print-color-adjust: exact; }
    .timestamp { font-size: 14px; font-weight: bold; margin-bottom: 8px; color: #333; }
    .table-info { display: flex; justify-content: space-between; border-bottom: 2px dashed #000; padding: 3px 0; margin-bottom: 6px; font-size: 26px; font-weight: bold; }
    .headers { display: flex; border-bottom: 1.5px dashed #000; padding: 3px 0; font-size: 16px; font-weight: bold; text-transform: uppercase; }
    .qty-head { width: 50px; margin-right: 8px; }
    .item-row { border-bottom: 1.5px solid #000; padding: 8px 0; }
    .item-main { display: flex; align-items: flex-start; }
    .item-qty { font-size: 24px; font-weight: 900; width: 50px; line-height: 1; margin-right: 8px; }
    .item-name { font-size: 22px; font-weight: 900; flex: 1; line-height: 1.1; }
    .modifier-list { margin-left: 58px; margin-top: 3px; }
    .modifier-item { font-size: 22px; font-weight: 700; color: #000; display: block; }
    .remarks { margin-left: 58px; font-size: 15px; font-weight: 700; font-style: italic; margin-top: 4px; }
    .footer { margin-top: 10px; font-size: 14px; font-weight: bold; font-family: monospace; }
    .kitchen-name { text-align: center; font-size: 24px; font-weight: bold; margin-top: 16px; text-transform: uppercase; border: 2px solid #000; padding: 6px; }
    @media print { body { width: 80mm; } .header-box { -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="kot-container">
    <div class="header-box">${title}</div>
    <div class="timestamp">${timestamp}</div>
    <div class="table-info"><span>Takeaway: ${tableNo}</span></div>
    <div class="headers"><div class="qty-head">Qty</div><div>Item</div></div>
    <div class="item-list">${itemListHTML}</div>
    <div class="footer">
      <div>Order By : ${waiter}</div>
      <div style="margin-top:6px;">Order #: <span style="font-size:32px; font-weight:900; line-height:1;">${orderNo}</span></div>
    </div>
    ${kitchenName && kitchenName !== "KDS"
      ? `<div class="kitchen-name">${kitchenName}</div>`
      : ""
    }
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// KOT Thermal text (for Print Bridge)
// ─────────────────────────────────────────────
function formatKOTThermalText(data: any, type: string = "NEW") {
  const title =
    type === "KDS_PRINT"
      ? "KDS PRINT"
      : type === "REPRINT"
        ? "REPRINT"
        : type === "ADDITIONAL"
          ? "ADDITIONAL"
          : (data.kitchenName || data.kitchenTypeName || data.KitchenTypeName || "NEW ORDER");
  const items = data.items || [];
  const tableNo = data.tableNo || "N/A";
  const waiter = data.waiterName || "Staff";
  const orderNo = data.orderNo || data.orderId || "";
  const kitchenName = data.kitchenName || "";

  const kotDateStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date());
  const kotTimeStr = formatToSingaporeTime(new Date(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let text = `[C]<B>${title}</B>\n`;
  text += `[C]${kotDateStr} ${kotTimeStr}\n`;
  text += "[L]--------------------------------\n";
  text += `[C]<font size='big'>Takeaway: ${tableNo}</font>\n`;
  text += "[L]--------------------------------\n";
  text += "[L]QTY  ITEM\n";
  text += "[L]--------------------------------\n";

  const renderThermalItem = (item: any) => {
    const qtyNum = item.quantity || item.qty || 1;
    const itemName = item.name || item.Name || item.DishName || item.ProductName || "";
    let t = `[L]<font size='big'>[${qtyNum}] ${itemName}</font>\n`;

    const songName = item.songName || item.SongName || "";
    if (songName) t += `[L]    🎵 ${songName}\n`;

    const isTw = !!(
      item.isTakeaway ||
      item.IsTakeaway ||
      item.isTakeAway ||
      item.IsTakeAway
    );
    if (isTw) t += `[L]    - Takeaway\n`;

    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach((m: any) => {
        t += `[L]    + ${m.ModifierName || m.name}\n`;
      });
    }

    if (item.comboSelections && item.comboSelections.length > 0) {
      item.comboSelections.forEach((g: any) => {
        t += `[L]    ${g.groupName}:\n`;
        g.items?.forEach((opt: any) => {
          t += `[L]      ↳ ${opt.name}\n`;
        });
      });
    }

    const noteText = item.note || item.notes || item.Remarks || item.remarks;
    if (noteText) t += `[L]    * NOTE: ${noteText}\n`;

    return t;
  };

  if (type === "KDS_PRINT") {
    const kitchenGroups: Record<string, any[]> = {};
    items.forEach((item: any) => {
      const kName = (
        item.PrinterName ||
        item.KitchenTypeName ||
        item.kitchenTypeName ||
        item.dishGroupName ||
        item.categoryName ||
        "KITCHEN"
      )
        .toUpperCase()
        .trim();
      if (!kitchenGroups[kName]) kitchenGroups[kName] = [];
      kitchenGroups[kName].push(item);
    });
    for (const [kName, groupItems] of Object.entries(kitchenGroups)) {
      text += `\n[L]<B>${kName}</B>\n`;
      text += "[L]--------------------------------\n";
      for (const item of groupItems) {
        text += renderThermalItem(item);
      }
      text += "[L]--------------------------------\n";
    }
  } else {
    for (const item of items) {
      text += renderThermalItem(item);
      text += "[L]--------------------------------\n";
    }
  }

  text += `[L]Order By: ${waiter}\n`;
  text += `[L]Order #: <font size='big'><B>${orderNo}</B></font>\n`;

  if (kitchenName && kitchenName !== "KDS") {
    text += "[L]--------------------------------\n";
    text += `[C]<font size='big'><B>${kitchenName.toUpperCase()}</B></font>\n`;
  }

  text += "\n\n";
  return text;
}

// ─────────────────────────────────────────────
// Receipt thermal text with discount
// ─────────────────────────────────────────────
function formatThermalTextWithDiscount(saleData: any, company: any, discountInfo?: any) {
  const symbol = company.currencySymbol || "$";
  const name = company.name || "POS SYSTEM";
  const address = company.address || "";
  const gstNo = company.gstNo || "";
  const tel = company.phone || company.tel || "";

  const now = new Date();
  const dateStr = formatToSingaporeDate(now);
  const timeStr = formatToSingaporeTime(now);

  let text = `[C]<B>${name}</B>\n`;
  if (address) text += `[C]${address}\n`;
  if (gstNo) text += `[C]GST: ${gstNo}\n`;
  if (tel) text += `[C]Tel: ${tel}\n`;
  text += `[C]${dateStr} ${timeStr}\n`;
  text += "[L]================================\n";

  const tableNo = saleData.tableNo || "";
  const orderNo = saleData.orderNo || saleData.id || saleData.saleId || "";
  if (tableNo) text += `[L]Takeaway: ${tableNo}\n`;
  if (orderNo) text += `[L]Order #: ${orderNo}\n`;
  text += "[L]================================\n";
  text += "[L]Item                   Qty  Total\n";
  text += "[L]--------------------------------\n";

  const items = saleData.items || saleData.cartItems || [];
  items.forEach((item: any) => {
    const itemName = (item.name || item.Name || item.DishName || item.ProductName || "Item").substring(0, 18);
    const qty = item.quantity || item.qty || 1;
    const price = (Number(item.price || item.Price || 0)) * qty;
    const line = `${itemName.padEnd(20)} ${String(qty).padStart(3)}  ${symbol}${price.toFixed(2)}`;
    text += `[L]${line}\n`;

    if (item.modifiers && item.modifiers.length > 0) {
      item.modifiers.forEach((m: any) => {
        text += `[L]  + ${m.name || m.ModifierName}\n`;
      });
    }
  });

  text += "[L]================================\n";

  const subtotal =
    saleData.subtotal ||
    items.reduce((s: number, i: any) => s + (Number(i.price || i.Price || 0)) * (i.quantity || i.qty || 1), 0);
  text += `[R]Subtotal: ${symbol}${Number(subtotal).toFixed(2)}\n`;

  // Discount
  if (discountInfo && discountInfo.applied && discountInfo.amount > 0) {
    const discLabel =
      discountInfo.type === "percentage"
        ? `Discount (${discountInfo.value}%):`
        : "Discount:";
    text += `[R]${discLabel} -${symbol}${Number(discountInfo.amount).toFixed(2)}\n`;
  }

  const serviceCharge = saleData.serviceCharge || saleData.serviceChargeAmount || 0;
  if (serviceCharge > 0) {
    text += `[R]Service Charge: ${symbol}${Number(serviceCharge).toFixed(2)}\n`;
  }

  const gst = saleData.gst || saleData.gstAmount || 0;
  if (gst > 0) {
    text += `[R]GST: ${symbol}${Number(gst).toFixed(2)}\n`;
  }

  const total = saleData.total || saleData.totalAmount || saleData.grandTotal || 0;
  text += "[L]================================\n";
  text += `[R]<B>TOTAL: ${symbol}${Number(total).toFixed(2)}</B>\n`;
  text += "[L]================================\n";

  const payMode =
    saleData.paymentMode ||
    saleData.payMode ||
    saleData.PaymentMode ||
    "CASH";
  const paid = saleData.amountPaid || saleData.paidAmount || total;
  const change = saleData.change || saleData.changeAmount || Math.max(0, paid - total);

  text += `[L]Payment: ${payMode}\n`;
  text += `[L]Paid: ${symbol}${Number(paid).toFixed(2)}\n`;
  if (change > 0) text += `[L]Change: ${symbol}${Number(change).toFixed(2)}\n`;

  text += "[L]================================\n";
  text += "[C]Thank you for your visit!\n";
  text += `[C]© ${new Date().getFullYear()} UNIPRO SOFTWARES SG PTE LTD\n`;
  text += "\n\n";
  return text;
}

// ─────────────────────────────────────────────
// Receipt HTML (for iframe / fallback)
// ─────────────────────────────────────────────
function generateReceiptHTML(saleData: any, company: any, discountInfo?: any) {
  const symbol = company.currencySymbol || "$";
  const items = saleData.items || saleData.cartItems || [];
  const subtotal =
    saleData.subtotal ||
    items.reduce((s: number, i: any) => s + (Number(i.price || i.Price || 0)) * (i.quantity || i.qty || 1), 0);
  const serviceCharge = saleData.serviceCharge || saleData.serviceChargeAmount || 0;
  const gst = saleData.gst || saleData.gstAmount || 0;
  const total = saleData.total || saleData.totalAmount || saleData.grandTotal || 0;
  const payMode = saleData.paymentMode || saleData.payMode || "CASH";
  const paid = saleData.amountPaid || saleData.paidAmount || total;
  const change = saleData.change || saleData.changeAmount || Math.max(0, paid - total);
  const tableNo = saleData.tableNo || "";
  const orderNo = saleData.orderNo || saleData.id || saleData.saleId || "";
  const now = new Date();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; width: 80mm; margin: 0; padding: 4mm 3mm; color: #000; background: #fff; font-size: 12px; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: bold; }
    .company-name { font-size: 18px; font-weight: bold; text-align: center; margin-bottom: 2px; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    .divider-solid { border-top: 2px solid #000; margin: 4px 0; }
    .item-row { display: flex; justify-content: space-between; margin: 2px 0; }
    .item-name { flex: 1; }
    .item-qty { width: 30px; text-align: center; }
    .item-total { width: 60px; text-align: right; }
    .summary-row { display: flex; justify-content: space-between; padding: 1px 0; }
    .total-row { display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; padding: 2px 0; }
    .footer { text-align: center; margin-top: 8px; font-size: 10px; color: #555; }
    .modifier { font-size: 11px; padding-left: 12px; color: #444; }
    .discount-row { color: #c00; }
    @media print { body { width: 80mm; } }
  </style>
</head>
<body>
  <div class="company-name">${company.name || "POS SYSTEM"}</div>
  ${company.address ? `<div class="center">${company.address}</div>` : ""}
  ${company.gstNo ? `<div class="center">GST: ${company.gstNo}</div>` : ""}
  ${company.phone ? `<div class="center">Tel: ${company.phone}</div>` : ""}
  <div class="center">${formatToSingaporeDate(now)} ${formatToSingaporeTime(now)}</div>
  <div class="divider-solid"></div>
  ${tableNo ? `<div>Takeaway: <b>${tableNo}</b></div>` : ""}
  ${orderNo ? `<div>Order #: <b>${orderNo}</b></div>` : ""}
  <div class="divider"></div>

  <div class="item-row bold">
    <span class="item-name">Item</span>
    <span class="item-qty">Qty</span>
    <span class="item-total">Total</span>
  </div>
  <div class="divider"></div>

  ${items
      .map(
        (item: any) => `
    <div class="item-row">
      <span class="item-name">${item.name || item.Name || item.DishName || item.ProductName || "Item"}</span>
      <span class="item-qty">${item.quantity || item.qty || 1}</span>
      <span class="item-total">${symbol}${(
            (Number(item.price || item.Price || 0)) * (item.quantity || item.qty || 1)
          ).toFixed(2)}</span>
    </div>
    ${item.modifiers && item.modifiers.length > 0
            ? item.modifiers
              .map(
                (m: any) =>
                  `<div class="modifier">+ ${m.name || m.ModifierName}</div>`
              )
              .join("")
            : ""
          }`
      )
      .join("")}

  <div class="divider"></div>

  <div class="summary-row"><span>Subtotal</span><span>${symbol}${Number(subtotal).toFixed(2)}</span></div>
  ${discountInfo && discountInfo.applied && discountInfo.amount > 0
      ? `<div class="summary-row discount-row">
          <span>Discount${discountInfo.type === "percentage" ? ` (${discountInfo.value}%)` : ""}</span>
          <span>-${symbol}${Number(discountInfo.amount).toFixed(2)}</span>
        </div>`
      : ""
    }
  ${serviceCharge > 0 ? `<div class="summary-row"><span>Service Charge</span><span>${symbol}${Number(serviceCharge).toFixed(2)}</span></div>` : ""}
  ${gst > 0 ? `<div class="summary-row"><span>GST</span><span>${symbol}${Number(gst).toFixed(2)}</span></div>` : ""}

  <div class="divider-solid"></div>
  <div class="total-row"><span>TOTAL</span><span>${symbol}${Number(total).toFixed(2)}</span></div>
  <div class="divider-solid"></div>

  <div class="summary-row"><span>Payment</span><span>${payMode}</span></div>
  <div class="summary-row"><span>Paid</span><span>${symbol}${Number(paid).toFixed(2)}</span></div>
  ${change > 0 ? `<div class="summary-row"><span>Change</span><span>${symbol}${Number(change).toFixed(2)}</span></div>` : ""}

  <div class="footer">
    <div>Thank you for your visit!</div>
    <div>© ${new Date().getFullYear()} UNIPRO SOFTWARES SG PTE LTD</div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// Sales Report HTML
// ─────────────────────────────────────────────
function generateSalesReportHTML(data: any, company: any) {
  const symbol = company.currencySymbol || "$";
  return `<!DOCTYPE html><html><head><style>
    body { font-family: monospace; padding: 20px; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
    .company-name { font-size: 24px; font-weight: bold; }
    .report-title { font-size: 20px; font-weight: bold; margin: 15px 0; text-align: center; }
    .section-title { font-size: 16px; font-weight: bold; margin: 15px 0 10px; background: #f0f0f0; padding: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    .amount { text-align: right; }
    .summary-box { display: inline-block; width: 30%; padding: 10px; margin: 5px; background: #f9f9f9; text-align: center; border-radius: 5px; }
    .footer { margin-top: 30px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
  </style></head><body>
    <div class="header">
      <div class="company-name">${company.name || "POS SYSTEM"}</div>
      <div>${company.address || ""}</div>
      <div>GST: ${company.gstNo || "N/A"}</div>
      <div class="report-title">SALES REPORT</div>
      <div>Period: ${data.period || "Today"}</div>
    </div>
    <div style="text-align:center">
      <div class="summary-box"><div>Total Sales</div><div style="font-size:24px">${data.summary?.totalSales || 0}</div></div>
      <div class="summary-box"><div>Total Items</div><div style="font-size:24px">${data.summary?.totalItems || 0}</div></div>
      <div class="summary-box"><div>Total Revenue</div><div style="font-size:24px">${symbol}${(data.summary?.totalRevenue || 0).toFixed(2)}</div></div>
    </div>
    <div class="section-title">💳 PAYMENT BREAKDOWN</div>
    ${generateTableFromObject(data.paymentBreakdown || {}, symbol)}
    ${data.items && data.items.length > 0 ? `<div class="section-title">📋 ITEM WISE SALES</div>${generateItemsTable(data.items, symbol)}` : ""}
    <div class="footer"><p>© ${new Date().getFullYear()} UNIPRO SOFTWARES SG PTE LTD</p></div>
  </body></html>`;
}

// ─────────────────────────────────────────────
// Category report HTML generators
// ─────────────────────────────────────────────
function generateCategoryDetailHTML(
  categoryName: string,
  items: any[],
  transactions: any[],
  company: any,
  options?: any
) {
  const symbol = company.currencySymbol || "$";
  const groupTransactions = (tx: any[]) => {
    const grouped: Record<string, any> = {};
    tx.forEach((t) => {
      if (!grouped[t.saleId])
        grouped[t.saleId] = { id: t.saleId, date: t.saleDate, items: [], total: 0 };
      grouped[t.saleId].items.push({ name: t.name, quantity: t.quantity, price: t.price });
      grouped[t.saleId].total += t.price * t.quantity;
    });
    return Object.values(grouped).sort(
      (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  };

  return `<!DOCTYPE html><html><head><style>
    body { font-family: Arial; padding: 20px; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; border-bottom: 2px solid #000; margin-bottom: 20px; }
    .category-title { font-size: 22px; font-weight: bold; text-align: center; margin: 20px 0; }
    .section-title { font-size: 18px; font-weight: bold; margin: 20px 0 10px; background: #f0f0f0; padding: 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
    .amount { text-align: right; }
    .transaction-card { border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin-bottom: 15px; }
    .footer { margin-top: 30px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
  </style></head><body>
    <div class="header">
      <div>${company.name || "Store"}</div>
      <div>${company.address || ""}</div>
      <div>GST: ${company.gstNo || "N/A"}</div>
    </div>
    <div class="category-title">📦 ${categoryName}</div>
    <div style="display:flex;justify-content:space-around;margin:20px 0;padding:15px;background:#f9f9f9;border-radius:5px">
      <div><div>Total Items</div><div style="font-size:18px;font-weight:bold">${items.length}</div></div>
      <div><div>Quantity Sold</div><div style="font-size:18px;font-weight:bold">${items.reduce((s, i) => s + (i.quantity || 0), 0)}</div></div>
      <div><div>Total Revenue</div><div style="font-size:18px;font-weight:bold">${symbol}${items.reduce((s, i) => s + (i.revenue || 0), 0).toFixed(2)}</div></div>
    </div>
    <div class="section-title">📋 Items Sold</div>${generateItemsTable(items, symbol)}
    <div class="section-title">📄 Transaction History</div>
    ${transactions.length
      ? groupTransactions(transactions)
        .map(
          (sale: any) =>
            `<div class="transaction-card">
                  <div><strong>#${sale.id}</strong> - ${symbol}${sale.total.toFixed(2)}</div>
                  <div>${formatToSingaporeDateTime(sale.date)}</div>
                  ${sale.items.map((item: any) => `<div>• ${item.name || item.Name || item.DishName || "Item"} x${item.quantity} - ${symbol}${(item.price * item.quantity).toFixed(2)}</div>`).join("")}
                </div>`
        )
        .join("")
      : "<p>No transactions</p>"
    }
    <div class="footer"><p>End of Report</p></div>
  </body></html>`;
}

function generateAllCategoriesHTML(categories: any[], company: any, options?: any) {
  const symbol = company.currencySymbol || "$";
  const summary = options?.summary || { totalSales: 0, totalItems: 0, totalRevenue: 0, paymentBreakdown: {} };
  return `<!DOCTYPE html><html><head><style>
    body { font-family: Arial; padding: 20px; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; border-bottom: 2px solid #000; margin-bottom: 20px; }
    .summary-section { display: flex; justify-content: space-between; margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
    .category-card { margin-bottom: 20px; border: 1px solid #ddd; border-radius: 5px; padding: 15px; }
    .category-name { font-size: 18px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
    .amount { text-align: right; }
    .footer { margin-top: 30px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
  </style></head><body>
    <div class="header">
      <div>${company.name || "Store"}</div>
      <div>${company.address || ""}</div>
      <div>GST: ${company.gstNo || "N/A"}</div>
      <div style="font-size:20px;font-weight:bold;margin:10px 0">📊 CATEGORY WISE SALES</div>
    </div>
    <div class="summary-section">
      <div><div>Total Sales</div><div>${summary.totalSales}</div></div>
      <div><div>Total Items</div><div>${summary.totalItems}</div></div>
      <div><div>Total Revenue</div><div>${symbol}${Number(summary.totalRevenue).toFixed(2)}</div></div>
    </div>
    <div><h3>💳 PAYMENT BREAKDOWN</h3>
      ${Object.entries(summary.paymentBreakdown || {})
      .map(([m, a]) => `<div>${m}: ${symbol}${Number(a).toFixed(2)}</div>`)
      .join("")}
    </div>
    ${categories
      .map(
        (cat) =>
          `<div class="category-card">
            <div class="category-name">${cat.name}</div>
            <div>Revenue: ${symbol}${(cat.totalRevenue || 0).toFixed(2)} | Items: ${cat.totalQuantity || 0}</div>
            ${generateItemsTable(cat.items || [], symbol)}
          </div>`
      )
      .join("")}
    <div class="footer"><p>© ${new Date().getFullYear()} UNIPRO SOFTWARES SG PTE LTD</p></div>
  </body></html>`;
}

// ─────────────────────────────────────────────
// offerPDFFallback — iframe receipt / Native BillPDFGenerator preview
// ─────────────────────────────────────────────
async function offerPDFFallback(
  saleData: any,
  outletId?: string,
  t?: any,
  discountInfo?: any
): Promise<boolean> {
  try {
    if (typeof document !== "undefined") {
      const company = await BillPDFGenerator.loadSettings(outletId);
      const html = generateReceiptHTML(saleData, company, discountInfo);
      printHtmlInIframe("receipt-print-iframe", html, 400);
      return true;
    }
    return await BillPDFGenerator.printReceipt(saleData, outletId);
  } catch (e) {
    console.error("[UniversalPrinter] offerPDFFallback failed:", e);
    return false;
  }
}

// ─────────────────────────────────────────────
// ✅ UniversalPrinter — main export
// ─────────────────────────────────────────────
export const UniversalPrinter = {
  // ── Sales Report ────────────────────────────
  async printSalesReport(reportData: any, userId?: string, t?: any): Promise<boolean> {
    try {
      const company = await BillPDFGenerator.loadSettings(userId);
      const html = generateSalesReportHTML(reportData, company);
      if (typeof document !== "undefined") {
        printHtmlInIframe("sales-report-iframe", html, 400);
        return true;
      }
      return await BillPDFGenerator.printReceipt({ html }, userId);
    } catch (error) {
      console.error("Sales report error:", error);
      return false;
    }
  },

  // ── Category Report ──────────────────────────
  async printCategoryReport(
    categories: any[],
    selectedCategory?: string,
    categoryItems?: any[],
    categoryTransactions?: any[],
    userId?: string,
    t?: any,
    options?: any
  ): Promise<boolean> {
    try {
      const company = await BillPDFGenerator.loadSettings(userId);
      const html = selectedCategory
        ? generateCategoryDetailHTML(
          selectedCategory,
          categoryItems || [],
          categoryTransactions || [],
          company,
          options
        )
        : generateAllCategoriesHTML(categories, company, options);

      if (typeof document !== "undefined") {
        printHtmlInIframe("category-report-iframe", html, 400);
        return true;
      }
      return await BillPDFGenerator.printReceipt({ html }, userId);
    } catch (error) {
      console.error("Category report error:", error);
      return false;
    }
  },

  // ── KDS Order Print ──────────────────────────
  async printKDSOrder(orderData: any, userId?: string, kdsPrinterIp?: string): Promise<boolean> {
    try {
      const isOnline = await isBridgeOnline();
      if (!isOnline) {
        console.log("📡 [Web] Bridge OFFLINE — iframe / native fallback");
        if (typeof document !== "undefined") {
          printHtmlInIframe("kot-print-iframe", generateKOTHTML(orderData, "KDS_PRINT"), 50);
        } else {
          await BillPDFGenerator.printReceipt(orderData, userId);
        }
        await logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
        return true;
      }

      const text = formatKOTThermalText(orderData, "KDS_PRINT");
      const success = await queuePrintJob(4, undefined, text);
      if (success) {
        await logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
        return true;
      }

      // Fallback
      if (typeof document !== "undefined") {
        printHtmlInIframe("kot-print-iframe", generateKOTHTML(orderData, "KDS_PRINT"), 800);
      } else {
        await BillPDFGenerator.printReceipt(orderData, userId);
      }
      await logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
      return true;
    } catch (err) {
      console.warn("[UniversalPrinter] KDS print error, fallback:", err);
      if (typeof document !== "undefined") {
        printHtmlInIframe("kot-print-iframe", generateKOTHTML(orderData, "KDS_PRINT"), 800);
      } else {
        await BillPDFGenerator.printReceipt(orderData, userId);
      }
      await logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
      return true;
    }
  },

  // ── KOT Print ───────────────────────────────
  async printKOT(
    orderData: any,
    userId?: string,
    type: string = "NEW",
    printerIpOverride?: string
  ): Promise<boolean> {
    console.log("========== KOT PRINT START ==========");
    console.log("Order Data:", orderData);
    console.log("Items:", orderData?.items);

    try {
      console.log("Checking Bridge Status...");
      const isOnline = await isBridgeOnline();
      console.log("Bridge Online:", isOnline);

      if (!isOnline) {
        console.log("📡 Bridge OFFLINE - fallback");
        if (typeof document !== "undefined") {
          printHtmlInIframe(
            "kot-print-iframe",
            generateKOTHTML(orderData, type),
            50
          );
        } else {
          await BillPDFGenerator.printReceipt(orderData, userId);
        }
        await logPrintJob(orderData?.orderId, orderData?.orderNo, type);
        return true;
      }

      console.log("Generating Thermal Text...");
      const text = formatKOTThermalText(orderData, type);
      console.log(text);

      const kitchenTypeValue =
        orderData?.kitchenCode ||
        orderData?.KitchenCode ||
        orderData?.kitchenTypeValue ||
        orderData?.KitchenTypeValue ||
        "0";

      console.log("Kitchen Type:", kitchenTypeValue);
      console.log("Sending Print Job...");

      const success = await queuePrintJob(2, kitchenTypeValue, text);
      console.log("Queue Result:", success);

      if (success) {
        console.log("✅ Print Success");
        await logPrintJob(orderData?.orderId, orderData?.orderNo, type);
        return true;
      }

      console.warn("⚠️ Queue Failed - fallback");
      if (typeof document !== "undefined") {
        printHtmlInIframe(
          "kot-print-iframe",
          generateKOTHTML(orderData, type),
          800
        );
      } else {
        await BillPDFGenerator.printReceipt(orderData, userId);
      }
      await logPrintJob(orderData?.orderId, orderData?.orderNo, type);
      return true;
    } catch (err) {
      console.error("PRINT ERROR:", err);
      if (typeof document !== "undefined") {
        printHtmlInIframe(
          "kot-print-iframe",
          generateKOTHTML(orderData, type),
          800
        );
      } else {
        await BillPDFGenerator.printReceipt(orderData, userId);
      }
      await logPrintJob(orderData?.orderId, orderData?.orderNo, type);
      return true;
    }
  },

  // ── Smart Print (Receipt with Discount) ──────
  async smartPrint(
    saleData: any,
    outletId?: string,
    t?: any,
    discountInfo?: any,
    preferredType?: any,
    isReprint: boolean = false
  ): Promise<boolean> {
    try {
      const isOnline = await isBridgeOnline();
      if (!isOnline) {
        console.log("📡 [Web] Bridge OFFLINE — PDF fallback");
        return await offerPDFFallback(saleData, outletId, t, discountInfo);
      }

      const company = await BillPDFGenerator.loadSettings(outletId);
      const text = formatThermalTextWithDiscount(saleData, company, discountInfo);

      const tableNo = saleData.tableNo || "";
      const isTakeaway =
        !tableNo ||
        String(tableNo).trim() === "" ||
        String(tableNo).toUpperCase().startsWith("TW") ||
        String(tableNo).toUpperCase() === "TAKEAWAY" ||
        String(tableNo).toUpperCase() === "TAKE AWAY";

      const pType = isTakeaway ? 3 : 1;
      console.log(`📡 [Web] Queueing receipt to printer type: ${pType}`);
      const success = await queuePrintJob(pType, undefined, text);
      if (success) return true;

      // Fallback
      console.warn("⚠️ [Web Receipt] Bridge queue failed — PDF fallback");
      return await offerPDFFallback(saleData, outletId, t, discountInfo);
    } catch (err) {
      console.warn("[UniversalPrinter] smartPrint error, PDF fallback:", err);
      return await offerPDFFallback(saleData, outletId, t, discountInfo);
    }
  },

  // ── Share PDF (Native Expo Sharing support) ──
  async sharePDF(saleData: any, outletId?: string): Promise<boolean> {
    return await BillPDFGenerator.shareReceiptPDF(saleData, outletId);
  },

  // ── Cash Drawer ──────────────────────────────
  async openCashDrawer(printerIpOverride?: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_URL}/api/cash-drawer/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: printerIpOverride }),
      });
      const data = await res.json();
      return !!(data && data.success);
    } catch (e) {
      console.warn("[UniversalPrinter] Cash drawer open failed:", e);
      return false;
    }
  },
};

export default UniversalPrinter;
