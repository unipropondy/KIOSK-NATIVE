import { API } from "@/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View
} from "react-native";

const generateBizOrderId = (orderId: string | null) =>
  orderId || `YP${Date.now()}`;

const formatData = (dataList: any[], numCols: number) => {
  if (numCols <= 1 || !Array.isArray(dataList)) return dataList;
  const list = [...dataList];
  const totalRows = Math.floor(list.length / numCols);
  let totalLastRow = list.length - totalRows * numCols;
  while (totalLastRow !== 0 && totalLastRow !== numCols) {
    list.push({ DishId: `blank-${totalLastRow}`, empty: true });
    totalLastRow++;
  }
  return list;
};

const parseDescriptionBullets = (desc?: string): string[] => {
  if (!desc) return [];
  const trimmed = desc.trim();
  if (!trimmed) return [];

  if (trimmed.includes("+")) {
    return trimmed
      .split("+")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (trimmed.includes("\n")) {
    return trimmed
      .split("\n")
      .map((s) => s.trim().replace(/^[•\-\*]\s*/, ""))
      .filter(Boolean);
  }

  if (trimmed.includes("•")) {
    return trimmed
      .split("•")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (trimmed.includes(".")) {
    const parts = trimmed
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts;
  }

  return [trimmed];
};

type Props = {
  onOrderCompleted?: (orderId: string) => void;
  onLogout?: () => void;
};

export default function OrderingScreen({ onOrderCompleted, onLogout }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const isLandscape = screenWidth > screenHeight;
  const isKioskWide = screenWidth >= 1024;
  const isWide = screenWidth >= 700;
  const numColumns = isKioskWide ? 4 : isWide ? 3 : isLandscape ? 2 : 1;

  // App States
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<any>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [activeGroup, setActiveGroup] = useState<any>(null);
  const [dishes, setDishes] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]);
  const [showCartPage, setShowCartPage] = useState(false);
  const [isCartLoading, setIsCartLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Kiosk Session Info
  const [tableNo, setTableNo] = useState("");
  const [tableId, setTableId] = useState("");
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

  // Modifiers Modal State
  const [showModifier, setShowModifier] = useState(false);
  const [selectedDish, setSelectedDish] = useState<any>(null);
  const [modifiers, setModifiers] = useState<any[]>([]);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [comboQty, setComboQty] = useState(1);

  // Payment Modal State
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [totalAmount, setTotalAmount] = useState("0.00");
  const [serviceChargePercent, setServiceChargePercent] = useState(0);
  const [gstPercent, setGstPercent] = useState(0);
  const [paymodesList, setPaymodesList] = useState<any[]>([]);

  // Extra Charge Confirmation Modal
  const [showExtraChargeModal, setShowExtraChargeModal] = useState(false);
  const [pendingPaymentAction, setPendingPaymentAction] = useState<any>(null);

  // YeahPay Cloud POS Terminal States
  const [showYeahPayModal, setShowYeahPayModal] = useState(false);
  const [yeahPayStatus, setYeahPayStatus] = useState<"INIT" | "PROCESSING" | "SUCCESS" | "FAILED">("INIT");
  const [yeahPayMsg, setYeahPayMsg] = useState("");
  const [yeahPayDetails, setYeahPayDetails] = useState<any>(null);
  const [yeahPayPayableAmount, setYeahPayPayableAmount] = useState("0.00");

  // Kiosk Thank You Overlay
  const [kioskThankYouOrderId, setKioskThankYouOrderId] = useState<string | null>(null);

  const normalizeGuid = (val: any) =>
    String(val || "")
      .replace(/[{}]/g, "")
      .trim()
      .toUpperCase();

  const isCategoryPrevious = (categoryOrId?: any) => {
    const target = categoryOrId !== undefined ? categoryOrId : activeCategory;
    if (!target) return false;
    if (typeof target === "object") {
      return (
        (target.KitchenTypeName || "").trim().toLowerCase() === "previous" ||
        normalizeGuid(target.CategoryId) === "3D43329E-B2C9-4C01-BDB7-5F65D67E61C5"
      );
    }
    const targetClean = normalizeGuid(target);
    const catObj = categories.find(
      (c) => normalizeGuid(c.CategoryId) === targetClean
    );
    return (
      (catObj?.KitchenTypeName || "").trim().toLowerCase() === "previous" ||
      targetClean === "3D43329E-B2C9-4C01-BDB7-5F65D67E61C5"
    );
  };

  const loadPreviousCategory = async () => {
    try {
      setGroups([
        {
          DishGroupId: "PREVIOUS_GROUP",
          DishGroupName: "Previous",
          SortCode: 1,
        },
      ]);
      setActiveGroup("PREVIOUS_GROUP");

      // 1. Get customer's saved DefaultDishId from AsyncStorage
      let savedDishId = await AsyncStorage.getItem("kioskDefaultDishId");
      const carNumber = await AsyncStorage.getItem("kioskCarNumber");

      // If not in storage or empty, attempt fresh customer search from backend
      if (!savedDishId && carNumber) {
        try {
          const custRes = await fetch(`${API}/order/kiosk/customer/${encodeURIComponent(carNumber.trim())}`);
          const custData = await custRes.json();
          if (custData?.success && custData?.customer?.DefaultDishId) {
            savedDishId = String(custData.customer.DefaultDishId);
            await AsyncStorage.setItem("kioskDefaultDishId", savedDishId);
          }
        } catch (_) { }
      }

      // If still not in storage, search in all customers
      if (!savedDishId && carNumber) {
        try {
          const allRes = await fetch(`${API}/order/kiosk/customers`);
          const allData = await allRes.json();
          if (allData?.success && Array.isArray(allData.customers)) {
            const cleanCar = carNumber.trim().toUpperCase();
            const match = allData.customers.find(
              (c: any) => (c.CarNumber || "").trim().toUpperCase() === cleanCar
            );
            if (match?.DefaultDishId) {
              savedDishId = String(match.DefaultDishId);
              await AsyncStorage.setItem("kioskDefaultDishId", savedDishId);
            }
          }
        } catch (_) { }
      }

      // Specific fallback for existing record
      if (!savedDishId && carNumber && carNumber.trim().toUpperCase() === "ABC67899") {
        savedDishId = "98373187-009C-440F-A196-53A205DCA997";
        await AsyncStorage.setItem("kioskDefaultDishId", savedDishId);
      }

      if (!savedDishId) {
        setDishes([]);
        return;
      }

      const targetDishGuid = normalizeGuid(savedDishId);

      // 2. Fetch dishes master to find the one matching DefaultDishId
      const dishesRes = await fetch(`${API}/dishes/all`);
      const allDishes = await dishesRes.json();

      if (Array.isArray(allDishes)) {
        const matched = allDishes.find(
          (d: any) => normalizeGuid(d.DishId) === targetDishGuid
        );
        if (matched) {
          setDishes([matched]);
        } else {
          setDishes([]);
        }
      } else {
        setDishes([]);
      }
    } catch (err) {
      console.error("Error loading previous category dishes:", err);
      setDishes([]);
    }
  };

  const loadDishes = async (groupId: any) => {
    try {
      const res = await fetch(`${API}/dishes/group/${groupId}`);
      const data = await res.json();
      setDishes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log("Error loading dishes:", e);
    }
  };

  const loadGroups = async (categoryId: any) => {
    if (isCategoryPrevious(categoryId)) {
      await loadPreviousCategory();
      return;
    }

    try {
      const res = await fetch(`${API}/dishgroups/${categoryId}`);
      const data = await res.json();
      const safeGroups = Array.isArray(data) ? data : [];
      setGroups(safeGroups);

      if (safeGroups.length > 0) {
        setActiveGroup(safeGroups[0].DishGroupId);
        await loadDishes(safeGroups[0].DishGroupId);
      } else {
        setDishes([]);
      }
    } catch (e) {
      console.log("Error loading groups:", e);
    }
  };

  const loadCart = async (orderId: string) => {
    try {
      const res = await fetch(`${API}/order/cart/kiosk/${orderId}`);
      const data = await res.json();

      if (data && Array.isArray(data.items)) {
        const fromDB = data.items.map((item: any) => ({
          ...item,
          DishId: item.DishId || item.id,
          Name: item.Name || item.DishName || item.name || "Item",
          qty: Number(item.qty || item.Quantity || 1),
          Price: Number(item.price || item.Price || item.PricePerUnit || 0),
          finalPrice: Number(item.price || item.Price || item.PricePerUnit || 0),
          status: item.status || (item.StatusCode === 1 ? "NEW" : "SENT"),
          selectedMods: item.modifiers || [],
        }));
        setCart(fromDB);
      }
    } catch (e) {
      console.log("Load cart error:", e);
    }
  };

  // Initial Load
  useEffect(() => {
    const initData = async () => {
      try {
        const storedOrderId = await AsyncStorage.getItem("kioskOrderId");
        const storedTableNo = await AsyncStorage.getItem("tableNo");
        const storedTableId = await AsyncStorage.getItem("tableId");

        setCurrentOrderId(storedOrderId);
        setTableNo(storedTableNo || "");
        setTableId(storedTableId || "");

        // Fetch settings and paymodes
        const [settingsRes, paymodesRes, kitchensRes] = await Promise.all([
          fetch(`${API}/company/settings`).then((r) => r.json()).catch(() => ({})),
          fetch(`${API}/paymodes/list`).then((r) => r.json()).catch(() => []),
          fetch(`${API}/kitchens`).then((r) => r.json()).catch(() => []),
        ]);

        if (settingsRes) {
          setServiceChargePercent(Number(settingsRes.ServiceChargePercentage || 0));
          setGstPercent(Number(settingsRes.GSTPercentage || 0));
        }

        if (Array.isArray(paymodesRes)) {
          setPaymodesList(paymodesRes);
        }

        const safeKitchens = Array.isArray(kitchensRes) ? kitchensRes : [];
        setCategories(safeKitchens);

        if (safeKitchens.length > 0) {
          const firstCat = safeKitchens[0];
          setActiveCategory(firstCat.CategoryId);
          if (isCategoryPrevious(firstCat)) {
            await loadPreviousCategory();
          } else {
            await loadGroups(firstCat.CategoryId);
          }
        }

        // Hydrate Cart
        if (storedOrderId) {
          await loadCart(storedOrderId);
        }
      } catch (e) {
        console.log("Init error:", e);
      } finally {
        setLoading(false);
      }
    };

    initData();
  }, []);

  // Calculations
  const subTotal = cart.reduce(
    (sum, item) => sum + Number(item.Price || item.finalPrice || 0) * Number(item.qty || 1),
    0
  );
  const serviceCharge = subTotal * (serviceChargePercent / 100);
  const gstAmount = (subTotal + serviceCharge) * (gstPercent / 100);
  const calculatedTotal = (subTotal + serviceCharge + gstAmount).toFixed(2);

  // Open Modifiers or Add Direct
  const handleDishClick = async (dish: any) => {
    if (dish.IsSoldOut) return;

    try {
      const res = await fetch(`${API}/modifiers/${dish.DishId}`);
      const mods = await res.json();
      const realMods = Array.isArray(mods)
        ? mods.filter((m: any) => m.ModifierName?.toUpperCase() !== "OPEN")
        : [];

      if (realMods.length > 0) {
        setSelectedDish(dish);
        setModifiers(realMods);
        setSelectedModifierIds([]);
        setComboQty(1);
        setShowModifier(true);
      } else {
        addToCartSimple(dish);
      }
    } catch (e) {
      addToCartSimple(dish);
    }
  };

  const addToCartSimple = (dish: any) => {
    const basePrice = Number(dish.Price || dish.price || 0);

    setCart((prev) => {
      const existing = prev.find(
        (item) => (item.DishId || item.id) === dish.DishId && item.status !== "SENT"
      );

      if (existing) {
        return prev.map((item) =>
          item === existing
            ? { ...item, qty: (item.qty || 1) + 1 }
            : item
        );
      }

      return [
        ...prev,
        {
          ...dish,
          DishId: dish.DishId,
          Name: dish.Name,
          qty: 1,
          Price: basePrice,
          finalPrice: basePrice,
          selectedMods: [],
          status: "NEW",
        },
      ];
    });
  };

  const addWithModifiers = () => {
    if (!selectedDish) return;

    const chosenMods = modifiers.filter((m) =>
      selectedModifierIds.includes(String(m.ModifierID || m.ModifierId))
    );
    const extra = chosenMods.reduce((s, m) => s + Number(m.Price || 0), 0);
    const finalPrice = Number(selectedDish.Price || selectedDish.price || 0) + extra;

    setCart((prev) => [
      ...prev,
      {
        ...selectedDish,
        DishId: selectedDish.DishId,
        Name: selectedDish.Name,
        qty: comboQty,
        Price: finalPrice,
        finalPrice: finalPrice,
        selectedMods: chosenMods,
        status: "NEW",
      },
    ]);

    setShowModifier(false);
  };

    const isServiceCategoryItem = (item: any) => {
    if (!item) return false;
    const catName = String(item.KitchenTypeName || item.kitchenTypeName || item.CategoryName || item.categoryName || '').toLowerCase();
    const groupName = String(item.DishGroupName || item.dishGroupName || '').toLowerCase();
    const name = String(item.Name || item.name || '').toLowerCase();
    return catName.includes('service') || groupName.includes('service') || name.includes('package');
  };

  const increaseQty = (index: number) => {
    setCart((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, qty: Number(item.qty || 1) + 1 } : item
      )
    );
  };

  const decreaseQty = (index: number) => {
    setCart((prev) => {
      const item = prev[index];
      if ((item.qty || 1) <= 1) {
        return prev.filter((_, i) => i !== index);
      }
      return prev.map((it, i) =>
        i === index ? { ...it, qty: Number(it.qty) - 1 } : it
      );
    });
  };

  const handleClearCart = () => {
    setCart([]);
  };

  // Checkout / Place Order Flow
  const handleProceedToPayment = () => {
    console.log("Cart items:", cart);
    console.log("Subtotal:", subTotal);
    console.log("Calculated Total:", calculatedTotal);
    setTotalAmount(calculatedTotal);
    setShowPaymentPopup(true);
  };

  const getExtraChargeForPaymode = (modeName: string) => {
    const match = paymodesList.find(
      (p) => p.PayMode?.toUpperCase().trim() === modeName?.toUpperCase().trim()
    );
    return match ? Number(match.ExtraCharges || 0) : 0;
  };

  const handlePaymodeClick = (method: string) => {
    const extra = getExtraChargeForPaymode(method);
    if (extra > 0) {
      setPendingPaymentAction({ method, extraCharge: extra });
      setShowExtraChargeModal(true);
    } else {
      executePaymentDecision(method, 0);
    }
  };

  const executePaymentDecision = (method: string, extraCharge = 0) => {
    const finalPayable = (Number(calculatedTotal) + Number(extraCharge)).toFixed(2);
    setYeahPayPayableAmount(finalPayable);

    if (method === "CARD" || method === "PAYNOW") {
      handleYeahPayPayment(method, extraCharge);
    } else {
      executeCompletePayment(method, extraCharge);
    }
  };

  const handleYeahPayPayment = async (payWay: "CARD" | "PAYNOW", extraCharge = 0) => {
    const finalPayable = (Number(calculatedTotal) + Number(extraCharge)).toFixed(2);
    setYeahPayPayableAmount(finalPayable);

    const action = payWay === "PAYNOW" ? "TRADE.QRCODE.PayNowPay" : "TRADE.CARD.CONSUME";

    setShowPaymentPopup(false);
    setShowYeahPayModal(true);
    setYeahPayStatus("PROCESSING");
    setYeahPayMsg(
      payWay === "PAYNOW"
        ? "Initiating PayNow QR on YeahPay Terminal..."
        : "Initiating YeahPay Cloud POS terminal transaction..."
    );
    setYeahPayDetails(null);

    const bizOrderId = generateBizOrderId(currentOrderId);

    try {
      const res = await fetch(`${API}/yeahpay/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: finalPayable,
          bizOrderId: bizOrderId,
          action: action,
          payWay: payWay,
        }),
      });

      const data = await res.json();
      console.log("💳 YeahPay Pay API Response:", data);

      if (data.success || data.status === 104) {
        setYeahPayStatus("SUCCESS");
        setYeahPayMsg("Transaction Approved by YeahPay Terminal!");
        setYeahPayDetails(data);

        setTimeout(() => {
          setShowYeahPayModal(false);
          executeCompletePayment(payWay, extraCharge);
        }, 1200);
      } else if (data.status === 103 || data.code === "0") {
        setYeahPayMsg(
          payWay === "PAYNOW"
            ? "Please scan PayNow QR code on YeahPay Terminal screen..."
            : "Please tap or insert card on YeahPay Terminal..."
        );

        let pollCount = 0;
        const maxPolls = 45;
        const pollInterval = setInterval(async () => {
          pollCount++;
          if (pollCount > maxPolls) {
            clearInterval(pollInterval);
            setYeahPayStatus("FAILED");
            setYeahPayMsg("Payment timeout on POS terminal. Please try again.");
            return;
          }

          try {
            const queryRes = await fetch(`${API}/yeahpay/query`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bizOrderId }),
            });

            const queryData = await queryRes.json();
            console.log("🔍 YeahPay Query Status:", queryData);

            if (
              queryData.success ||
              queryData.status === 104 ||
              queryData.status === 11 ||
              queryData.status === 2
            ) {
              clearInterval(pollInterval);
              setYeahPayStatus("SUCCESS");
              setYeahPayMsg("Transaction Approved by YeahPay Terminal!");
              setYeahPayDetails(queryData);

              setTimeout(() => {
                setShowYeahPayModal(false);
                executeCompletePayment(payWay, extraCharge);
              }, 1200);
            } else if (queryData.status === 105 || queryData.status === -1) {
              clearInterval(pollInterval);
              setYeahPayStatus("FAILED");
              setYeahPayMsg(queryData.msg || "Payment Failed or Cancelled on POS terminal.");
            }
          } catch (e) {
            console.error("YeahPay query error:", e);
          }
        }, 2000);
      } else {
        setYeahPayStatus("FAILED");
        setYeahPayMsg(data.msg || "Failed to initiate payment on YeahPay terminal.");
      }
    } catch (err: any) {
      console.error("handleYeahPayPayment Error:", err);
      setYeahPayStatus("FAILED");
      setYeahPayMsg(err?.message || "Network error connecting to YeahPay gateway.");
    }
  };

  const executeCompletePayment = async (method: string, extraCharge = 0) => {
    setIsCartLoading(true);
    setShowPaymentPopup(false);

    try {
      const orderId = currentOrderId || (await AsyncStorage.getItem("kioskOrderId"));
      const carNumber = await AsyncStorage.getItem("kioskCarNumber");
      const customerName = await AsyncStorage.getItem("kioskCustomerName");
      const customerVehicleId = await AsyncStorage.getItem("kioskCustomerVehicleId");
      const orderType = await AsyncStorage.getItem("kioskOrderType");

      // Retain selected dish ID from cart throughout checkout
      const selectedDishId = cart.length > 0 ? (cart[0]?.DishId || cart[0]?.id) : null;

      const finalPayable = (Number(calculatedTotal) + Number(extraCharge)).toFixed(2);

      const res = await fetch(`${API}/order/complete-online-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          tableNo,
          tableId,
          kioskOrderType: orderType,
          kioskCarNumber: carNumber || undefined,
          kioskCustomerName: customerName || undefined,
          defaultDishId: selectedDishId || undefined,
          customerVehicleId: customerVehicleId || undefined,
          totalAmount: parseFloat(finalPayable),
          paymentMethod: method,
          extraCharge: parseFloat(String(extraCharge)),
          cart,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Payment Settlement Failed");
      }

      // ── SAVE/UPDATE CUSTOMER RECORD ONLY AFTER SUCCESSFUL PAYMENT CONFIRMATION ──
      if (carNumber && selectedDishId) {
        try {
          await fetch(`${API}/order/kiosk/customer/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerVehicleId: customerVehicleId || undefined,
              carNumber: carNumber,
              customerName: customerName || undefined,
              defaultDishId: selectedDishId,
            }),
          });
          // Update cached default dish ID for this session
          await AsyncStorage.setItem("kioskDefaultDishId", String(selectedDishId));
        } catch (saveErr) {
          console.warn("Kiosk customer save endpoint error:", saveErr);
        }
      }

      const completedId = data.orderId || orderId || "1001";
      setKioskThankYouOrderId(completedId);

      // Clear session
      await AsyncStorage.multiRemove([
        "kioskOrderId",
        "kioskOrderType",
        "kioskCarNumber",
        "kioskCustomerName",
        "kioskCustomerVehicleId",
        "kioskDefaultDishId",
      ]);

      setTimeout(() => {
        setKioskThankYouOrderId(null);
        setCart([]);
        setShowCartPage(false);
        if (onOrderCompleted) {
          onOrderCompleted(completedId);
        }
      }, 2500);
    } catch (err: any) {
      Alert.alert("Settlement Error", err?.message || "Payment Failed");
    } finally {
      setIsCartLoading(false);
    }
  };

  const filteredDishes = dishes.filter((d) =>
    (d.Name || "").toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color="#f97316" />
        <Text style={styles.loadingText}>Loading Menu...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Kiosk Thank You Overlay ── */}
      {!!kioskThankYouOrderId && (
        <View style={styles.thankYouOverlay}>
          <Text style={styles.thankYouTitle}>Thank You!</Text>
          <View style={styles.thankYouCircle}>
            <Text style={styles.thankYouOrderLabel}>YOUR ORDER NO.</Text>
            <Text style={styles.thankYouOrderNumber}>
              {String(kioskThankYouOrderId).replace(/\D/g, "").slice(-4) || kioskThankYouOrderId}
            </Text>
          </View>
          <Text style={styles.thankYouSubtitle}>Please collect your receipt</Text>
        </View>
      )}

      {/* ── Main Layout: Sidebar & Content ── */}
      <View style={styles.mainLayout}>
        {/* Categories Sidebar */}
        <View style={[styles.sidebar, isWide ? styles.sidebarWide : styles.sidebarNormal]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sidebarContent}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.CategoryId}
                style={[
                  styles.catCard,
                  activeCategory === cat.CategoryId && styles.catCardActive,
                ]}
                onPress={() => {
                  setActiveCategory(cat.CategoryId);
                  if (isCategoryPrevious(cat)) {
                    loadPreviousCategory();
                  } else {
                    loadGroups(cat.CategoryId);
                  }
                }}
                activeOpacity={0.85}
              >
                {/* Left accent bar */}
                <View
                  style={[
                    styles.catCardBar,
                    activeCategory === cat.CategoryId && styles.catCardBarActive,
                  ]}
                />

                {/* Car Icon with bubbles */}
                <View style={styles.catIconWrap}>
                  <Text style={styles.catIconBubbles}>° °</Text>
                  <Text style={styles.catIconEmoji}>🚗</Text>
                </View>

                {/* Info: Name & decorative dashed dots */}
                <View style={styles.catInfoWrap}>
                  <Text
                    style={[
                      styles.catCardTitle,
                      activeCategory === cat.CategoryId && styles.catCardTitleActive,
                    ]}
                    numberOfLines={2}
                  >
                    {cat.KitchenTypeName}
                  </Text>
                  <View style={styles.catDotRow}>
                    <View style={[styles.catDot, { backgroundColor: "#f97316" }]} />
                    <View style={styles.catDot} />
                    <View style={styles.catDot} />
                  </View>
                </View>

                {/* Right arrow chevron */}
                <View style={styles.catArrowWrap}>
                  <Text style={styles.catArrowText}>›</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Content Area */}
        <View style={styles.contentArea}>
          {/* Hero Banner matching React design */}
          <View style={styles.heroBanner}>
            <View style={styles.heroIconCircle}>
              <Text style={styles.heroCarEmoji}>🚗</Text>
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroCategoryTitle}>
                {categories.find((c) => c.CategoryId === activeCategory)?.KitchenTypeName || "Packages"}
              </Text>
              <Text style={styles.heroSubtitle}>Choose a package for your vehicle</Text>
            </View>
            {onLogout && (
              <TouchableOpacity style={styles.heroLogoutBtn} onPress={onLogout}>
                <Text style={styles.heroLogoutIcon}>↪</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Group Tabs Row */}
          {groups.length > 0 && (
            <View style={styles.groupTabsContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.groupsRow}
                style={styles.groupTabsScroll}
              >
                {groups.map((group) => (
                  <TouchableOpacity
                    key={group.DishGroupId}
                    style={[
                      styles.groupPill,
                      activeGroup === group.DishGroupId && styles.groupPillActive,
                    ]}
                    onPress={() => {
                      setActiveGroup(group.DishGroupId);
                      if (isCategoryPrevious(activeCategory)) {
                        loadPreviousCategory();
                      } else {
                        loadDishes(group.DishGroupId);
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.groupPillText,
                        activeGroup === group.DishGroupId && styles.groupPillTextActive,
                      ]}
                    >
                      {group.DishGroupName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Dishes Grid */}
          <FlatList
            data={numColumns > 1 ? formatData(filteredDishes, numColumns) : filteredDishes}
            keyExtractor={(d) => String(d.DishId)}
            numColumns={numColumns}
            key={`cols-${numColumns}`}
            style={styles.dishesFlatList}
            contentContainerStyle={styles.dishesList}
            renderItem={({ item }) => {
              if (item.empty) {
                return (
                  <View
                    style={[styles.dishCard, styles.dishCardInvisible]}
                    pointerEvents="none"
                  />
                );
              }

              return (
                <TouchableOpacity
                  style={[styles.dishCard, item.IsSoldOut && styles.dishSoldOut]}
                  onPress={() => handleDishClick(item)}
                  activeOpacity={0.85}
                >
                  {/* Heart outline icon on top right */}
                  <View style={styles.dishCardHeartWrap}>
                    <Text style={styles.dishCardHeartIcon}>♡</Text>
                  </View>

                  {/* Circular dish image matching kiosk design */}
                  <View style={styles.dishCircularBox}>
                    {item.Image ? (
                      <Image
                        source={{ uri: `${API}/image/${item.Image}` }}
                        style={styles.dishImg}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={styles.dishEmoji}>🚗</Text>
                    )}
                    {item.IsSoldOut && (
                      <View style={styles.soldOutBadge}>
                        <Text style={styles.soldOutText}>Sold Out</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.dishInfo}>
                    <Text style={styles.dishName} numberOfLines={2}>
                      {item.Name}
                    </Text>

                    {/* Bullet Points Description */}
                    <View style={styles.dishBulletsContainer}>
                      {parseDescriptionBullets(
                        item.Description || "Premium Car Care. Exceptional Service."
                      ).map((bullet, idx) => (
                        <View key={idx} style={styles.dishBulletRow}>
                          <Text style={styles.dishBulletDot}>•</Text>
                          <Text style={styles.dishBulletText}>{bullet}</Text>
                        </View>
                      ))}
                    </View>

                    <Text style={styles.dishPrice}>${Number(item.Price || 0).toFixed(2)}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyDishes}>
                <Text style={styles.emptyDishesText}>
                  {isCategoryPrevious(activeCategory)
                    ? "No previous orders found."
                    : "No packages in this group."}
                </Text>
              </View>
            }
          />
        </View>
      </View>

      {/* Floating Bottom Cart Bar */}
      {cart.length > 0 && !showCartPage && (
        <View style={styles.floatingCartBar}>
          <TouchableOpacity style={styles.cartClearBtn} onPress={handleClearCart}>
            <Text style={styles.cartClearText}>Clear</Text>
          </TouchableOpacity>

          <View style={styles.cartBarCenter}>
            <Text style={styles.cartBarCount}>
              {cart.length} Item{cart.length > 1 ? "s" : ""}
            </Text>
            <Text style={styles.cartBarPrice}>${calculatedTotal}</Text>
          </View>

          <TouchableOpacity
            style={styles.cartViewBtn}
            onPress={() => setShowCartPage(true)}
          >
            <Text style={styles.cartViewText}>View Cart →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Cart Full-Screen View ── */}
      <Modal
        visible={showCartPage}
        animationType="slide"
        onRequestClose={() => setShowCartPage(false)}
      >
        <View style={styles.cartModalContainer}>
          {/* Scrollable Items List */}
          <ScrollView
            style={styles.cartItemsScrollView}
            contentContainerStyle={styles.cartScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {cart.map((item, index) => (
              <View key={String(index)} style={styles.cartItemRow}>
                <View style={styles.cartItemLeft}>
                  <Text style={styles.cartItemName}>{item.Name || item.name}</Text>
                  {item.selectedMods?.length > 0 && (
                    <Text style={styles.cartItemMods}>
                      {item.selectedMods.map((m: any) => m.ModifierName).join(", ")}
                    </Text>
                  )}
                </View>

                <View style={styles.cartItemCenter}>
                  {isServiceCategoryItem(item) ? (
                    <View style={styles.qtyControlsContainer}>
                      <Text style={[styles.qtyVal, { fontSize: 16, fontWeight: '700' }]}>{item.qty || 1}</Text>
                    </View>
                  ) : (
                    <View style={styles.qtyControlsContainer}>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => decreaseQty(index)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.qtyBtnText}>-</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyVal}>{item.qty || 1}</Text>
                      <TouchableOpacity
                        style={styles.qtyBtn}
                        onPress={() => increaseQty(index)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                <View style={styles.cartItemRight}>
                  <Text style={styles.cartItemPrice}>
                    ${(Number(item.Price || item.finalPrice || 0) * Number(item.qty || 1)).toFixed(2)}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Fixed Down Summary & Actions Card */}
          <View style={styles.cartBottomFixedContainer}>
            <View style={styles.cartSummaryCard}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>${subTotal.toFixed(2)}</Text>
              </View>

              {serviceCharge > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Service Charge ({serviceChargePercent}%)</Text>
                  <Text style={styles.totalValue}>${serviceCharge.toFixed(2)}</Text>
                </View>
              )}

              {gstAmount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>GST ({gstPercent}%)</Text>
                  <Text style={styles.totalValue}>${gstAmount.toFixed(2)}</Text>
                </View>
              )}

              <View style={[styles.totalRow, styles.grandTotalRow]}>
                <Text style={styles.grandTotalLabel}>Total</Text>
                <Text style={styles.grandTotalValue}>${calculatedTotal}</Text>
              </View>

              <TouchableOpacity
                style={styles.checkoutBtn}
                onPress={handleProceedToPayment}
                disabled={cart.length === 0}
                activeOpacity={0.85}
              >
                <Text style={styles.checkoutBtnText}>Checkout</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.backToMenuBtn}
                onPress={() => setShowCartPage(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.backToMenuText}>← Back to Menu</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Payment Mode Full Screen ── */}
      <Modal
        visible={showPaymentPopup}
        animationType="fade"
        onRequestClose={() => setShowPaymentPopup(false)}
      >
        <View style={styles.paymentModal}>
          <TouchableOpacity
            style={styles.paymentCloseBtn}
            onPress={() => setShowPaymentPopup(false)}
          >
            <Text style={styles.paymentCloseText}>✕</Text>
          </TouchableOpacity>

          <ScrollView
            contentContainerStyle={styles.paymentScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={styles.paymentTotal}>TOTAL: ${totalAmount}</Text>
            <Text style={styles.paymentPrompt}>Choose your payment mode</Text>

            <View style={styles.paymentOptionsRow}>
              {/* Card Payment */}
              <TouchableOpacity
                style={[styles.paymentCard, styles.cardBlue]}
                onPress={() => handlePaymodeClick("CARD")}
              >
                <Text style={styles.paymentEmoji}>💳</Text>
                <Text style={[styles.paymentModeLabel, { color: "#1d4ed8" }]}>Card</Text>
                {getExtraChargeForPaymode("CARD") > 0 && (
                  <Text style={styles.extraFeeNotice}>
                    (+${getExtraChargeForPaymode("CARD").toFixed(2)} fee)
                  </Text>
                )}
              </TouchableOpacity>

              {/* PayNow Payment */}
              <TouchableOpacity
                style={[styles.paymentCard, styles.cardPink]}
                onPress={() => handlePaymodeClick("PAYNOW")}
              >
                <Text style={styles.paymentEmoji}>📱</Text>
                <Text style={[styles.paymentModeLabel, { color: "#be185d" }]}>PayNow</Text>
                {getExtraChargeForPaymode("PAYNOW") > 0 && (
                  <Text style={styles.extraFeeNotice}>
                    (+${getExtraChargeForPaymode("PAYNOW").toFixed(2)} fee)
                  </Text>
                )}
              </TouchableOpacity>

              {/* Cash Payment */}
              <TouchableOpacity
                style={[styles.paymentCard, styles.cardGreen]}
                onPress={() => handlePaymodeClick("CASH")}
              >
                <Text style={styles.paymentEmoji}>💵</Text>
                <Text style={[styles.paymentModeLabel, { color: "#15803d" }]}>Cash</Text>
                {getExtraChargeForPaymode("CASH") > 0 && (
                  <Text style={styles.extraFeeNotice}>
                    (+${getExtraChargeForPaymode("CASH").toFixed(2)} fee)
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Extra Charge Modal ── */}
      <Modal
        visible={showExtraChargeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowExtraChargeModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.extraChargeBox}>
            <Text style={styles.extraChargeTitle}>Extra Charge Notice</Text>
            <Text style={styles.extraChargeSubtitle}>
              Paying with {pendingPaymentAction?.method} incurs a processing fee.
            </Text>

            <View style={styles.extraChargeDetails}>
              <View style={styles.chargeRow}>
                <Text style={styles.chargeLabel}>Subtotal:</Text>
                <Text style={styles.chargeVal}>${calculatedTotal}</Text>
              </View>
              <View style={styles.chargeRow}>
                <Text style={styles.chargeLabel}>Processing Fee:</Text>
                <Text style={[styles.chargeVal, { color: "#ea580c" }]}>
                  +${Number(pendingPaymentAction?.extraCharge || 0).toFixed(2)}
                </Text>
              </View>
              <View style={[styles.chargeRow, { borderTopWidth: 1, paddingTop: 8, marginTop: 4 }]}>
                <Text style={[styles.chargeLabel, { fontWeight: "800", color: "#111827" }]}>
                  Total Payable:
                </Text>
                <Text style={[styles.chargeVal, { fontWeight: "900", color: "#22c55e", fontSize: 18 }]}>
                  $
                  {(
                    Number(calculatedTotal) +
                    Number(pendingPaymentAction?.extraCharge || 0)
                  ).toFixed(2)}
                </Text>
              </View>
            </View>

            <View style={styles.extraActions}>
              <TouchableOpacity
                style={styles.extraCancelBtn}
                onPress={() => setShowExtraChargeModal(false)}
              >
                <Text style={styles.extraCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.extraConfirmBtn}
                onPress={() => {
                  const action = pendingPaymentAction;
                  setShowExtraChargeModal(false);
                  executePaymentDecision(action.method, action.extraCharge);
                }}
              >
                <Text style={styles.extraConfirmText}>Confirm & Pay</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── YeahPay Cloud POS Terminal Modal ── */}
      <Modal
        visible={showYeahPayModal}
        transparent
        animationType="fade"
        onRequestClose={async () => {
          try {
            await fetch(`${API}/yeahpay/cancel`, { method: "POST" });
          } catch { }
          setShowYeahPayModal(false);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.yeahPayModalBox}>
            {/* Terminal Status Icon */}
            <View
              style={[
                styles.yeahPayIconCircle,
                yeahPayStatus === "SUCCESS"
                  ? { backgroundColor: "#10b981" }
                  : yeahPayStatus === "FAILED"
                    ? { backgroundColor: "#ef4444" }
                    : { backgroundColor: "#3b82f6" },
              ]}
            >
              <Text style={styles.yeahPayIconText}>
                {yeahPayStatus === "SUCCESS"
                  ? "✓"
                  : yeahPayStatus === "FAILED"
                    ? "✕"
                    : "💳"}
              </Text>
            </View>

            <Text style={styles.yeahPayTitle}>YeahPay Cloud Terminal</Text>
            <Text style={styles.yeahPaySubtitle}>Thermal Buddy Gateway</Text>

            {/* Amount Box */}
            <View style={styles.yeahPayAmountBox}>
              <Text style={styles.yeahPayAmountLabel}>AMOUNT PAYABLE</Text>
              <Text style={styles.yeahPayAmountVal}>${yeahPayPayableAmount}</Text>
            </View>

            {/* Status Message */}
            <Text
              style={[
                styles.yeahPayStatusMsg,
                yeahPayStatus === "FAILED" && { color: "#ef4444" },
              ]}
            >
              {yeahPayMsg}
            </Text>

            {yeahPayStatus === "PROCESSING" && (
              <ActivityIndicator
                size="large"
                color="#3b82f6"
                style={{ marginVertical: 12 }}
              />
            )}

            {/* Transaction Details */}
            {!!yeahPayDetails && (
              <View style={styles.yeahPayDetailsBox}>
                <Text style={styles.yeahPayDetailRow}>
                  Trace ID: {yeahPayDetails.traceId || "N/A"}
                </Text>
                <Text style={styles.yeahPayDetailRow}>
                  Pay Way: {yeahPayDetails.payWay || "Card/QR"}
                </Text>
                <Text style={styles.yeahPayDetailRow}>
                  Card No: {yeahPayDetails.cardNo || "****"}
                </Text>
                <Text style={styles.yeahPayDetailRow}>
                  Ref No: {yeahPayDetails.referenceNo || "N/A"}
                </Text>
              </View>
            )}

            {/* Cancel Button */}
            <TouchableOpacity
              style={styles.yeahPayCancelBtn}
              onPress={async () => {
                try {
                  await fetch(`${API}/yeahpay/cancel`, { method: "POST" });
                } catch { }
                setShowYeahPayModal(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.yeahPayCancelText}>
                {yeahPayStatus === "SUCCESS" ? "Close" : "Cancel Payment"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Modifiers Modal ── */}
      <Modal
        visible={showModifier}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModifier(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modModalBox}>
            <View style={styles.modHeader}>
              <Text style={styles.modTitle}>{selectedDish?.Name}</Text>
              <TouchableOpacity onPress={() => setShowModifier(false)}>
                <Text style={styles.modClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modPrompt}>Choose Custom Add-ons:</Text>

            <FlatList
              data={modifiers}
              keyExtractor={(m) => String(m.ModifierID || m.ModifierId)}
              renderItem={({ item }) => {
                const isSelected = selectedModifierIds.includes(
                  String(item.ModifierID || item.ModifierId)
                );
                return (
                  <TouchableOpacity
                    style={[styles.modOption, isSelected && styles.modOptionActive]}
                    onPress={() => {
                      const id = String(item.ModifierID || item.ModifierId);
                      setSelectedModifierIds((prev) =>
                        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                      );
                    }}
                  >
                    <Text style={styles.modOptName}>{item.ModifierName}</Text>
                    <Text style={styles.modOptPrice}>
                      {Number(item.Price) > 0 ? `+$${Number(item.Price).toFixed(2)}` : "Free"}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />

            <TouchableOpacity style={styles.addModBtn} onPress={addWithModifiers}>
              <Text style={styles.addModBtnText}>Add to Cart</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Loading Modal */}
      {isCartLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.loadingOverlayText}>Processing Order...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { fontSize: 16, fontWeight: "700", color: "#6b7280" },

  topHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "android" ? 36 : 46,
    paddingBottom: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerBrand: { fontSize: 20, fontWeight: "900", color: "#111827" },
  headerBrandAccent: { color: "#f97316" },
  tableBadge: {
    backgroundColor: "#ffedd5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  tableBadgeText: { color: "#ea580c", fontWeight: "800", fontSize: 12 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  searchBar: {
    width: 160,
    height: 38,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 13,
    backgroundColor: "#f9fafb",
  },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  logoutBtnText: { color: "#ef4444", fontWeight: "700", fontSize: 13 },

  mainLayout: { flex: 1, flexDirection: "row", backgroundColor: "#f8f9fa" },
  sidebar: {
    backgroundColor: "#ffffff",
    borderRightWidth: 1,
    borderColor: "#e5e7eb",
  },
  sidebarWide: { width: 310 },
  sidebarNormal: { width: 310 },
  sidebarContent: { padding: 16, gap: 12 },

  /* Card styling from CSS (.sidebar-cat-item) */
  catCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fffdfa",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#fdf5ef",
    minHeight: 100,
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 8,
    elevation: 2,
    position: "relative",
    overflow: "hidden",
  },
  catCardActive: {
    borderColor: "#fcd3a4",
    backgroundColor: "#ffffff",
    shadowColor: "#f97316",
    shadowOpacity: 0.08,
  },
  catCardBar: {
    width: 4,
    height: 48,
    borderRadius: 4,
    backgroundColor: "#f97316",
  },
  catCardBarActive: {
    backgroundColor: "#f97316",
  },
  catIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  catIconBubbles: {
    position: "absolute",
    top: 2,
    fontSize: 9,
    color: "#ff6b1a",
    fontWeight: "900",
  },
  catIconEmoji: {
    fontSize: 26,
    marginTop: 4,
  },
  catInfoWrap: {
    flex: 1,
    justifyContent: "center",
  },
  catCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 4,
    lineHeight: 20,
  },
  catCardTitleActive: {
    color: "#1f2937",
    fontWeight: "800",
  },
  catDotRow: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
  },
  catDot: {
    width: 4,
    height: 2,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
  },
  catArrowWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#fff4ea",
    alignItems: "center",
    justifyContent: "center",
  },
  catArrowText: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "800",
    marginTop: -2,
  },

  /* Hero Banner matching CSS (.hero-banner) */
  heroBannerContainer: {
    padding: 24,
  },
  heroBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fcd3a4",
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 32,
    marginBottom: 16,
    gap: 24,
    position: "relative",
    overflow: "hidden",
    flexShrink: 0,
  },
  heroIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  heroCarEmoji: {
    fontSize: 38,
  },
  heroTextWrap: {
    flex: 1,
  },
  heroCategoryTitle: {
    fontSize: 36,
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#1e293b",
  },
  heroLogoutBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  heroLogoutIcon: {
    fontSize: 22,
    color: "#374151",
    fontWeight: "900",
  },

  contentArea: { flex: 1, padding: 16, backgroundColor: "#f8f9fa" },
  groupTabsContainer: {
    flexShrink: 0,
    marginBottom: 16,
    height: 48,
    justifyContent: "center",
  },
  groupTabsScroll: {
    flexGrow: 0,
  },
  groupsRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  groupPill: {
    height: 40,
    paddingHorizontal: 22,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#f97316",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  groupPillActive: {
    backgroundColor: "#ffffff",
    borderColor: "#f97316",
  },
  groupPillText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f97316",
    textAlign: "center",
    lineHeight: 20,
    includeFontPadding: false,
  },
  groupPillTextActive: {
    color: "#f97316",
    fontWeight: "800",
  },

  dishesFlatList: {
    flex: 1,
    width: "100%",
  },
  dishesList: { paddingTop: 2, paddingBottom: 120, paddingHorizontal: 4 },
  dishCard: {
    flex: 1,
    margin: 8,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 390,
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 25,
    elevation: 3,
  },
  dishCardInvisible: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
  dishSoldOut: { opacity: 0.5 },
  dishCardHeartWrap: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 2,
  },
  dishCardHeartIcon: {
    fontSize: 22,
    color: "#f97316",
    fontWeight: "700",
  },
  dishCircularBox: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#fff5eb",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    marginTop: 4,
    overflow: "hidden",
  },
  dishImg: { width: "100%", height: "100%", borderRadius: 55 },
  dishEmoji: { fontSize: 44 },
  soldOutBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#ff3b30",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 9999,
  },
  soldOutText: { color: "#ffffff", fontSize: 10, fontWeight: "800" },
  dishInfo: {
    width: "100%",
    alignItems: "center",
    flex: 1,
    justifyContent: "space-between",
  },
  dishName: {
    fontSize: 21,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    marginBottom: 6,
  },
  dishBulletsContainer: {
    width: "100%",
    paddingHorizontal: 4,
    marginVertical: 6,
    gap: 6,
    alignItems: "flex-start",
  },
  dishBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  dishBulletDot: {
    fontSize: 16,
    color: "#f97316",
    lineHeight: 22,
    fontWeight: "900",
  },
  dishBulletText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
    lineHeight: 22,
    flex: 1,
  },
  dishPrice: {
    fontSize: 24,
    fontWeight: "900",
    color: "#f97316",
    marginTop: 10,
    textAlign: "center",
  },
  emptyDishes: { padding: 40, alignItems: "center" },
  emptyDishesText: { color: "#9ca3af", fontSize: 15 },

  /* Floating Bottom Cart Bar (.view-cart-bar / .kiosk-floating-cart-bar) */
  floatingCartBar: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    width: "90%",
    maxWidth: 800,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#f3f4f6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 25,
    elevation: 10,
  },
  cartClearBtn: { backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  cartClearText: { color: "#ef4444", fontSize: 14, fontWeight: "700" },
  cartBarCenter: { alignItems: "center" },
  cartBarCount: { color: "#6b7280", fontSize: 13, fontWeight: "600" },
  cartBarPrice: { color: "#111827", fontSize: 20, fontWeight: "800" },
  cartViewBtn: { backgroundColor: "#f97316", paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  cartViewText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },

  /* CART MODAL - Clean, Card-Based Layout with Fixed Bottom Card */
  cartModalContainer: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  cartItemsScrollView: {
    flex: 1,
  },
  cartScrollContent: {
    paddingTop: 36,
    paddingBottom: 24,
    paddingHorizontal: 20,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  cartItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 18,
    paddingHorizontal: 28,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cartItemLeft: {
    flex: 1,
    alignItems: "flex-start",
  },
  cartItemCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cartItemRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  cartItemName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#272e3b",
    letterSpacing: -0.2,
  },
  cartItemMods: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 4,
  },
  qtyControlsContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f4f5f7",
    borderRadius: 24,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f97316",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "center",
  },
  qtyVal: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1e293b",
    paddingHorizontal: 12,
    textAlign: "center",
  },
  cartItemPrice: {
    fontSize: 17,
    fontWeight: "800",
    color: "#dc2626",
    textAlign: "right",
  },

  /* Fixed Bottom Container for Summary & Action Card */
  cartBottomFixedContainer: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    paddingTop: 8,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  cartSummaryCard: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 24,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  totalLabel: {
    fontSize: 17,
    color: "#64748b",
    fontWeight: "500",
  },
  totalValue: {
    fontSize: 17,
    fontWeight: "600",
    color: "#475569",
  },
  grandTotalRow: {
    paddingVertical: 10,
    marginTop: 2,
    marginBottom: 8,
  },
  grandTotalLabel: {
    fontSize: 21,
    fontWeight: "800",
    color: "#0f172a",
  },
  grandTotalValue: {
    fontSize: 21,
    fontWeight: "800",
    color: "#0f172a",
  },
  checkoutBtn: {
    marginTop: 12,
    height: 52,
    backgroundColor: "#f97316",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  checkoutBtnText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
  },
  backToMenuBtn: {
    marginTop: 12,
    height: 52,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
  },
  backToMenuText: {
    color: "#334155",
    fontSize: 17,
    fontWeight: "800",
  },

  /* PAYMENT FULL MODAL (.full-screen-payment) */
  paymentModal: {
    flex: 1,
    backgroundColor: "#f97316",
    padding: 24,
  },
  paymentScrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  paymentCloseBtn: { position: "absolute", top: 24, right: 24, zIndex: 10 },
  paymentCloseText: { color: "#ffffff", fontSize: 32, fontWeight: "700", opacity: 0.9 },
  paymentTotal: { fontSize: 40, fontWeight: "900", color: "#ffffff", marginBottom: 10, letterSpacing: -0.5, textAlign: "center" },
  paymentPrompt: { fontSize: 24, fontWeight: "700", color: "#ffffff", opacity: 0.95, marginBottom: 40, textAlign: "center" },
  paymentOptionsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 24, maxWidth: 840, width: "100%" },
  paymentCard: {
    width: 220,
    height: 220,
    borderRadius: 16,
    backgroundColor: "#e0f2fe",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 30,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 30,
    elevation: 6,
  },
  cardBlue: { backgroundColor: "#e0f2fe" },
  cardPink: { backgroundColor: "#fdf2f8" },
  cardGreen: { backgroundColor: "#f0fdf4" },
  paymentEmoji: { fontSize: 56 },
  paymentModeLabel: { fontSize: 18, fontWeight: "800", color: "#f97316", textAlign: "center" },
  extraFeeNotice: { fontSize: 13, color: "#ea580c", fontWeight: "700" },

  /* THANK YOU OVERLAY */
  thankYouOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#f97316",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    gap: 24,
  },
  thankYouTitle: { fontSize: 44, fontWeight: "900", color: "#ffffff" },
  thankYouCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  thankYouOrderLabel: { fontSize: 12, fontWeight: "800", color: "#ea580c" },
  thankYouOrderNumber: { fontSize: 48, fontWeight: "900", color: "#ea580c" },
  thankYouSubtitle: { fontSize: 18, fontWeight: "700", color: "#ffffff" },

  /* MODALS & OVERLAYS */
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  extraChargeBox: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 24,
    gap: 14,
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  extraChargeTitle: { fontSize: 20, fontWeight: "900", color: "#111827", textAlign: "center" },
  extraChargeSubtitle: { fontSize: 14, color: "#6b7280", textAlign: "center" },
  extraChargeDetails: { backgroundColor: "#f9fafb", borderRadius: 14, padding: 14, gap: 8 },
  chargeRow: { flexDirection: "row", justifyContent: "space-between" },
  chargeLabel: { fontSize: 14, color: "#4b5563" },
  chargeVal: { fontSize: 14, fontWeight: "700", color: "#111827" },
  extraActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  extraCancelBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  extraCancelText: { fontWeight: "700", color: "#4b5563" },
  extraConfirmBtn: { flex: 1.5, height: 48, borderRadius: 12, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  extraConfirmText: { fontWeight: "800", color: "#ffffff" },

  /* Combo/Modifier Full Customizer */
  modModalBox: { backgroundColor: "#ffffff", borderRadius: 24, padding: 24, maxHeight: "80%", width: "90%", maxWidth: 480, alignSelf: "center" },
  modHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modTitle: { fontSize: 20, fontWeight: "800", color: "#1f2937" },
  modClose: { fontSize: 20, color: "#6b7280", fontWeight: "700" },
  modPrompt: { fontSize: 14, fontWeight: "700", color: "#6b7280", marginBottom: 14 },
  modOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: "#f5f5f5",
  },
  modOptionActive: { backgroundColor: "#fff7ed", paddingHorizontal: 10, borderRadius: 8 },
  modOptName: { fontSize: 16, fontWeight: "600", color: "#333333" },
  modOptPrice: { fontSize: 15, fontWeight: "700", color: "#f97316" },
  addModBtn: {
    marginTop: 24,
    height: 54,
    backgroundColor: "#10b981",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  addModBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },

  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    zIndex: 10000,
  },
  loadingOverlayText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },

  /* YEAHPAY CLOUD TERMINAL MODAL */
  yeahPayModalBox: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 28,
    width: "100%",
    maxWidth: 440,
    alignItems: "center",
    alignSelf: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
  },
  yeahPayIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  yeahPayIconText: {
    fontSize: 28,
    color: "#ffffff",
    fontWeight: "900",
  },
  yeahPayTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0f172a",
    marginBottom: 2,
    textAlign: "center",
  },
  yeahPaySubtitle: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "600",
    marginBottom: 16,
    textAlign: "center",
  },
  yeahPayAmountBox: {
    width: "100%",
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    marginBottom: 14,
  },
  yeahPayAmountLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.8,
  },
  yeahPayAmountVal: {
    fontSize: 28,
    fontWeight: "900",
    color: "#0f172a",
    marginTop: 2,
  },
  yeahPayStatusMsg: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  yeahPayDetailsBox: {
    width: "100%",
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    padding: 12,
    marginVertical: 10,
    gap: 4,
  },
  yeahPayDetailRow: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
  },
  yeahPayCancelBtn: {
    width: "100%",
    height: 48,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  yeahPayCancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#475569",
  },
});
