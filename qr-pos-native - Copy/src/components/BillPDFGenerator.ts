import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { API_BASE, API_URL } from "@/config";
import {
  formatToSingaporeDate,
  formatToSingaporeTime,
  parseDatabaseDate,
} from "../utils/timezoneHelper";

export class BillPDFGenerator {
  static settingsCache: Record<string, { data: any; time: number }> = {};

  static async loadSettings(userId?: string) {
    try {
      if (!userId) return this.getDefaultSettings();

      const targetId = "1";
      const now = Date.now();
      const cached = this.settingsCache[targetId];
      if (cached && now - cached.time < 30000) {
        return cached.data;
      }

      const timestamp = Date.now();
      const response = await fetch(
        `${API_BASE}/company-settings/${targetId}?_t=${timestamp}`
      );
      let responseData = await response.json();

      if (
        targetId !== "1" &&
        (!responseData?.settings?.CompanyName ||
          responseData.settings.CompanyName.trim() === "")
      ) {
        const masterResponse = await fetch(
          `${API_BASE}/company-settings/1?_t=${timestamp}`
        );
        const masterData = await masterResponse.json();
        if (masterData?.success && masterData.settings?.CompanyName) {
          responseData = masterData;
        }
      }

      if (responseData && responseData.success) {
        const settings = responseData.settings;
        const showCompanyLogo =
          settings.ShowCompanyLogo === 1 || settings.ShowCompanyLogo === true;
        const showHalalLogo =
          settings.ShowHalalLogo === 1 || settings.ShowHalalLogo === true;

        const gstPercentage =
          settings.GSTPercentage !== undefined && settings.GSTPercentage !== null
            ? Number(settings.GSTPercentage)
            : 9;

        const formatUrl = (url?: string) => {
          if (!url) return "";
          if (url.startsWith("data:image") || url.startsWith("http")) return url;
          return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
        };

        const result = {
          name: settings.CompanyName || "Red Bay Car Wash & Cafe",
          address: settings.Address || "",
          gstNo: settings.GSTNo || "",
          gstPercentage: gstPercentage,
          serviceChargePercentage:
            parseFloat(settings.ServiceChargePercentage) || 0,
          phone: settings.Phone || "",
          email: settings.Email || "",
          cashierName: settings.CashierName || "",
          currency: settings.Currency || "SGD",
          currencySymbol: settings.CurrencySymbol || "$",
          companyLogo: formatUrl(settings.CompanyLogoUrl),
          halalLogo: formatUrl(settings.HalalLogoUrl),
          printerIp: settings.PrinterIP || "",
          showCompanyLogo: showCompanyLogo === true,
          showHalalLogo: showHalalLogo === true,
        };

        this.settingsCache[targetId] = {
          data: result,
          time: now,
        };

        return result;
      }
      return this.getDefaultSettings();
    } catch (error) {
      console.log("❌ Error loading settings:", error);
      return this.getDefaultSettings();
    }
  }

  static getDefaultSettings() {
    return {
      name: "Red Bay Car Wash & Cafe",
      address: "",
      gstNo: "",
      gstPercentage: 9,
      serviceChargePercentage: 0,
      phone: "",
      email: "",
      cashierName: "Kiosk",
      currency: "SGD",
      currencySymbol: "$",
      companyLogo: "",
      halalLogo: "",
      showCompanyLogo: false,
      showHalalLogo: false,
    };
  }

  static async generateHTML(
    saleData: any,
    userId?: string,
    discountInfo?: any,
    companyOverride?: any
  ): Promise<string> {
    const company = companyOverride || (await this.loadSettings(userId));

    let finalDiscountInfo = discountInfo;
    if (!finalDiscountInfo && saleData.discount) {
      finalDiscountInfo = {
        applied: true,
        type: saleData.discount.type || "percentage",
        value: saleData.discount.value || 0,
        amount: saleData.discount.amount || 0,
      };
    }

    if (
      !finalDiscountInfo &&
      saleData.discountAmount &&
      saleData.discountAmount > 0
    ) {
      finalDiscountInfo = {
        applied: true,
        type: saleData.discountType || "percentage",
        value: saleData.discountValue || 0,
        amount: saleData.discountAmount,
      };
    }

    const saleDate = saleData.originalDate
      ? parseDatabaseDate(saleData.originalDate)
      : saleData.date
        ? parseDatabaseDate(saleData.date)
        : new Date();

    const billNo =
      saleData.invoiceNumber ||
      saleData.orderId ||
      saleData.id ||
      `ORD-${saleDate.getFullYear()}${(saleDate.getMonth() + 1)
        .toString()
        .padStart(2, "0")}${saleDate.getDate().toString().padStart(2, "0")}-${Math.floor(
          1000 + Math.random() * 9000
        )}`;

    const hasGST = company.gstPercentage > 0;
    const gstRate = company.gstPercentage || 9;
    let finalTotal = saleData.total || saleData.totalAmount || 0;
    const currencySymbol = company.currencySymbol || "$";

    let grossTotal = 0;
    let totalItemDiscount = 0;
    (saleData.items || []).forEach((item: any) => {
      if (item.status === "VOIDED") return;
      const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
      const baseTotal = (Number(item.price || item.Price || 0)) * qtyNum;
      let itemDiscount = 0;
      const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
      const discType = item.discountType || "percentage";
      if (discAmt > 0) {
        if (discType === "percentage") {
          itemDiscount = baseTotal * (discAmt / 100);
        } else {
          itemDiscount = discAmt * qtyNum;
        }
      }
      grossTotal += baseTotal;
      totalItemDiscount += itemDiscount;
    });

    const orderDiscount = finalDiscountInfo?.amount || 0;
    const currentSubtotal = grossTotal - totalItemDiscount - orderDiscount;
    const hasOrderDiscount =
      finalDiscountInfo?.applied && finalDiscountInfo.amount > 0;
    const hasAnyDiscount = totalItemDiscount > 0 || hasOrderDiscount;
    const originalSubTotal = grossTotal;

    const activeItems = (saleData.items || []).filter(
      (i: any) => i.status !== "VOIDED" && i.statusCode !== 0
    );
    const allItemsHaveSC =
      activeItems.length > 0 &&
      activeItems.every(
        (item: any) =>
          Number(item.isServiceCharge) === 1 || item.isServiceCharge === true
      );

    const scPercentage = company.serviceChargePercentage || 0;
    let serviceChargeAmount = 0;
    if (saleData.serviceCharge != null) {
      serviceChargeAmount = parseFloat(String(saleData.serviceCharge));
    } else {
      let scEligibleSubtotal = 0;
      (saleData.items || []).forEach((item: any) => {
        if (item.status === "VOIDED") return;
        const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
        const baseTotal = (Number(item.price || item.Price || 0)) * qtyNum;
        const isSC =
          Number(item.isServiceCharge) === 1 || item.isServiceCharge === true;
        if (isSC) {
          scEligibleSubtotal += baseTotal;
        }
      });
      serviceChargeAmount = scEligibleSubtotal * (scPercentage / 100);
    }

    const taxableAmount = currentSubtotal + serviceChargeAmount;
    const hasSC = serviceChargeAmount > 0;
    const gstAmountRaw = hasGST ? taxableAmount * (gstRate / 100) : 0;
    const gstAmount = Math.round(gstAmountRaw * 100) / 100;
    const amountWithoutGST = currentSubtotal;

    const extraChargeAmount = parseFloat(
      saleData.extraCharge || saleData.PaymodeServiceCharge || 0
    );
    finalTotal = taxableAmount + gstAmount + extraChargeAmount;

    const companyLogoUrl = company.companyLogo || "";
    const halalLogoUrl = company.halalLogo || "";
    const showCompanyLogo = company.showCompanyLogo === true && !!companyLogoUrl;
    const showHalalLogo = company.showHalalLogo === true && !!halalLogoUrl;

    const itemsHTML = (saleData.items || [])
      .filter((item: any) => item.status !== "VOIDED")
      .map((item: any) => {
        const qtyNum = item.qty || item.quantity || 1;
        const itemPrice = Number(item.price || item.Price || 0);

        const modifiersHTML =
          item.modifiers && Array.isArray(item.modifiers)
            ? item.modifiers
                .filter((m: any) => {
                  const mAmt =
                    parseFloat(
                      String(m.Amount ?? m.Price ?? m.amount ?? m.price ?? 0)
                    ) || 0;
                  return mAmt > 0;
                })
                .map((m: any) => {
                  const mName = (m.ModifierName || m.name || "").trim();
                  const mAmt =
                    parseFloat(
                      String(m.Amount ?? m.Price ?? m.amount ?? m.price ?? 0)
                    ) || 0;
                  return `<div class="item-modifiers">+ ${mName}: ${currencySymbol}${(
                    mAmt * qtyNum
                  ).toFixed(2)}</div>`;
                })
                .join("")
            : "";

        return `
          <tr>
            <td class="item-name">
              ${item.name || item.Name || item.DishName || "Item"}
              ${modifiersHTML}
            </td>
            <td class="item-qty">${qtyNum}</td>
            <td class="item-price">${currencySymbol}${itemPrice.toFixed(2)}</td>
            <td class="item-total">${currencySymbol}${(itemPrice * qtyNum).toFixed(2)}</td>
          </tr>
        `;
      })
      .join("");

    const paymentMethod = (saleData.paymentMethod || saleData.payMode || saleData.PaymentMode || "CASH").toUpperCase();

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          body {
            font-family: 'Courier New', Courier, monospace;
            background: #fff;
            margin: 0;
            padding: 5mm 6mm;
            color: #000;
            font-size: 13px;
          }
          .receipt {
            width: 100%;
            max-width: 72mm;
            margin: 0 auto;
          }
          .header-box {
            text-align: center;
            margin-bottom: 4mm;
          }
          .company-name {
            font-size: 20px;
            font-weight: 900;
            letter-spacing: 2.5px;
            text-transform: uppercase;
            line-height: 1.2;
          }
          .company-address {
            font-size: 10px;
            line-height: 1.3;
            margin-top: 2mm;
          }
          .divider-solid {
            border-top: 2px solid #000;
            margin: 3mm 0;
          }
          .bill-box {
            border: 1.5px solid #000;
            padding: 2.5mm 3mm;
            margin-bottom: 3mm;
            font-size: 12px;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 2px;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 3mm;
            font-size: 12px;
          }
          .items-table th {
            border-top: 2px solid #000;
            border-bottom: 2px solid #000;
            padding: 2mm 0;
            font-size: 12px;
            font-weight: 800;
          }
          .items-table td {
            padding: 2mm 0;
            border-bottom: 1px dotted #ccc;
          }
          .item-name { text-align: left; font-weight: 700; }
          .item-modifiers { font-size: 10px; color: #444; padding-left: 2mm; }
          .item-qty { text-align: center; font-weight: 700; }
          .item-price { text-align: right; }
          .item-total { text-align: right; font-weight: 700; }
          .totals {
            border-top: 1.5px solid #000;
            padding-top: 2mm;
            font-size: 12px;
            margin-bottom: 3mm;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 3px;
          }
          .grand-total {
            display: flex;
            justify-content: space-between;
            border-top: 2px solid #000;
            border-bottom: 2px solid #000;
            padding: 2.5mm 0;
            font-size: 14px;
            font-weight: 900;
            margin: 2.5mm 0;
          }
          .payment-section {
            font-size: 12px;
            margin-bottom: 4mm;
          }
          .footer {
            text-align: center;
            border-top: 1.5px solid #000;
            padding-top: 3.5mm;
            font-size: 12px;
            line-height: 1.4;
          }
        </style>
      </head>
      <body>
        <div class="receipt">
          <div class="header-box">
            <div class="company-name">${company.name}</div>
            ${company.address ? `<div class="company-address">${company.address}</div>` : ""}
            ${company.gstNo ? `<div style="font-size: 10px; font-weight: bold; margin-top: 1mm;">GST: ${company.gstNo}</div>` : ""}
            ${company.phone ? `<div style="font-size: 10px;">Tel: ${company.phone}</div>` : ""}
          </div>

          <div class="bill-box">
            <div class="detail-row">
              <span><b>INVOICE NO: ${billNo}</b></span>
              ${saleData.tableNo ? `<span><b>TABLE: ${saleData.tableNo}</b></span>` : ""}
            </div>
            <div class="detail-row" style="margin-top: 2px;">
              <span>DATE:</span>
              <span>${formatToSingaporeDate(saleDate)} ${formatToSingaporeTime(saleDate)}</span>
            </div>
          </div>

          <table class="items-table">
            <thead>
              <tr>
                <th style="text-align: left;">ITEM</th>
                <th style="text-align: center;">QTY</th>
                <th style="text-align: right;">PRICE</th>
                <th style="text-align: right;">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHTML}
            </tbody>
          </table>

          <div class="totals">
            <div class="total-row">
              <span>Sub Total:</span>
              <span>${currencySymbol}${amountWithoutGST.toFixed(2)}</span>
            </div>
            ${hasSC ? `
            <div class="total-row">
              <span>Service Charge:</span>
              <span>${currencySymbol}${serviceChargeAmount.toFixed(2)}</span>
            </div>` : ""}
            ${extraChargeAmount > 0 ? `
            <div class="total-row">
              <span>Extra Fee:</span>
              <span>+${currencySymbol}${extraChargeAmount.toFixed(2)}</span>
            </div>` : ""}
            ${hasGST && gstAmount > 0 ? `
            <div class="total-row">
              <span>GST (${gstRate}%):</span>
              <span>${currencySymbol}${gstAmount.toFixed(2)}</span>
            </div>` : ""}
          </div>

          <div class="grand-total">
            <span>GRAND TOTAL:</span>
            <span>${currencySymbol}${finalTotal.toFixed(2)}</span>
          </div>

          <div class="payment-section">
            <div class="total-row">
              <span>PAYMENT:</span>
              <span><b>${paymentMethod}</b></span>
            </div>
            <div class="total-row">
              <span>PAID:</span>
              <span>${currencySymbol}${finalTotal.toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>CHANGE:</span>
              <span>${currencySymbol}0.00</span>
            </div>
          </div>

          <div class="footer">
            <div style="font-weight: 800; font-size: 13px; margin-bottom: 1.5mm;">THANK YOU! COME AGAIN!</div>
            <div style="font-size: 11px; letter-spacing: 0.5px;">SMART-CAFE BY UNIPROSG</div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  static async printReceipt(saleData: any, userId?: string): Promise<boolean> {
    try {
      const html = await this.generateHTML(saleData, userId);

      // On Web: print via dedicated hidden iframe so browser prints ONLY the receipt document
      if (Platform.OS === "web" || typeof window !== "undefined") {
        if (typeof document !== "undefined") {
          const iframeId = "receipt-thermal-print-iframe";
          let frame = document.getElementById(iframeId) as HTMLIFrameElement | null;
          if (!frame) {
            frame = document.createElement("iframe");
            frame.id = iframeId;
            frame.style.position = "fixed";
            frame.style.right = "0";
            frame.style.bottom = "0";
            frame.style.width = "0";
            frame.style.height = "0";
            frame.style.border = "0";
            document.body.appendChild(frame);
          }
          const doc = frame.contentWindow?.document || frame.contentDocument;
          if (doc) {
            doc.open();
            doc.write(html);
            doc.close();

            return new Promise((resolve) => {
              let printed = false;
              const trigger = () => {
                if (printed) return;
                printed = true;
                frame?.contentWindow?.focus();
                frame?.contentWindow?.print();
                resolve(true);
              };
              frame?.contentWindow?.addEventListener("load", trigger);
              setTimeout(trigger, 400);
            });
          }
        }
      }

      // Native (iOS/Android): use Expo Print module
      await Print.printAsync({ html });
      return true;
    } catch (e) {
      console.error("Print error:", e);
      return false;
    }
  }

  static async shareReceiptPDF(saleData: any, userId?: string): Promise<boolean> {
    try {
      const html = await this.generateHTML(saleData, userId);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
        return true;
      }
      return false;
    } catch (e) {
      console.error("PDF generation or sharing error:", e);
      return false;
    }
  }
}

export default BillPDFGenerator;
