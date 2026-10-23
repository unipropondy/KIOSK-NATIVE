import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { API } from "@/config";
import BillPDFGenerator from "../components/BillPDFGenerator";
import BillPrompt from "../components/BillPrompt";
import UniversalPrinter from "../components/UniversalPrinter";

type Props = {
  orderId?: string | null;
  tableNo?: string;
  tableId?: string;
  isKiosk?: boolean;
  showActionButtons?: boolean;
  extraCharge?: number;
  initialItems?: any[];
  onReturnToOrder?: () => void;
};

// Status definitions exactly matching React web SettlementSuccess.js
const STATUS_STEPS = [
  {
    code: 2,
    label: "Order Preparing",
    message: "Your order is being prepared and will be ready soon.",
    emoji: "🍲",
    color: "#f97316",
  },
  {
    code: 3,
    label: "Order Ready",
    message: "Your order is ready. Please collect it.",
    emoji: "✅",
    color: "#22c55e",
  },
  {
    code: 4,
    label: "Completed",
    message: "Thank you! Your order has been completed.",
    emoji: "✔️",
    color: "#6366f1",
  },
];

function getActiveStep(statusCode: number) {
  const code = Number(statusCode);
  if (code >= 4) return 2; // Completed
  if (code === 3) return 1; // Ready
  return 0; // Preparing (1 or 2)
}

const STATUS_LABEL_MAP: Record<number, string> = {
  1: "NEW",
  2: "PREPARING",
  3: "READY",
  4: "COMPLETED",
};

const STATUS_COLOR_MAP: Record<number, string> = {
  1: "#94a3b8",
  2: "#f97316",
  3: "#22c55e",
  4: "#6366f1",
};

export default function SettlementSuccessScreen({
  orderId: initialOrderId,
  tableNo: initialTableNo,
  tableId: initialTableId,
  isKiosk = true,
  showActionButtons = true,
  extraCharge: initialExtraCharge = 0,
  initialItems = [],
  onReturnToOrder,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();

  const [orderId, setOrderId] = useState<string | null>(initialOrderId || null);
  const [tableNo, setTableNo] = useState<string>(initialTableNo || "");
  const [tableId, setTableId] = useState<string>(initialTableId || "");
  const [orderNumber, setOrderNumber] = useState<string>("");
  const [statusCode, setStatusCode] = useState<number>(2); // default: preparing

  // Order Details popup state - kept false so modal does not block screen
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [orderItems, setOrderItems] = useState<any[]>(initialItems || []);
  const [extraCharge, setExtraCharge] = useState<number>(initialExtraCharge || 0);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isShareLoading, setIsShareLoading] = useState(false);
  const autoReturnTimerRef = useRef<any>(null);
  const hasAutoPreviewedRef = useRef(false);

  // Read stored values if not passed as props
  useEffect(() => {
    const readStorage = async () => {
      try {
        if (!orderId) {
          const storedOrder =
            (await AsyncStorage.getItem("kioskOrderId")) ||
            (await AsyncStorage.getItem("orderId"));
          if (storedOrder) setOrderId(storedOrder);
        }
        if (!tableNo) {
          const storedTable = await AsyncStorage.getItem("tableNo");
          if (storedTable) setTableNo(storedTable);
        }
        if (!tableId) {
          const storedTid = await AsyncStorage.getItem("tableId");
          if (storedTid) setTableId(storedTid);
        }
      } catch (err) {
        console.log("Error reading storage:", err);
      }
    };
    readStorage();
  }, [orderId, tableNo, tableId]);

  // Load Order Details (Order Number & Status code)
  const loadOrderDetails = useCallback(async () => {
    if (!orderId) return;

    try {
      const res = await fetch(
        `${API}/order/order-details/${encodeURIComponent(orderId)}`
      );
      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        const dbOrderNumber = data[0]?.OrderNumber;
        if (dbOrderNumber) {
          setOrderNumber(String(dbOrderNumber).trim());
        }

        const dbTableNo = data[0]?.Tableno || data[0]?.tableNo;
        if (dbTableNo) {
          setTableNo(String(dbTableNo).trim());
        }

        const maxStatus = Math.max(
          ...data.map((d: any) => Number(d.StatusCode || 2))
        );
        setStatusCode(maxStatus);
      }
    } catch (err) {
      console.log("Failed to load order details:", err);
    }
  }, [orderId]);

  const handleReturn = useCallback(async () => {
    try {
      await AsyncStorage.multiRemove([
        "kioskOrderId",
        "kioskOrderType",
        "orderId",
        "tableId",
        "tableNo",
      ]);
      await AsyncStorage.setItem("returnToKioskStart", "true");
    } catch (e) {
      console.log("Error clearing storage on return:", e);
    }
    if (onReturnToOrder) {
      onReturnToOrder();
    }
  }, [onReturnToOrder]);

  // Load Items List for Modal
  const loadOrderItems = useCallback(async () => {
    if (!orderId) return;
    if (orderItems.length > 0) return; // Keep existing items if passed
    setItemsLoading(true);

    try {
      const res = await fetch(`${API}/order/order-items/${orderId}`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.items) && data.items.length > 0) {
        setOrderItems(data.items);
      }
    } catch (err) {
      console.log("Failed to load order items:", err);
    } finally {
      setItemsLoading(false);
    }
  }, [orderId, orderItems.length]);

  const calculatedItemsTotal = (orderItems || []).reduce(
    (sum, item) => sum + Number(item.LineTotal || (Number(item.PricePerUnit || item.price || item.Price || 0) * Number(item.Quantity || item.qty || 1))),
    0
  );

  const grandTotal = calculatedItemsTotal + Number(extraCharge || 0);

  const handlePrintReceipt = useCallback(async (isAuto = false) => {
    setIsPrinting(true);
    setShowPrintPrompt(false);
    try {
      // Ensure items are loaded
      let currentItems = orderItems;
      if (!currentItems || currentItems.length === 0) {
        const res = await fetch(`${API}/order/order-items/${orderId}`);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.items)) {
          currentItems = data.items;
          setOrderItems(currentItems);
        }
      }

      const calculatedSubtotal = (currentItems || []).reduce(
        (sum, item) => sum + Number(item.LineTotal || (Number(item.PricePerUnit || item.price || item.Price || 0) * Number(item.Quantity || item.qty || 1))),
        0
      );

      const saleData = {
        orderId: orderNumber || orderId,
        invoiceNumber: orderNumber || orderId,
        tableNo,
        items: (currentItems || []).map((item: any) => ({
          name: item.DishName || item.Name || item.name || "Item",
          quantity: Number(item.Quantity || item.qty || 1),
          price: Number(item.PricePerUnit ?? item.price ?? item.Price ?? 0),
          modifiers: item.modifiers || [],
        })),
        extraCharge: Number(extraCharge || 0),
        total: calculatedSubtotal > 0 ? (calculatedSubtotal + Number(extraCharge || 0)) : grandTotal,
        paymentMethod: "PAID",
      };

      // Direct USB hardware printing via backend spooler/bridge (NO browser preview dialog)
      await UniversalPrinter.smartPrint(saleData);
    } catch (e: any) {
      console.log("Print error:", e);
      if (!isAuto) {
        Alert.alert("Print Error", e.message || "Failed to print receipt.");
      }
    } finally {
      setIsPrinting(false);
    }
  }, [orderId, orderNumber, tableNo, orderItems, grandTotal, extraCharge]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadOrderDetails();
      loadOrderItems();
    }, 0);
    const interval = setInterval(loadOrderDetails, 10000);

    // Auto-return timer (30 seconds)
    autoReturnTimerRef.current = setTimeout(() => {
      handleReturn();
    }, 30000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      if (autoReturnTimerRef.current) clearTimeout(autoReturnTimerRef.current);
    };
  }, [loadOrderDetails, loadOrderItems, handleReturn, handlePrintReceipt]);

  const handleOpenOrderDetails = () => {
    setShowOrderDetails(true);
    loadOrderItems();
  };

  // Note: Backend generateAndQueueReceipt() automatically prints the receipt on payment completion.
  // We keep handlePrintReceipt available for manual user reprints if they click a print button,
  // but DO NOT auto-trigger it to prevent duplicate prints.

  const handleSharePDF = async () => {
    try {
      let currentItems = orderItems;
      if (!currentItems || currentItems.length === 0) {
        const res = await fetch(`${API}/order/order-items/${orderId}`);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.items)) {
          currentItems = data.items;
          setOrderItems(currentItems);
        }
      }

      const saleData = {
        orderId: orderNumber || orderId,
        invoiceNumber: orderNumber || orderId,
        tableNo,
        items: currentItems.map((item: any) => ({
          name: item.DishName || item.Name || item.name || "Item",
          quantity: Number(item.Quantity || item.qty || 1),
          price: Number(item.PricePerUnit ?? item.price ?? item.Price ?? 0),
          modifiers: item.modifiers || [],
        })),
        total: grandTotal,
        paymentMethod: "PAID",
      };

      await UniversalPrinter.sharePDF(saleData);
    } catch (e: any) {
      console.log("Share PDF error:", e);
      Alert.alert("PDF Error", e.message || "Failed to generate receipt PDF.");
    }
  };



  // Determine display number
  const effectiveNumber = orderNumber || orderId || "";
  const orderSuffix = effectiveNumber
    ? String(effectiveNumber).replace(/\D/g, "").slice(-4) || effectiveNumber
    : "----";

  const activeStep = getActiveStep(statusCode);
  const currentStatus = STATUS_STEPS[activeStep];
  const isValidStatus = [2, 3, 4].includes(Number(statusCode));

  // Determine circle size responsive
  const circleSize = Math.min(Math.max(screenWidth * 0.32, 210), 280);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.confirmationCard}>
          {/* Banner */}
          <Text style={styles.confirmationBanner}>Thank You!</Text>

          {/* Big Order Number Circle */}
          {isValidStatus && (
            <View
              style={[
                styles.orderCircle,
                { width: circleSize, height: circleSize, borderRadius: circleSize / 2 },
              ]}
            >
              <Text style={styles.orderCaption}>YOUR ORDER NO.</Text>
              <Text style={styles.orderNumber}>{orderSuffix}</Text>
            </View>
          )}



          {isValidStatus && (
            <>

            </>
          )}

          {/* Subtitle */}
          <Text style={styles.confirmationSubtitle}>
            {isValidStatus
              ? "Please collect your receipt"
              : "Please confirm the order"}
          </Text>

          {/* New Order / Return Button */}
          <TouchableOpacity
            style={styles.returnBtn}
            onPress={handleReturn}
            activeOpacity={0.85}
          >
            <Text style={styles.returnBtnIcon}>↺</Text>
            <Text style={styles.returnBtnText}>Start New Order</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Bill Prompt Dialog */}
      <BillPrompt
        visible={showPrintPrompt}
        total={grandTotal}
        onPrintBill={handlePrintReceipt}
        onSkip={() => setShowPrintPrompt(false)}
        onClose={() => setShowPrintPrompt(false)}
      />

      {/* Order Details Modal (Bottom sheet / centered popup) */}
      <Modal
        visible={showOrderDetails}
        transparent
        animationType="slide"
        onRequestClose={() => setShowOrderDetails(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIconWrap}>
                <Text style={styles.modalHeaderIcon}>📋</Text>
              </View>
              <View style={styles.modalHeaderTitleWrap}>
                <Text style={styles.modalTitle}>Order Details</Text>
                {!!orderNumber && (
                  <Text style={styles.modalSubtitle}>Order #{orderNumber}</Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowOrderDetails(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Modal Body */}
            <View style={styles.modalBody}>
              {itemsLoading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color="#f97316" />
                  <Text style={styles.loadingText}>Loading your order…</Text>
                </View>
              ) : orderItems.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyIcon}>🍽️</Text>
                  <Text style={styles.emptyText}>No items found for this order.</Text>
                </View>
              ) : (
                <>
                  {/* Column Header */}
                  <View style={styles.colHeader}>
                    <Text style={[styles.colHeaderText, { flex: 2 }]}>ITEM</Text>
                    <Text style={[styles.colHeaderText, { width: 44, textAlign: "center" }]}>QTY</Text>
                    <Text style={[styles.colHeaderText, { width: 70, textAlign: "right" }]}>PRICE</Text>
                    <Text style={[styles.colHeaderText, { width: 70, textAlign: "right" }]}>TOTAL</Text>
                  </View>

                    <ScrollView style={styles.itemsScroll}>
                    {orderItems.map((item, idx) => {
                      const itemName = item.DishName || item.Name || item.name || "Item";
                      const itemQty = Number(item.Quantity || item.qty || 1);
                      const itemPrice = Number(item.PricePerUnit ?? item.price ?? item.Price ?? 0);
                      const itemTotal = Number(item.LineTotal ?? item.TotalDetailLineAmount ?? (itemPrice * itemQty));
                      const statusLabel =
                        STATUS_LABEL_MAP[item.StatusCode] || "PREPARING";
                      const statusColor =
                        STATUS_COLOR_MAP[item.StatusCode] || "#94a3b8";

                      return (
                        <View
                          key={item.OrderDetailId || item.id || idx}
                          style={styles.itemRow}
                        >
                          <View style={{ flex: 2, paddingRight: 8 }}>
                            <Text style={styles.itemName}>{itemName}</Text>
                            {!!item.Remarks && (
                              <Text style={styles.itemRemarks}>
                                📝 {item.Remarks}
                              </Text>
                            )}
                            <View
                              style={[
                                styles.itemStatusBadge,
                                {
                                  backgroundColor: `${statusColor}22`,
                                  borderColor: `${statusColor}55`,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.itemStatusText,
                                  { color: statusColor },
                                ]}
                              >
                                {statusLabel}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.itemQty}>×{itemQty}</Text>
                          <Text style={styles.itemPrice}>
                            ${itemPrice.toFixed(2)}
                          </Text>
                          <Text style={styles.itemTotal}>
                            ${itemTotal.toFixed(2)}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>

                  {/* Breakdown & Extra Charge */}
                  {Number(extraCharge) > 0 && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Subtotal</Text>
                      <Text style={styles.breakdownValue}>${calculatedItemsTotal.toFixed(2)}</Text>
                    </View>
                  )}
                  {Number(extraCharge) > 0 && (
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Service / Extra Charge</Text>
                      <Text style={styles.breakdownValue}>+${Number(extraCharge).toFixed(2)}</Text>
                    </View>
                  )}

                  {/* Grand Total */}
                  <View style={styles.grandTotalRow}>
                    <Text style={styles.grandTotalLabel}>Grand Total</Text>
                    <Text style={styles.grandTotalValue}>
                      ${grandTotal.toFixed(2)}
                    </Text>
                  </View>

                  {/* Modal Action Buttons: Print & Share & Close */}
                  <View style={styles.modalActionsRow}>
                    <TouchableOpacity
                      style={styles.modalPrintBtn}
                      onPress={() => handlePrintReceipt(false)}
                      disabled={isPrinting}
                      activeOpacity={0.8}
                    >
                      {isPrinting ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <>
                          <Text style={styles.modalPrintBtnIcon}>🖨️</Text>
                          <Text style={styles.modalPrintBtnText}>Print Bill</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.modalShareBtn}
                      onPress={handleSharePDF}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.modalShareBtnIcon}>📤</Text>
                      <Text style={styles.modalShareBtnText}>Share PDF</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.modalDoneBtn}
                      onPress={() => setShowOrderDetails(false)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.modalDoneBtnText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f97316",
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  confirmationCard: {
    width: "100%",
    maxWidth: 720,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  confirmationBanner: {
    fontSize: 48,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: -1,
    textAlign: "center",
    marginBottom: 28,
    textShadowColor: "rgba(0, 0, 0, 0.15)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  orderCircle: {
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
    marginBottom: 20,
  },
  orderCaption: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ea580c",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  orderNumber: {
    fontSize: 52,
    fontWeight: "900",
    color: "#ea580c",
    letterSpacing: -1,
    textAlign: "center",
  },
  tableRow: {
    marginBottom: 16,
  },
  tableLabel: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
  },
  tableAccent: {
    color: "#fef08a",
    fontSize: 26,
    fontWeight: "900",
  },
  actionButtonsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginBottom: 20,
    width: "100%",
    maxWidth: 480,
  },
  detailsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  detailsBtnIcon: {
    fontSize: 16,
  },
  detailsBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ea580c",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderRadius: 18,
    padding: 16,
    width: "100%",
    maxWidth: 440,
    gap: 14,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  statusBadgeEmoji: {
    fontSize: 34,
  },
  statusBadgeTextWrap: {
    flex: 1,
  },
  statusBadgeTitle: {
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 2,
  },
  statusBadgeMsg: {
    fontSize: 13,
    color: "#6b7280",
    fontWeight: "600",
    lineHeight: 18,
  },
  trackerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: 460,
    marginBottom: 24,
  },
  stepWrapper: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  stepItem: {
    alignItems: "center",
    flex: 1,
  },
  stepCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.6)",
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  doneCheck: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },
  stepEmoji: {
    fontSize: 18,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  stepConnector: {
    height: 3,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.35)",
    marginTop: -16,
    borderRadius: 2,
  },
  stepConnectorFilled: {
    backgroundColor: "#ffffff",
  },
  confirmationSubtitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 24,
    textShadowColor: "rgba(0, 0, 0, 0.1)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  returnBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#ffffff",
    paddingVertical: 16,
    paddingHorizontal: 36,
    borderRadius: 999,
    width: "100%",
    maxWidth: 380,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  returnBtnIcon: {
    fontSize: 20,
    fontWeight: "900",
    color: "#ea580c",
  },
  returnBtnText: {
    fontSize: 19,
    fontWeight: "900",
    color: "#ea580c",
  },

  /* MODAL */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 28,
    width: "100%",
    maxWidth: 580,
    maxHeight: "85%",
    paddingBottom: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 28,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    gap: 12,
  },
  modalHeaderIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  modalHeaderIcon: {
    fontSize: 20,
  },
  modalHeaderTitleWrap: {
    flex: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#1e293b",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "600",
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#64748b",
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  loadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#64748b",
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 10,
  },
  emptyIcon: {
    fontSize: 44,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#64748b",
  },
  colHeader: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  colHeaderText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94a3b8",
    letterSpacing: 0.6,
  },
  itemsScroll: {
    maxHeight: 320,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
  },
  itemName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1e293b",
  },
  itemRemarks: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  itemStatusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 4,
  },
  itemStatusText: {
    fontSize: 10,
    fontWeight: "800",
  },
  itemQty: {
    width: 44,
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
    textAlign: "center",
  },
  itemPrice: {
    width: 70,
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    textAlign: "right",
  },
  itemTotal: {
    width: 70,
    fontSize: 15,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "right",
  },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  grandTotalLabel: {
    fontSize: 16,
    fontWeight: "900",
    color: "#ea580c",
  },
  grandTotalValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#ea580c",
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  breakdownLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
  },
  modalActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    alignItems: "center",
  },
  modalPrintBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#ea580c",
    borderRadius: 14,
    paddingVertical: 12,
    shadowColor: "#ea580c",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  modalPrintBtnIcon: {
    fontSize: 16,
  },
  modalPrintBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#ffffff",
  },
  modalShareBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    paddingVertical: 12,
  },
  modalShareBtnIcon: {
    fontSize: 15,
  },
  modalShareBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
  },
  modalDoneBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  modalDoneBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748b",
  },
});

