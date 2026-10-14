import { API_URL } from "@/config";
import BillPDFGenerator from "./BillPDFGenerator";
import {
  formatToSingaporeDate,
  formatToSingaporeTime,
} from "../utils/timezoneHelper";

// Check if bridge server is available
async function isBridgeOnline(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/print-jobs/bridge-status`);
    const data = await response.json();
    return !!(data && data.success && data.online);
  } catch (e) {
    return false;
  }
}

// Queue print job to bridge
async function queuePrintJob(
  printerType: number,
  kitchenTypeValue?: string,
  content?: string
): Promise<boolean> {
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
        kitchenTypeValue,
        content,
      }),
    });
    const data = await response.json();
    if (data.success !== true || !data.jobId) return false;

    // Poll for bridge completion (up to 8 seconds)
    const jobId = data.jobId;
    const start = Date.now();
    while (Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const statusRes = await fetch(
          `${API_URL}/api/print-jobs/status/${jobId}`
        );
        const statusData = await statusRes.json();
        if (statusData.success && statusData.status === "COMPLETED") {
          return true;
        }
        if (statusData.success && statusData.status === "FAILED") {
          return false;
        }
      } catch (err) {
        // continue polling
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

function formatKOTThermalText(data: any, type: string = "NEW"): string {
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
  const waiter = data.waiterName || "Kiosk";
  const orderNo = data.orderNo || data.orderId || "";

  const kotDateStr = formatToSingaporeDate(new Date());
  const kotTimeStr = formatToSingaporeTime(new Date(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  let text = `[C]<B>${title}</B>\n`;
  text += `[C]${kotDateStr} ${kotTimeStr}\n`;
  text += "[L]--------------------------------\n";
  text += `[C]<font size='big'>Takeaway / Bay: ${tableNo}</font>\n`;
  text += "[L]--------------------------------\n";
  text += "[L]QTY  ITEM\n";
  text += "[L]--------------------------------\n";

  for (const item of items) {
    const qtyNum = item.quantity || item.qty || 1;
    const itemName = item.name || item.Name || item.DishName || "Item";
    text += `[L]<font size='big'>[${qtyNum}] ${itemName}</font>\n`;

    if (item.modifiers && Array.isArray(item.modifiers)) {
      item.modifiers.forEach((m: any) => {
        text += `[L]    + ${m.ModifierName || m.name}\n`;
      });
    }

    const noteText = item.note || item.notes || item.Remarks || item.remarks;
    if (noteText) text += `[L]    * NOTE: ${noteText}\n`;
    text += "[L]--------------------------------\n";
  }

  text += `[L]Order By: ${waiter}\n`;
  text += `[L]Order #: <font size='big'><B>${orderNo}</B></font>\n\n\n`;
  return text;
}

function formatThermalReceiptText(saleData: any, company: any): string {
  const symbol = company.currencySymbol || "$";
  const name = company.name || "ISLAND CAR WASH & CAFE";
  const address = company.address || "";
  const gstNo = company.gstNo || "";
  const tel = company.phone || "";

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
  const orderNo = saleData.orderNo || saleData.id || saleData.orderId || "";
  if (tableNo) text += `[L]Bay / Table: ${tableNo}\n`;
  if (orderNo) text += `[L]Order #: ${orderNo}\n`;
  text += "[L]================================\n";
  text += "[L]Item                   Qty  Total\n";
  text += "[L]--------------------------------\n";

  const items = saleData.items || saleData.cartItems || [];
  items.forEach((item: any) => {
    const itemName = (item.name || item.Name || item.DishName || "Item").substring(0, 18);
    const qty = item.quantity || item.qty || 1;
    const price = (Number(item.price || item.Price || 0)) * qty;
    text += `[L]${itemName.padEnd(20)} ${String(qty).padStart(3)}  ${symbol}${price.toFixed(2)}\n`;

    if (item.modifiers && Array.isArray(item.modifiers)) {
      item.modifiers.forEach((m: any) => {
        text += `[L]  + ${m.name || m.ModifierName}\n`;
      });
    }
  });

  text += "[L]================================\n";

  const total = Number(saleData.total || saleData.totalAmount || 0);
  text += `[R]<B>TOTAL: ${symbol}${total.toFixed(2)}</B>\n`;
  text += "[L]================================\n";

  const payMode = saleData.paymentMode || saleData.payMode || "CASH";
  text += `[L]Payment: ${payMode}\n`;
  text += "[L]================================\n";
  text += "[C]Thank you for your visit!\n";
  text += `[C]© ${new Date().getFullYear()} ISLAND CAR WASH\n\n\n`;

  return text;
}

export const UniversalPrinter = {
  // ── Print KOT (Kitchen / Bay Order Ticket) ──
  async printKOT(orderData: any, userId?: string, type: string = "NEW"): Promise<boolean> {
    try {
      const isOnline = await isBridgeOnline();
      if (isOnline) {
        const text = formatKOTThermalText(orderData, type);
        const kitchenCode = orderData.kitchenCode || orderData.KitchenCode || "0";
        const queued = await queuePrintJob(2, String(kitchenCode), text);
        if (queued) return true;
      }

      // Native fallback
      return await BillPDFGenerator.printReceipt(orderData, userId);
    } catch (e) {
      console.warn("[UniversalPrinter] KOT print fallback:", e);
      return await BillPDFGenerator.printReceipt(orderData, userId);
    }
  },

  // ── Smart Print Receipt ──
  async smartPrint(saleData: any, outletId?: string): Promise<boolean> {
    try {
      const isOnline = await isBridgeOnline();
      if (isOnline) {
        const company = await BillPDFGenerator.loadSettings(outletId);
        const text = formatThermalReceiptText(saleData, company);
        const queued = await queuePrintJob(1, undefined, text);
        if (queued) return true;
      }

      // Native Expo Print dialog / PDF fallback
      return await BillPDFGenerator.printReceipt(saleData, outletId);
    } catch (e) {
      console.warn("[UniversalPrinter] smartPrint fallback:", e);
      return await BillPDFGenerator.printReceipt(saleData, outletId);
    }
  },

  // ── Share Receipt as PDF Document ──
  async sharePDF(saleData: any, outletId?: string): Promise<boolean> {
    return await BillPDFGenerator.shareReceiptPDF(saleData, outletId);
  },
};

export default UniversalPrinter;
