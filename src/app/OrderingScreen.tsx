import { API } from "@/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
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

  if (trimmed.includes("|")) {
    return trimmed
      .split("|")
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
  const isWide = screenWidth >= 600;
  // Always 2 columns on tablet/kiosk screen to match reference layout (2 packages per row)
  const numColumns = 2;

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
  const [enableCombo, setEnableCombo] = useState<number>(0);

  // Kiosk Session Info
  const [tableNo, setTableNo] = useState("");
  const [tableId, setTableId] = useState("");
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [enableKioskTable, setEnableKioskTable] = useState<number>(0);
  const [showTableModal, setShowTableModal] = useState(false);
  const [availableTables, setAvailableTables] = useState<any[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);

  // Modifiers Modal State
  const [showModifier, setShowModifier] = useState(false);
  const [selectedDish, setSelectedDish] = useState<any>(null);
  const [modifiers, setModifiers] = useState<any[]>([]);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [comboQty, setComboQty] = useState(1);

  // Combo Customizer States
  const [showComboCustomizer, setShowComboCustomizer] = useState(false);
  const [comboConfig, setComboConfig] = useState<any>(null);
  const [comboSelections, setComboSelections] = useState<{ [groupId: string]: any[] }>({});
  const [comboError, setComboError] = useState<string | null>(null);
  const [comboLoading, setComboLoading] = useState(false);
  const [comboDishModifiers, setComboDishModifiers] = useState<any[]>([]);
  const [selectedComboModifierIds, setSelectedComboModifierIds] = useState<string[]>([]);

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
          selectedMods:
            item.modifiers ||
            (item.ModifiersJSON
              ? (() => {
                  try {
                    return JSON.parse(item.ModifiersJSON);
                  } catch {
                    return [];
                  }
                })()
              : []),
          comboSelections:
            item.comboSelections ||
            (item.ComboDetailsJSON
              ? (() => {
                  try {
                    return JSON.parse(item.ComboDetailsJSON);
                  } catch {
                    return [];
                  }
                })()
              : []),
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
          setEnableCombo(Number(settingsRes.EnableCombo || 0));
          const isKioskTableEnabled =
            settingsRes.Enablekiosktable === 1 ||
            settingsRes.Enablekiosktable === true ||
            String(settingsRes.Enablekiosktable) === "1" ||
            String(settingsRes.Enablekiosktable).toLowerCase() === "true"
              ? 1
              : 0;
          setEnableKioskTable(isKioskTableEnabled);
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

  // Open Combo Customizer or Modifiers or Add Direct
  const handleDishClick = async (dish: any) => {
    if (dish.IsSoldOut) return;

    if (Number(enableCombo) === 1 && Number(dish.IsCombo) === 1) {
      await openComboCustomizer(dish);
      return;
    }

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

  const openComboCustomizer = async (dish: any) => {
    setSelectedDish(dish);
    setComboLoading(true);
    setComboError(null);
    setComboSelections({});
    setComboDishModifiers([]);
    setSelectedComboModifierIds([]);
    setComboQty(1);
    setShowComboCustomizer(true);

    try {
      const [res, modRes] = await Promise.all([
        fetch(`${API}/combo/config/${dish.DishId}`),
        fetch(`${API}/modifiers/${dish.DishId}`).catch(() => null),
      ]);

      if (modRes && modRes.ok) {
        const modData = await modRes.json();
        if (Array.isArray(modData)) {
          setComboDishModifiers(modData);
        }
      }

      if (!res.ok) throw new Error("Failed to load combo options.");
      const payload = await res.json();
      if (payload.success && payload.data) {
        const config = payload.data;
        setComboConfig(config);

        // Auto-select defaults
        const initialSelections: { [groupId: string]: any[] } = {};
        (config.groups || []).forEach((group: any) => {
          let defaults = (group.options || [])
            .filter((o: any) => o.isDefault)
            .map((o: any) => o.dishId);
          if (!group.isMultiSelect || group.maxSelection === 1) {
            defaults = defaults.slice(0, 1);
          }
          if (
            defaults.length === 0 &&
            group.minSelection > 0 &&
            group.options &&
            group.options.length > 0
          ) {
            defaults = [group.options[0].dishId];
          }
          initialSelections[group.comboGroupId] = defaults;
        });
        setComboSelections(initialSelections);
      } else {
        throw new Error(payload.error || "Failed to load combo config.");
      }
    } catch (err: any) {
      console.error("Combo config fetch error:", err);
      setComboError(err.message || "Something went wrong.");
    } finally {
      setComboLoading(false);
    }
  };

  const handleSelectComboOption = (
    groupId: string,
    option: any,
    isMulti: boolean,
    maxSelect: number
  ) => {
    setComboError(null);
    setComboSelections((prev) => {
      const current = prev[groupId] || [];
      if (current.includes(option.dishId)) {
        return {
          ...prev,
          [groupId]: current.filter((id) => id !== option.dishId),
        };
      } else {
        if (isMulti) {
          if (current.length >= maxSelect) {
            return prev;
          }
          return {
            ...prev,
            [groupId]: [...current, option.dishId],
          };
        } else {
          return {
            ...prev,
            [groupId]: [option.dishId],
          };
        }
      }
    });
  };

  const handleToggleComboModifier = (modId: string) => {
    setSelectedComboModifierIds((prev) =>
      prev.includes(modId) ? prev.filter((id) => id !== modId) : [...prev, modId]
    );
  };

  const calculateComboTotal = () => {
    if (!comboConfig && !selectedDish) return 0;

    let totalSurcharge = 0;
    (comboConfig?.groups || []).forEach((group: any) => {
      const selectedIds = comboSelections[group.comboGroupId] || [];
      const selectedOptions = (group.options || []).filter((o: any) =>
        selectedIds.includes(o.dishId)
      );
      selectedOptions.forEach((opt: any) => {
        totalSurcharge +=
          (Number(opt.surcharge) || 0) + (Number(opt.dishPrice) || 0);
      });
    });

    const chosenModifiers = comboDishModifiers.filter((m: any) =>
      selectedComboModifierIds.includes(String(m.ModifierID || m.ModifierId || ""))
    );
    const modifierPriceTotal = chosenModifiers.reduce(
      (sum: number, m: any) => sum + (Number(m.Price) || 0),
      0
    );

    const basePrice = Number(
      comboConfig?.basePrice || selectedDish?.Price || selectedDish?.price || 0
    );

    return basePrice + totalSurcharge + modifierPriceTotal;
  };

  const handleAddComboToCart = () => {
    if (!comboConfig || !selectedDish) return;

    // Validate minimum selections
    for (const group of comboConfig.groups) {
      const selectedIds = comboSelections[group.comboGroupId] || [];
      const effectiveMin =
        group.options && group.options.length > 0 ? group.minSelection : 0;
      if (selectedIds.length < effectiveMin) {
        setComboError(
          `Please pick at least ${group.minSelection} choice(s) for "${group.groupName}"`
        );
        return;
      }
    }

    // Build selected modifiers list
    const chosenModifiers = comboDishModifiers
      .filter((m: any) =>
        selectedComboModifierIds.includes(String(m.ModifierID || m.ModifierId || ""))
      )
      .map((m: any) => ({
        ModifierID: String(m.ModifierID || m.ModifierId || ""),
        ModifierName: m.ModifierName,
        Price: Number(m.Price || 0),
        qty: 1,
      }));

    // Build the selection details payload
    const chosenSelections = comboConfig.groups.map((group: any) => {
      const selectedIds = comboSelections[group.comboGroupId] || [];
      const selectedOptions = (group.options || []).filter((o: any) =>
        selectedIds.includes(o.dishId)
      );
      return {
        groupId: group.comboGroupId,
        groupName: group.groupName,
        items: selectedOptions.map((o: any) => ({
          dishId: o.dishId,
          name: o.name,
          surcharge: o.surcharge,
          dishPrice: o.dishPrice || 0,
          KitchenTypeCode: o.KitchenTypeCode,
          KitchenTypeName: o.KitchenTypeName,
          PrinterIP: o.PrinterIP,
        })),
      };
    });

    // Sum surcharges and dish prices
    let totalSurcharge = 0;
    chosenSelections.forEach((grp: any) => {
      grp.items.forEach((opt: any) => {
        totalSurcharge +=
          (Number(opt.surcharge) || 0) + (Number(opt.dishPrice) || 0);
      });
    });

    const modifierPriceTotal = chosenModifiers.reduce(
      (sum: number, m: any) => sum + (Number(m.Price) || 0),
      0
    );

    const comboBasePrice = Number(comboConfig.basePrice);
    const dishBasePrice = Number(
      selectedDish?.Price ?? selectedDish?.price ?? 0
    );

    const finalPrice =
      (comboBasePrice > 0 ? comboBasePrice : dishBasePrice) +
      totalSurcharge +
      modifierPriceTotal;

    const newCartItem = {
      ...selectedDish,
      DishId: selectedDish.DishId || selectedDish.id,
      Name: selectedDish.Name || selectedDish.name,
      qty: comboQty,
      isCombo: true,
      price: finalPrice,
      Price: finalPrice,
      finalPrice: finalPrice,
      basePrice: comboConfig.basePrice,
      comboSelections: chosenSelections,
      selectedMods: chosenModifiers,
      modifiers: chosenModifiers,
      status: "NEW",
    };

    setCart((prev) => {
      const existing = prev.find(
        (item) =>
          (item.DishId || item.id) === (selectedDish.DishId || selectedDish.id) &&
          (item.comboSelections || []).length === 0 &&
          JSON.stringify(item.selectedMods || []) ===
            JSON.stringify(chosenModifiers) &&
          item.status !== "SENT"
      );

      if (existing) {
        return prev.map((item) =>
          item === existing
            ? {
                ...item,
                qty: (item.qty || 1) + comboQty,
                status: "NEW",
              }
            : item
        );
      }

      return [...prev, newCartItem];
    });

    setShowComboCustomizer(false);
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
          id: dish.DishId,
          Name: dish.Name,
          name: dish.Name,
          dishName: dish.Name,
          qty: 1,
          Price: basePrice,
          price: basePrice,
          finalPrice: basePrice,
          selectedMods: [],
          comboSelections: [],
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
        id: selectedDish.DishId,
        Name: selectedDish.Name,
        name: selectedDish.Name,
        dishName: selectedDish.Name,
        qty: comboQty,
        Price: finalPrice,
        price: finalPrice,
        finalPrice: finalPrice,
        selectedMods: chosenMods,
        comboSelections: [],
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

  // Fetch available tables from TableMaster
  const fetchAvailableTables = async () => {
    setLoadingTables(true);
    try {
      const res = await fetch(`${API}/order/kiosk/available-tables`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.tables)) {
        setAvailableTables(data.tables);
      } else {
        setAvailableTables([]);
      }
    } catch (e) {
      console.warn("Error fetching available tables:", e);
      setAvailableTables([]);
    } finally {
      setLoadingTables(false);
    }
  };

  // Checkout button click handler
  const handleCheckoutClick = async () => {
    // Dynamically check latest Enablekiosktable from AppSettings
    let shouldPromptTable = enableKioskTable === 1;
    try {
      const checkRes = await fetch(`${API}/app-settings`).then((r) => r.json()).catch(() => null);
      if (checkRes && checkRes.success !== undefined) {
        const val = checkRes.Enablekiosktable ?? checkRes.enablekiosktable;
        shouldPromptTable = (val === 1 || val === true || String(val) === "1" || String(val).toLowerCase() === "true");
        setEnableKioskTable(shouldPromptTable ? 1 : 0);
      }
    } catch (_) {}

    if (shouldPromptTable) {
      // If Enablekiosktable = 1, show table selection modal
      fetchAvailableTables();
      setShowTableModal(true);
    } else {
      // If Enablekiosktable = 0, continue directly with existing checkout process
      handleProceedToPayment();
    }
  };

  // User selects a table and continues existing checkout process
  const handleSelectTableAndContinue = async (selectedTbl: any) => {
    const selectedNo = selectedTbl.TableNo || selectedTbl.TableNumber || "";
    const selectedId = selectedTbl.TableId || "";

    setTableNo(String(selectedNo).trim());
    setTableId(String(selectedId).trim());

    try {
      await AsyncStorage.setItem("tableNo", String(selectedNo).trim());
      await AsyncStorage.setItem("tableId", String(selectedId).trim());
    } catch (_) {}

    setShowTableModal(false);
    // Continue with existing checkout process with updated table
    handleProceedToPayment(String(selectedId).trim());
  };

  // Checkout / Place Order Flow
  const handleProceedToPayment = async (overrideTableId?: string) => {
    console.log("Cart items:", cart);
    console.log("Subtotal:", subTotal);
    console.log("Calculated Total:", calculatedTotal);
    setTotalAmount(calculatedTotal);

    const activeTableId = overrideTableId || tableId || "TAKEAWAY";

    // Save cart items to database (RestaurantOrderCur & RestaurantOrderDetailCur) immediately
    if (cart.length > 0) {
      try {
        const orderId = currentOrderId || (await AsyncStorage.getItem("kioskOrderId"));
        await fetch(`${API}/order/save-cart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId: activeTableId,
            orderId: orderId,
            items: cart,
            userId: "00000000-0000-0000-0000-000000000000",
          }),
        });
        console.log("✅ [Checkout] Cart synced to RestaurantOrderDetailCur");
      } catch (err) {
        console.warn("⚠️ [Checkout] Cart sync error:", err);
      }
    }

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
      setIsCartLoading(false);
      setShowCartPage(false);
      setCart([]);

      // Clear session
      await AsyncStorage.multiRemove([
        "kioskOrderId",
        "kioskOrderType",
        "kioskCarNumber",
        "kioskCustomerName",
        "kioskCustomerVehicleId",
        "kioskDefaultDishId",
      ]);

      if (onOrderCompleted) {
        onOrderCompleted(completedId);
      }
    } catch (err: any) {
      setIsCartLoading(false);
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
      {/* ── Main Layout: Sidebar & Content ── */}
      <View style={styles.mainLayout}>
        {/* Categories Sidebar */}
        <View style={styles.sidebar}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sidebarContent}>
            {categories.map((cat) => {
              const isActive = activeCategory === cat.CategoryId;
              return (
                <TouchableOpacity
                  key={cat.CategoryId}
                  style={[
                    styles.catCard,
                    isActive && styles.catCardActive,
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
                  {/* Left orange accent bar */}
                  <View
                    style={[
                      styles.catCardBar,
                      isActive && styles.catCardBarActive,
                    ]}
                  />

                  {/* Car Icon with bubbles */}
                  <View style={styles.catIconWrap}>
                    <Text style={styles.catIconBubbles}>° °</Text>
                    <Text style={styles.catIconEmoji}>🚗</Text>
                  </View>

                  {/* Info: Title & 3 dashed dots */}
                  <View style={styles.catInfoWrap}>
                    <Text
                      style={[
                        styles.catCardTitle,
                        isActive && styles.catCardTitleActive,
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

                  {/* Right chevron arrow circle */}
                  <View style={styles.catArrowWrap}>
                    <Text style={styles.catArrowText}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Content Area */}
        <View style={styles.contentArea}>
          {/* Hero Banner matching reference design */}
          <View style={styles.heroBanner}>
            <View style={styles.heroIconCircle}>
              <Text style={styles.heroCarEmoji}>🚗</Text>
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroCategoryTitle}>
                {categories.find((c) => c.CategoryId === activeCategory)?.KitchenTypeName || "Sedan"}
              </Text>
              <Text style={styles.heroSubtitle}>Choose a package for your vehicle</Text>
            </View>
            <TouchableOpacity
              style={styles.heroMoreBtn}
              onPress={onLogout}
              activeOpacity={0.8}
            >
              <Ionicons name="log-out-outline" size={20} color="#ea580c" style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          </View>

          {/* Group Tabs Row (hidden if only 1 generic group) */}
          {groups.length > 1 && (
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

              const dishQty = cart
                .filter((c: any) => (c.DishId || c.id) === (item.DishId || item.id))
                .reduce((sum: number, c: any) => sum + (c.qty || 1), 0);

              return (
                <TouchableOpacity
                  style={[styles.dishCard, item.IsSoldOut && styles.dishSoldOut]}
                  onPress={() => handleDishClick(item)}
                  activeOpacity={0.88}
                >
                  {/* Top Right Badge: Shows quantity (e.g. 1) if added to cart, otherwise heart outline */}
                  {dishQty > 0 ? (
                    <View style={styles.dishCardQtyBadge}>
                      <Text style={styles.dishCardQtyBadgeText}>{dishQty}</Text>
                    </View>
                  ) : (
                    <View style={styles.dishCardHeartWrap}>
                      <Text style={styles.dishCardHeartIcon}>♡</Text>
                    </View>
                  )}

                  {/* Circular dish image matching reference design */}
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
                    <View style={styles.dishTopContent}>
                      <Text style={styles.dishName} numberOfLines={2}>
                        {item.Name}
                      </Text>

                      {/* Bullet Points Description with Orange Check Mark badge */}
                      <View style={styles.dishBulletsContainer}>
                        {parseDescriptionBullets(
                          item.Description || "Wash + Vacuum + Tyre Shine"
                        ).map((bullet, idx) => (
                          <View key={idx} style={styles.dishBulletRow}>
                            <View style={styles.checkBadge}>
                              <Text style={styles.checkBadgeIcon}>✓</Text>
                            </View>
                            <Text style={styles.dishBulletText}>
                              {bullet}
                            </Text>
                          </View>
                        ))}
                      </View>
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
                  {item.comboSelections?.length > 0 && (
                    <View style={styles.comboSelectionsCartBox}>
                      {item.comboSelections.map((grp: any, gIdx: number) => (
                        <View key={gIdx} style={{ marginTop: 3 }}>
                          <Text style={styles.comboGroupNameCart}>{grp.groupName}:</Text>
                          {(grp.items || []).map((opt: any, oIdx: number) => (
                            <Text key={oIdx} style={styles.comboItemNameCart}>
                              ↳ {opt.name}
                              {(Number(opt.surcharge || 0) + Number(opt.dishPrice || 0)) > 0
                                ? ` (+${(Number(opt.surcharge || 0) + Number(opt.dishPrice || 0)).toFixed(2)})`
                                : ""}
                            </Text>
                          ))}
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View style={styles.cartItemCenter}>
                  <View style={styles.qtyControlsContainer}>
                    <Text style={[styles.qtyVal, { fontSize: 16, fontWeight: '700' }]}>{item.qty || 1}</Text>
                  </View>
                </View>

                <View style={styles.cartItemRight}>
                  <Text style={styles.cartItemPrice}>
                    ${(Number(item.Price || item.finalPrice || 0) * Number(item.qty || 1)).toFixed(2)}
                  </Text>
                  <TouchableOpacity
                    style={styles.cartItemDeleteBtn}
                    onPress={() => decreaseQty(index)}
                    hitSlop={8}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={19} color="#ef4444" />
                  </TouchableOpacity>
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
                onPress={handleCheckoutClick}
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

      {/* ── Table Selection Modal (Enablekiosktable = 1) ── */}
      <Modal
        visible={showTableModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowTableModal(false)}
      >
        <View style={styles.tableModalOverlay}>
          <View style={styles.tableModalContainer}>
            <View style={styles.tableModalHeader}>
              <View>
                <Text style={styles.tableModalTitle}>Select Your Table</Text>
                <Text style={styles.tableModalSubtitle}>
                  Please choose an available table to proceed with checkout
                </Text>
              </View>
              <TouchableOpacity
                style={styles.tableModalCloseBtn}
                onPress={() => setShowTableModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.tableModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingTables ? (
              <View style={styles.tableLoadingContainer}>
                <ActivityIndicator size="large" color="#f97316" />
                <Text style={styles.tableLoadingText}>Loading available tables...</Text>
              </View>
            ) : availableTables.length === 0 ? (
              <View style={styles.tableEmptyContainer}>
                <Text style={styles.tableEmptyText}>No available tables found.</Text>
                <TouchableOpacity
                  style={styles.tableContinueAnywayBtn}
                  onPress={() => {
                    setShowTableModal(false);
                    handleProceedToPayment();
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.tableContinueAnywayText}>Continue Without Table</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.tableGrid}
                showsVerticalScrollIndicator={false}
              >
                {availableTables.map((tbl: any) => {
                  const tNum = tbl.TableNo || tbl.TableNumber || "";
                  const isSelected = String(tableNo).trim() === String(tNum).trim();
                  return (
                    <TouchableOpacity
                      key={String(tbl.TableId || tNum)}
                      style={[
                        styles.tableCard,
                        isSelected && styles.tableCardSelected,
                      ]}
                      onPress={() => handleSelectTableAndContinue(tbl)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.tableIconWrapper}>
                        <Text style={styles.tableIcon}>🍽️</Text>
                      </View>
                      <Text style={[styles.tableCardNumber, isSelected && styles.tableCardNumberSelected]}>
                        Table {tNum}
                      </Text>
                      {tbl.Seats ? (
                        <Text style={styles.tableCardSeats}>
                          {tbl.Seats} Seats
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.tableModalFooter}>
              <TouchableOpacity
                style={styles.tableCancelBtn}
                onPress={() => setShowTableModal(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.tableCancelBtnText}>Cancel</Text>
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

      {/* ── Combo Customizer Full-Screen Modal ── */}
      <Modal
        visible={showComboCustomizer && !!selectedDish}
        animationType="slide"
        onRequestClose={() => setShowComboCustomizer(false)}
      >
        <View style={styles.comboFullScreenContainer}>
          {/* Close Header */}
          <View style={styles.comboHeaderBar}>
            <TouchableOpacity
              style={styles.comboCloseBtn}
              onPress={() => setShowComboCustomizer(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.comboCloseBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.comboScrollView}
            contentContainerStyle={styles.comboScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Dish Header Image / Placeholder */}
            <View style={styles.comboHeroImgBox}>
              {selectedDish?.Image ? (
                <Image
                  source={{ uri: `${API}/image/${selectedDish.Image}` }}
                  style={styles.comboHeroImg}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.comboHeroPlaceholder}>
                  <Text style={{ fontSize: 48 }}>🚗</Text>
                </View>
              )}
            </View>

            {/* Dish Info */}
            <View style={styles.comboDishInfoBox}>
              <Text style={styles.comboDishTitle}>
                {selectedDish?.Name || selectedDish?.name}
              </Text>
              <Text style={styles.comboDishPrice}>
                $
                {Number(
                  selectedDish?.Price || selectedDish?.price || 0
                ).toFixed(2)}
              </Text>
              {!!selectedDish?.Description && (
                <View style={styles.comboDishBulletsWrap}>
                  {parseDescriptionBullets(selectedDish.Description).map((bullet, idx) => (
                    <View key={idx} style={styles.comboDishBulletRow}>
                      <View style={styles.comboCheckBadge}>
                        <Text style={styles.comboCheckBadgeIcon}>✓</Text>
                      </View>
                      <Text style={styles.comboDishBulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Combo Groups & Options */}
            {comboLoading ? (
              <View style={styles.comboLoadingBox}>
                <ActivityIndicator size="large" color="#f97316" />
                <Text style={styles.comboLoadingText}>Loading options...</Text>
              </View>
            ) : comboError && !comboConfig ? (
              <View style={styles.comboErrorBox}>
                <Text style={styles.comboErrorText}>{comboError}</Text>
                <TouchableOpacity
                  style={styles.comboRetryBtn}
                  onPress={() => openComboCustomizer(selectedDish)}
                >
                  <Text style={styles.comboRetryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.comboGroupsContainer}>
                {(comboConfig?.groups || []).map((group: any) => {
                  const selectedIds = comboSelections[group.comboGroupId] || [];
                  return (
                    <View key={group.comboGroupId} style={styles.comboGroupCard}>
                      <View style={styles.comboGroupHeader}>
                        <Text style={styles.comboGroupName}>{group.groupName}</Text>
                        <Text style={styles.comboGroupPickBadge}>
                          Select{" "}
                          {group.minSelection === group.maxSelection
                            ? group.minSelection
                            : `${group.minSelection} to ${group.maxSelection}`}
                        </Text>
                      </View>

                      <View style={styles.comboOptionsGrid}>
                        {(group.options || []).map((opt: any) => {
                          const isSelected = selectedIds.includes(opt.dishId);
                          const totalOptSurcharge =
                            (Number(opt.surcharge) || 0) +
                            (Number(opt.dishPrice) || 0);

                          return (
                            <TouchableOpacity
                              key={opt.mappingId || opt.dishId}
                              style={[
                                styles.comboOptionRow,
                                isSelected && styles.comboOptionRowSelected,
                              ]}
                              onPress={() =>
                                handleSelectComboOption(
                                  group.comboGroupId,
                                  opt,
                                  group.isMultiSelect,
                                  group.maxSelection
                                )
                              }
                              activeOpacity={0.8}
                            >
                              <View
                                style={[
                                  styles.comboRadioCircle,
                                  isSelected && styles.comboRadioCircleSelected,
                                ]}
                              >
                                {isSelected && (
                                  <View style={styles.comboRadioDot} />
                                )}
                              </View>

                              <View style={styles.comboOptInfo}>
                                <Text
                                  style={[
                                    styles.comboOptName,
                                    isSelected && styles.comboOptNameSelected,
                                  ]}
                                  numberOfLines={2}
                                >
                                  {opt.name}
                                </Text>
                                <Text style={styles.comboOptPrice}>
                                  {totalOptSurcharge > 0
                                    ? `+$${totalOptSurcharge.toFixed(2)}`
                                    : "$0.00"}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}

                {/* Optional Modifiers for this Combo Dish */}
                {comboDishModifiers.length > 0 && (
                  <View style={styles.comboGroupCard}>
                    <View style={styles.comboGroupHeader}>
                      <Text style={styles.comboGroupName}>
                        Modifiers (Optional)
                      </Text>
                    </View>

                    <View style={styles.comboOptionsGrid}>
                      {comboDishModifiers.map((m: any) => {
                        const mId = String(m.ModifierID || m.ModifierId || "");
                        const isSelected = selectedComboModifierIds.includes(mId);
                        return (
                          <TouchableOpacity
                            key={mId}
                            style={[
                              styles.comboOptionRow,
                              isSelected && styles.comboOptionRowSelected,
                            ]}
                            onPress={() => handleToggleComboModifier(mId)}
                            activeOpacity={0.8}
                          >
                            <View
                              style={[
                                styles.comboCheckboxSquare,
                                isSelected && styles.comboCheckboxSquareSelected,
                              ]}
                            >
                              {isSelected && (
                                <Text style={styles.comboCheckmark}>✓</Text>
                              )}
                            </View>

                            <View style={styles.comboOptInfo}>
                              <Text
                                style={[
                                  styles.comboOptName,
                                  isSelected && styles.comboOptNameSelected,
                                ]}
                                numberOfLines={2}
                              >
                                {m.ModifierName}
                              </Text>
                              <Text style={styles.comboOptPrice}>
                                {Number(m.Price) > 0
                                  ? `+$${Number(m.Price).toFixed(2)}`
                                  : "$0.00"}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {!!comboError && (
                  <View style={styles.comboInlineErrorBox}>
                    <Text style={styles.comboInlineErrorText}>{comboError}</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Fixed Bottom Bar */}
          <View style={styles.comboFixedBottomBar}>
            <View style={styles.comboQtyControls}>
              <TouchableOpacity
                style={styles.comboQtyBtn}
                onPress={() => setComboQty(Math.max(1, comboQty - 1))}
              >
                <Text style={styles.comboQtyBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.comboQtyVal}>{comboQty}</Text>
              <TouchableOpacity
                style={styles.comboQtyBtn}
                onPress={() => setComboQty(comboQty + 1)}
              >
                <Text style={styles.comboQtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.comboAddCartBtn}
              onPress={handleAddComboToCart}
              activeOpacity={0.85}
            >
              <Text style={styles.comboAddCartBtnText}>
                Add to Cart ${(calculateComboTotal() * comboQty).toFixed(2)}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Modifiers Modal (Full-Screen Design matching Combo Page) ── */}
      <Modal
        visible={showModifier && !!selectedDish}
        animationType="slide"
        onRequestClose={() => setShowModifier(false)}
      >
        <View style={styles.comboFullScreenContainer}>
          {/* Close Header */}
          <View style={styles.comboHeaderBar}>
            <TouchableOpacity
              style={styles.comboCloseBtn}
              onPress={() => setShowModifier(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.comboCloseBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.comboScrollView}
            contentContainerStyle={styles.comboScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Dish Header Image / Placeholder */}
            <View style={styles.comboHeroImgBox}>
              {selectedDish?.Image ? (
                <Image
                  source={{ uri: `${API}/image/${selectedDish.Image}` }}
                  style={styles.comboHeroImg}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.comboHeroPlaceholder}>
                  <Text style={{ fontSize: 48 }}>🍽️</Text>
                </View>
              )}
            </View>

            {/* Dish Info */}
            <View style={styles.comboDishInfoBox}>
              <Text style={styles.comboDishTitle}>
                {selectedDish?.Name || selectedDish?.name}
              </Text>
              <Text style={styles.comboDishPrice}>
                $
                {Number(
                  selectedDish?.Price || selectedDish?.price || 0
                ).toFixed(2)}
              </Text>
              {!!selectedDish?.Description && (
                <View style={styles.comboDishBulletsWrap}>
                  {parseDescriptionBullets(selectedDish.Description).map((bullet, idx) => (
                    <View key={idx} style={styles.comboDishBulletRow}>
                      <View style={styles.comboCheckBadge}>
                        <Text style={styles.comboCheckBadgeIcon}>✓</Text>
                      </View>
                      <Text style={styles.comboDishBulletText}>{bullet}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Modifiers Selection Group */}
            <View style={styles.comboGroupsContainer}>
              <View style={styles.comboGroupCard}>
                <View style={styles.comboGroupHeader}>
                  <Text style={styles.comboGroupName}>
                    Choose Custom Add-ons
                  </Text>
                  <Text style={styles.comboGroupPickBadge}>Optional</Text>
                </View>

                <View style={styles.comboOptionsGrid}>
                  {modifiers.map((item) => {
                    const id = String(item.ModifierID || item.ModifierId);
                    const isSelected = selectedModifierIds.includes(id);
                    const priceNum = Number(item.Price || 0);

                    return (
                      <TouchableOpacity
                        key={id}
                        style={[
                          styles.comboOptionRow,
                          isSelected && styles.comboOptionRowSelected,
                        ]}
                        onPress={() => {
                          setSelectedModifierIds((prev) =>
                            prev.includes(id)
                              ? prev.filter((x) => x !== id)
                              : [...prev, id]
                          );
                        }}
                        activeOpacity={0.8}
                      >
                        <View
                          style={[
                            styles.comboCheckboxSquare,
                            isSelected && styles.comboCheckboxSquareSelected,
                          ]}
                        >
                          {isSelected && (
                            <Text style={styles.comboCheckmark}>✓</Text>
                          )}
                        </View>

                        <View style={styles.comboOptInfo}>
                          <Text
                            style={[
                              styles.comboOptName,
                              isSelected && styles.comboOptNameSelected,
                            ]}
                            numberOfLines={2}
                          >
                            {item.ModifierName}
                          </Text>
                          <Text style={styles.comboOptPrice}>
                            {priceNum > 0 ? `+$${priceNum.toFixed(2)}` : "$0.00"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Fixed Bottom Bar */}
          <View style={styles.comboFixedBottomBar}>
            <View style={styles.comboQtyControls}>
              <TouchableOpacity
                style={styles.comboQtyBtn}
                onPress={() => setComboQty(Math.max(1, comboQty - 1))}
              >
                <Text style={styles.comboQtyBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.comboQtyVal}>{comboQty}</Text>
              <TouchableOpacity
                style={styles.comboQtyBtn}
                onPress={() => setComboQty(comboQty + 1)}
              >
                <Text style={styles.comboQtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {(() => {
              const chosenMods = modifiers.filter((m) =>
                selectedModifierIds.includes(String(m.ModifierID || m.ModifierId))
              );
              const extra = chosenMods.reduce(
                (s, m) => s + Number(m.Price || 0),
                0
              );
              const unitPrice =
                Number(selectedDish?.Price || selectedDish?.price || 0) + extra;
              const totalPrice = (unitPrice * comboQty).toFixed(2);

              return (
                <TouchableOpacity
                  style={styles.comboAddCartBtn}
                  onPress={addWithModifiers}
                  activeOpacity={0.85}
                >
                  <Text style={styles.comboAddCartBtnText}>
                    Add to Cart ${totalPrice}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Loading Modal */}
      <Modal
        visible={isCartLoading}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.loadingOverlayText}>Processing Order...</Text>
        </View>
      </Modal>
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

  mainLayout: { flex: 1, flexDirection: "row", backgroundColor: "#f3f7fd" },
  sidebar: {
    width: 280,
    backgroundColor: "#ffffff",
    borderRightWidth: 1,
    borderColor: "#eef2f6",
  },
  sidebarContent: { paddingVertical: 18, paddingHorizontal: 14, gap: 14 },

  /* Card styling matching the reference image */
  catCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fffdfa",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#fdf2e9",
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 8,
    elevation: 2,
    position: "relative",
    overflow: "hidden",
  },
  catCardActive: {
    borderColor: "#ffcca2",
    backgroundColor: "#ffffff",
    shadowColor: "#f97316",
    shadowOpacity: 0.08,
  },
  catCardBar: {
    width: 4,
    height: 48,
    borderRadius: 4,
    backgroundColor: "transparent",
  },
  catCardBarActive: {
    backgroundColor: "#f97316",
  },
  catIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  catIconBubbles: {
    position: "absolute",
    top: 0,
    fontSize: 10,
    color: "#f97316",
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
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 6,
    lineHeight: 20,
  },
  catCardTitleActive: {
    color: "#0f172a",
    fontWeight: "900",
  },
  catDotRow: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
  },
  catDot: {
    width: 6,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#cbd5e1",
  },
  catArrowWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  catArrowText: {
    fontSize: 15,
    color: "#94a3b8",
    fontWeight: "800",
    marginTop: -2,
  },

  /* Hero Banner matching image */
  heroBannerContainer: {
    padding: 0,
  },
  heroBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffcca2",
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 22,
    marginBottom: 18,
    gap: 16,
    position: "relative",
    overflow: "hidden",
    flexShrink: 0,
  },
  heroIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  heroCarEmoji: {
    fontSize: 32,
  },
  heroTextWrap: {
    flex: 1,
  },
  heroCategoryTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  heroSubtitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#334155",
  },
  heroMoreBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  heroMoreDots: {
    fontSize: 18,
    color: "#2563eb",
    fontWeight: "900",
    letterSpacing: -1,
  },

  contentArea: { flex: 1, padding: 18, backgroundColor: "#f3f7fd" },
  groupTabsContainer: {
    flexShrink: 0,
    marginBottom: 16,
    height: 44,
    justifyContent: "center",
  },
  groupTabsScroll: {
    flexGrow: 0,
  },
  groupsRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  groupPill: {
    height: 38,
    paddingHorizontal: 20,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  groupPillActive: {
    backgroundColor: "#ffedd5",
    borderColor: "#f97316",
  },
  groupPillText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748b",
  },
  groupPillTextActive: {
    color: "#ea580c",
    fontWeight: "800",
  },

  dishesFlatList: {
    flex: 1,
    width: "100%",
  },
  dishesList: { paddingTop: 2, paddingBottom: 110, paddingHorizontal: 2 },
  dishCard: {
    flex: 1,
    margin: 10,
    backgroundColor: "#ffffff",
    borderRadius: 28,
    paddingVertical: 26,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "flex-start",
    position: "relative",
    shadowColor: "#64748b",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
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
    top: 18,
    right: 20,
    zIndex: 2,
  },
  dishCardHeartIcon: {
    fontSize: 24,
    color: "#ef4444",
    fontWeight: "600",
  },
  dishCardQtyBadge: {
    position: "absolute",
    top: 16,
    right: 18,
    zIndex: 5,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#ff641f",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    shadowColor: "#ff641f",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  dishCardQtyBadgeText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  dishCircularBox: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 3,
    borderColor: "#eff6ff",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    marginTop: 8,
    overflow: "hidden",
  },
  dishImg: { width: "100%", height: "100%", borderRadius: 90 },
  dishEmoji: { fontSize: 64 },
  soldOutBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#ef4444",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    zIndex: 9999,
  },
  soldOutText: { color: "#ffffff", fontSize: 10, fontWeight: "800" },
  dishInfo: {
    width: "100%",
    alignItems: "center",
    flex: 1,
    justifyContent: "space-between",
  },
  dishTopContent: {
    width: "100%",
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-start",
  },
  dishName: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  dishBulletsContainer: {
    width: "100%",
    paddingHorizontal: 8,
    marginBottom: 16,
    gap: 10,
    alignItems: "stretch",
  },
  dishBulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#f97316",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  checkBadgeIcon: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  dishBulletText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#475569",
    flex: 1,
    lineHeight: 22,
    flexWrap: "wrap",
  },
  dishPrice: {
    fontSize: 32,
    fontWeight: "900",
    color: "#f97316",
    textAlign: "center",
    letterSpacing: -0.5,
    marginTop: 6,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 14,
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
  cartItemDeleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 2,
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
  paymentCloseBtn: {
    position: "absolute",
    top: 24,
    right: 24,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  paymentCloseText: { color: "#ffffff", fontSize: 22, fontWeight: "800", lineHeight: 24, textAlign: "center" },
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

  /* Combo Selections in Cart Display */
  comboSelectionsCartBox: {
    marginTop: 4,
    paddingLeft: 2,
  },
  comboGroupNameCart: {
    fontSize: 12,
    fontWeight: "700",
    color: "#f97316",
    marginBottom: 1,
  },
  comboItemNameCart: {
    fontSize: 12,
    color: "#4b5563",
    paddingLeft: 6,
    lineHeight: 16,
  },

  /* Combo Customizer Modal Styles */
  comboFullScreenContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  comboHeaderBar: {
    paddingTop: Platform.OS === "android" ? 36 : 48,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderColor: "#f3f4f6",
    zIndex: 10,
  },
  comboCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  comboCloseBtnText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#374151",
  },
  comboScrollView: {
    flex: 1,
  },
  comboScrollContent: {
    paddingBottom: 110,
  },
  comboHeroImgBox: {
    width: "100%",
    height: 220,
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  comboHeroImg: {
    width: "100%",
    height: "100%",
  },
  comboHeroPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  comboDishInfoBox: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderColor: "#f3f4f6",
  },
  comboDishTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 6,
  },
  comboDishPrice: {
    fontSize: 22,
    fontWeight: "800",
    color: "#f97316",
    marginBottom: 6,
  },
  comboDishDesc: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
  },
  comboDishBulletsWrap: {
    marginTop: 8,
    gap: 8,
  },
  comboDishBulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  comboCheckBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f97316",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  comboCheckBadgeIcon: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
  },
  comboDishBulletText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#475569",
    flex: 1,
    lineHeight: 19,
  },
  comboLoadingBox: {
    padding: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  comboLoadingText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6b7280",
  },
  comboErrorBox: {
    padding: 32,
    alignItems: "center",
    gap: 14,
  },
  comboErrorText: {
    color: "#ef4444",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  comboRetryBtn: {
    backgroundColor: "#f97316",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  comboRetryBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  comboGroupsContainer: {
    padding: 20,
    gap: 20,
  },
  comboGroupCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 18,
  },
  comboGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  comboGroupName: {
    fontSize: 17,
    fontWeight: "800",
    color: "#1f2937",
    flex: 1,
  },
  comboGroupPickBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
  },
  comboOptionsGrid: {
    gap: 10,
  },
  comboOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    gap: 12,
  },
  comboOptionRowSelected: {
    borderColor: "#f97316",
    backgroundColor: "#fffaf5",
  },
  comboRadioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  comboRadioCircleSelected: {
    borderColor: "#f97316",
  },
  comboRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#f97316",
  },
  comboCheckboxSquare: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
  },
  comboCheckboxSquareSelected: {
    borderColor: "#f97316",
    backgroundColor: "#f97316",
  },
  comboCheckmark: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 14,
  },
  comboOptInfo: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  comboOptName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    flex: 1,
    marginRight: 8,
  },
  comboOptNameSelected: {
    color: "#111827",
    fontWeight: "700",
  },
  comboOptPrice: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6b7280",
  },
  comboInlineErrorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  comboInlineErrorText: {
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  comboFixedBottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 8,
  },
  comboQtyControls: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 14,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  comboQtyBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  comboQtyBtnText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  comboQtyVal: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
    paddingHorizontal: 14,
  },
  comboAddCartBtn: {
    flex: 1,
    height: 48,
    backgroundColor: "#f97316",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  comboAddCartBtnText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },

  /* ── TABLE SELECTION MODAL ── */
  tableModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  tableModalContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    width: "100%",
    maxWidth: 620,
    maxHeight: "85%",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 25,
    elevation: 10,
    display: "flex",
    flexDirection: "column",
  },
  tableModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  tableModalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  tableModalSubtitle: {
    fontSize: 14,
    color: "#64748b",
    fontWeight: "500",
  },
  tableModalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  tableModalCloseText: {
    fontSize: 18,
    color: "#475569",
    fontWeight: "700",
  },
  tableLoadingContainer: {
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  tableLoadingText: {
    fontSize: 15,
    color: "#64748b",
    fontWeight: "600",
  },
  tableEmptyContainer: {
    paddingVertical: 50,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  tableEmptyText: {
    fontSize: 16,
    color: "#64748b",
    fontWeight: "600",
    textAlign: "center",
  },
  tableContinueAnywayBtn: {
    backgroundColor: "#f97316",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  tableContinueAnywayText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },
  tableGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 20,
    gap: 14,
    justifyContent: "flex-start",
  },
  tableCard: {
    width: "30.5%",
    minWidth: 105,
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#e2e8f0",
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  tableCardSelected: {
    borderColor: "#f97316",
    backgroundColor: "#fff7ed",
  },
  tableIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  tableIcon: {
    fontSize: 20,
  },
  tableCardNumber: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1e293b",
    textAlign: "center",
  },
  tableCardNumberSelected: {
    color: "#ea580c",
  },
  tableCardSeats: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "600",
    marginTop: 4,
  },
  tableModalFooter: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    alignItems: "flex-end",
  },
  tableCancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
  },
  tableCancelBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },
});
