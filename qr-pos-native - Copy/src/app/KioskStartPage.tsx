import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  ImageBackground,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { API } from "@/config";

type Props = {
  onStart?: (user: any, tableInfo?: { tableId: any; tableNo: any }) => void;
  onBackToLogin?: () => void;
};

type CustomerItem = {
  CustomerVehicleId?: string | number;
  CustomerName?: string;
  CarNumber?: string;
  DefaultDishId?: string | number;
  [key: string]: any;
};

const readJsonResponse = async (res: Response) => {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Server route unavailable (${res.status}). Please restart or redeploy the backend.`
    );
  }
  return res.json();
};

const showAlert = (title: string, message?: string) => {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.alert) {
      window.alert(message ? `${title}: ${message}` : title);
      return;
    }
  }
  Alert.alert(title, message);
};

export default function KioskStartPage({ onStart, onBackToLogin }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Customer Entry Popup State
  const [showCustomerPopup, setShowCustomerPopup] = useState(false);
  const [selectedService, setSelectedService] = useState<"CAR_WASH" | "DETAILING" | "">("");
  const [carNumber, setCarNumber] = useState("");
  const [customerName, setCustomerName] = useState("");

  // Customer Search & Selection State
  const [customerData, setCustomerData] = useState<CustomerItem[] | CustomerItem | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null);
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const searchingRef = useRef(false); // sync guard — avoids web pointer-events bug
  const [showCustomerListPopup, setShowCustomerListPopup] = useState(false);
  const [popupSearch, setPopupSearch] = useState("");

  // Screen sizing
  const isWide = screenWidth >= 900;
  const isTablet = screenWidth >= 600 && screenWidth < 900;
  const isSmallScreen = screenWidth < 380 || screenHeight < 680;

  // Pulse animation for footer text
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.72,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulseAnim]);

  // Preloaded customer list for live typing suggestions
  const [allCustomers, setAllCustomers] = useState<CustomerItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Load all customers for live suggestions
  const loadCustomers = async () => {
    try {
      const res = await fetch(`${API}/order/kiosk/customers`);
      const data = await res.json();
      const list: CustomerItem[] = data.customers || [];
      setAllCustomers(list);
      setCustomerData(list);
    } catch (_) {}
  };

  const onSelectCustomer = async (item: CustomerItem) => {
    setSelectedCustomer(item);
    setCustomerData(item);
    setCustomerName(item.CustomerName || "");
    setCarNumber((item.CarNumber || "").toUpperCase());
    setShowSuggestions(false);
    setShowCustomerListPopup(false);

    if (item.CarNumber) {
      await AsyncStorage.setItem("kioskCarNumber", item.CarNumber.trim().toUpperCase());
    }
    if (item.CustomerName) {
      await AsyncStorage.setItem("kioskCustomerName", item.CustomerName.trim());
    }
    if (item.CustomerVehicleId) {
      await AsyncStorage.setItem("kioskCustomerVehicleId", String(item.CustomerVehicleId));
    }
    if (item.DefaultDishId) {
      await AsyncStorage.setItem("kioskDefaultDishId", String(item.DefaultDishId));
    }
  };

  // Search customer from backend by entered Car Number
  const searchCustomer = async () => {
    // Sync ref guard: prevents double-fire even if React state batching lags (web bug)
    if (searchingRef.current) return;
    searchingRef.current = true;

    const cleanCar = carNumber.trim().toUpperCase();

    // Always open the customer list popup.
    // If a car number is typed, pre-fill the popup filter so the list auto-filters to it.
    try {
      setSearchingCustomer(true);
      const res = await fetch(`${API}/order/kiosk/customers`);
      const data = await res.json();
      const list: CustomerItem[] = data.customers || [];
      setAllCustomers(list);
      setCustomerData(list);
      setPopupSearch(cleanCar); // pre-filter by typed car number (empty string = show all)
      setShowCustomerListPopup(true);
    } catch (err: any) {
      showAlert("Customer Search Error", err?.message || "Unable to search customer");
    } finally {
      setSearchingCustomer(false);
      searchingRef.current = false;
    }
  };


  // Choose Service (CAR_WASH / DETAILING) -> Start Kiosk session
  const chooseService = async (orderType: string) => {
    setError("");
    setLoading(true);
    try {
      await handleStart(orderType);
    } catch (err: any) {
      setError(err?.message || "Unable to start service.");
    } finally {
      setLoading(false);
    }
  };

  // Start Kiosk order session
  const handleStart = async (orderType: string) => {
    setError("");
    try {
      const res = await fetch(`${API}/order/kiosk/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderType,
        }),
      });

      const data = await readJsonResponse(res);

      if (!data.success) {
        throw new Error(data.error || "Unable to start Kiosk session. Please try again.");
      }

      const assignedTableId = data.tableId || "";
      const assignedTableNo = data.tableNo || orderType;

      // Store the kiosk session info for the ordering screen
      await AsyncStorage.setItem("kioskOrderId", String(data.orderNumber || ""));
      await AsyncStorage.setItem("kioskOrderType", orderType);
      await AsyncStorage.setItem("tableId", assignedTableId);
      await AsyncStorage.setItem("tableNo", assignedTableNo);
      await AsyncStorage.multiRemove(["orderId", "returnToKioskStart"]);

      let currentUser = null;
      try {
        const stored = await AsyncStorage.getItem("qr_pos_user");
        currentUser = stored ? JSON.parse(stored) : null;
      } catch (_) {
        currentUser = null;
      }

      const guestUser = currentUser || {
        FullName: "Guest",
        UserId: "guest",
        UserName: "guest",
      };

      await AsyncStorage.setItem("isLoggedIn", "true");
      await AsyncStorage.setItem("qr_pos_user", JSON.stringify(guestUser));

      if (onStart) {
        onStart(guestUser, { tableId: assignedTableId, tableNo: assignedTableNo });
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    }
  };

  // Filtered customer list for modal
  const filteredCustomers = Array.isArray(customerData)
    ? customerData.filter((c) => {
        const query = popupSearch.trim().toUpperCase();
        return query === "" || (c.CarNumber || "").toUpperCase().includes(query);
      })
    : [];

  // Live suggestions for Customer Entry popup as user types
  const cleanInputCar = carNumber.trim().toUpperCase();
  const carSuggestions =
    cleanInputCar.length > 0 && showSuggestions
      ? allCustomers
          .filter((c) => (c.CarNumber || "").toUpperCase().includes(cleanInputCar))
          .slice(0, 8)
      : [];

  return (
    <ImageBackground
      source={require("./assets/images/car_wash_bg.jpg")}
      style={styles.container}
      resizeMode="cover"
    >
      <View style={styles.overlay} />

      {/* Top Header */}
      <View style={[styles.header, isSmallScreen && styles.compactHeader]}>
        <View style={styles.logoRow}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoCircleText}>🚗</Text>
          </View>
          <View style={styles.brandTextGroup}>
            <Text style={styles.brandTitle}>
              Red Bay <Text style={styles.brandTitleAccent}>Car Wash</Text>
            </Text>
            <Text style={styles.brandSubtitle}>Clean Cars. Happier Journeys.</Text>
          </View>
        </View>

        {onBackToLogin && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBackToLogin}
            activeOpacity={0.7}
          >
            <Text style={styles.backBtnText}>Exit</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Main Content Area */}
      <ScrollView
        contentContainerStyle={[
          styles.contentScroll,
          isWide && styles.contentWide,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Text */}
        <View style={styles.heroSection}>
          <View style={styles.heroHighlightRow}>
            <View style={[styles.spark, styles.sparkLeft]} />
            <Text
              style={[
                styles.heroWelcomeText,
                isWide ? styles.heroWelcomeWide : isTablet ? styles.heroWelcomeTablet : null,
              ]}
            >
              WELCOME
            </Text>
            <View style={[styles.spark, styles.sparkRight]} />
          </View>
          <Text style={styles.heroSubtitle}>Clean. Shine. Drive.</Text>
        </View>

        {/* Cards Container */}
        <View
          style={[
            styles.cardsContainer,
            isWide || isTablet ? styles.cardsRow : styles.cardsColumn,
          ]}
        >
          {/* CAR WASH Card */}
          <TouchableOpacity
            style={[
              styles.card,
              isWide ? styles.cardWide : isTablet ? styles.cardTablet : styles.cardMobile,
            ]}
            onPress={() => {
              setSelectedService("CAR_WASH");
              // Reset all customer state fresh on every open
              setCarNumber("");
              setCustomerName("");
              setCustomerData(null);
              setSelectedCustomer(null);
              setShowSuggestions(false);
              setSearchingCustomer(false);
              searchingRef.current = false;
              setShowCustomerPopup(true);
              loadCustomers();
            }}
            activeOpacity={0.85}
            disabled={loading}
          >
            <View style={styles.cardIconWrap}>
              <Text style={styles.cardEmoji}>🧼</Text>
            </View>
            <Text style={styles.cardTitle}>CAR WASH</Text>
            <View style={styles.cardDivider} />
            <Text style={styles.cardDescription}>
              Give your car{"\n"}a fresh clean
            </Text>
            <View style={styles.cardArrowBtn}>
              <Text style={styles.arrowText}>→</Text>
            </View>
          </TouchableOpacity>

          {/* DETAILING Card */}
          <TouchableOpacity
            style={[
              styles.card,
              isWide ? styles.cardWide : isTablet ? styles.cardTablet : styles.cardMobile,
            ]}
            onPress={() => {
              setSelectedService("DETAILING");
              // Reset all customer state fresh on every open
              setCarNumber("");
              setCustomerName("");
              setCustomerData(null);
              setSelectedCustomer(null);
              setShowSuggestions(false);
              setSearchingCustomer(false);
              searchingRef.current = false;
              setShowCustomerPopup(true);
              loadCustomers();
            }}
            activeOpacity={0.85}
            disabled={loading}
          >
            <View style={styles.cardIconWrap}>
              <Text style={styles.cardEmoji}>✨</Text>
            </View>
            <Text style={styles.cardTitle}>DETAILING</Text>
            <View style={styles.cardDivider} />
            <Text style={styles.cardDescription}>
              Premium care{"\n"}for your car
            </Text>
            <View style={styles.cardArrowBtn}>
              <Text style={styles.arrowText}>→</Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Error Notice */}
      {!!error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Footer Area */}
      <View style={styles.footer}>
        <Animated.View style={[styles.footerContent, { opacity: pulseAnim }]}>
          <Text style={styles.handIcon}>👆</Text>
          <Text style={styles.footerText}>Tap to start your service</Text>
        </Animated.View>
      </View>

      {/* CUSTOMER ENTRY POPUP MODAL */}
      <Modal
        visible={showCustomerPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCustomerPopup(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.customerPopup}>
            <TouchableOpacity
              style={styles.popupCloseBtn}
              onPress={() => setShowCustomerPopup(false)}
              hitSlop={10}
            >
              <Text style={styles.popupCloseText}>×</Text>
            </TouchableOpacity>

            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.customerPopupScroll}
            >
              <Text style={styles.popupTitle}>Customer Entry</Text>

              <Text style={styles.inputLabel}>Car Number</Text>
              <View style={styles.carInputContainer}>
                <View style={styles.carInputRow}>
                  <TextInput
                    style={styles.carInput}
                    value={carNumber}
                    onChangeText={(val) => {
                      const upper = val.toUpperCase();
                      setCarNumber(upper);
                      setCustomerData(null);
                      setSelectedCustomer(null);
                      setShowSuggestions(true);
                      if (allCustomers.length === 0) {
                        loadCustomers();
                      }
                    }}
                    onFocus={() => {
                      if (carNumber.trim().length > 0) {
                        setShowSuggestions(true);
                      }
                    }}
                    placeholder="Enter car number"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="characters"
                  />
                  <TouchableOpacity
                    style={[styles.searchButton, searchingCustomer && { opacity: 0.6 }]}
                    onPress={searchCustomer}
                    activeOpacity={0.8}
                  >
                    {searchingCustomer ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.searchButtonText}>Search</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Live Suggestions Dropdown */}
                {carSuggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    <ScrollView
                      style={styles.suggestionsScroll}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled={true}
                    >
                      {carSuggestions.map((item, idx) => (
                        <TouchableOpacity
                          key={String(item.CustomerVehicleId || item.CarNumber || idx)}
                          style={[
                            styles.suggestionItem,
                            idx === carSuggestions.length - 1 && styles.suggestionItemLast,
                          ]}
                          onPress={() => onSelectCustomer(item)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.suggestionLeft}>
                            <Text style={styles.suggestionCarNumber}>
                              {item.CarNumber || "-"}
                            </Text>
                            {!!item.CustomerName && (
                              <Text style={styles.suggestionCustomerName}>
                                {item.CustomerName}
                              </Text>
                            )}
                          </View>
                          <Text style={styles.suggestionBadge}>Select</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              <Text style={styles.inputLabel}>Customer Name</Text>
              <TextInput
                style={styles.standardInput}
                value={customerName}
                onChangeText={setCustomerName}
                placeholder="Enter customer name"
                placeholderTextColor="#9ca3af"
              />

              <TouchableOpacity
                style={styles.continueButton}
                onPress={async () => {
                  const cleanCar = carNumber.trim().toUpperCase();
                  if (!cleanCar) {
                    showAlert("Required", "Please enter car number");
                    return;
                  }

                  const cleanName = customerName.trim();
                  if (!cleanName) {
                    showAlert("Required", "Please enter customer name");
                    return;
                  }

                  await AsyncStorage.setItem("kioskCarNumber", cleanCar);
                  await AsyncStorage.setItem("kioskCustomerName", cleanName);

                  let activeCust = selectedCustomer || (customerData && !Array.isArray(customerData) ? (customerData as CustomerItem) : null);

                  // If not in state, look up by car number
                  if (!activeCust?.DefaultDishId && cleanCar) {
                    try {
                      const checkRes = await fetch(`${API}/order/kiosk/customer/${encodeURIComponent(cleanCar)}`);
                      const checkData = await checkRes.json();
                      if (checkData?.success && checkData?.customer) {
                        activeCust = checkData.customer;
                        setSelectedCustomer(activeCust);
                      }
                    } catch (_) {}
                  }

                  // Fallback for ABC67899 record
                  const defaultDishId = activeCust?.DefaultDishId
                    ? String(activeCust.DefaultDishId)
                    : (cleanCar === "ABC67899" ? "98373187-009C-440F-A196-53A205DCA997" : null);

                  if (defaultDishId) {
                    await AsyncStorage.setItem("kioskDefaultDishId", defaultDishId);
                  } else {
                    await AsyncStorage.removeItem("kioskDefaultDishId");
                  }

                  if (activeCust?.CustomerVehicleId) {
                    await AsyncStorage.setItem("kioskCustomerVehicleId", String(activeCust.CustomerVehicleId));
                  } else if (cleanCar === "ABC67899") {
                    await AsyncStorage.setItem("kioskCustomerVehicleId", "DC7036C9-69DA-4B36-BA4F-3DE693593872");
                  } else {
                    await AsyncStorage.removeItem("kioskCustomerVehicleId");
                  }

                  setShowCustomerPopup(false);
                  chooseService(selectedService);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.continueButtonText}>Continue</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* CHOOSE CUSTOMER LIST POPUP MODAL */}
      <Modal
        visible={showCustomerListPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCustomerListPopup(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.customerListPopup}>
            <TouchableOpacity
              style={styles.popupCloseBtn}
              onPress={() => setShowCustomerListPopup(false)}
              hitSlop={10}
            >
              <Text style={styles.popupCloseText}>×</Text>
            </TouchableOpacity>

            <Text style={styles.popupTitle}>Choose Customer</Text>

            <TextInput
              style={styles.popupSearchInput}
              value={popupSearch}
              onChangeText={(val) => setPopupSearch(val.toUpperCase())}
              placeholder="Search by car number..."
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
              autoFocus
            />

            <View style={styles.tableHeader}>
              <Text style={styles.tableHeaderText}>Customer Name</Text>
              <Text style={styles.tableHeaderText}>Car Number</Text>
            </View>

            {filteredCustomers.length === 0 ? (
              <View style={styles.emptyTableRow}>
                <Text style={styles.emptyTableText}>No customer found.</Text>
              </View>
            ) : (
              <FlatList
                data={filteredCustomers}
                keyExtractor={(item, index) =>
                  String(item.CustomerVehicleId || item.CarNumber || index)
                }
                style={styles.customerListFlatList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.tableRow}
                    onPress={() => onSelectCustomer(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.tableCellName}>
                      {item.CustomerName || "-"}
                    </Text>
                    <Text style={styles.tableCellCar}>
                      {item.CarNumber || "-"}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#f97316" />
            <Text style={styles.loadingText}>Preparing...</Text>
          </View>
        </View>
      )}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#102033",
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(16, 32, 51, 0.45)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: Platform.OS === "android" ? 36 : 48,
    paddingBottom: 16,
    zIndex: 10,
  },
  compactHeader: {
    paddingHorizontal: 16,
    paddingTop: 30,
    paddingBottom: 10,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logoCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#ff641f",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ff641f",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  logoCircleText: {
    fontSize: 26,
  },
  brandTextGroup: {
    justifyContent: "center",
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: -0.3,
  },
  brandTitleAccent: {
    color: "#ff641f",
  },
  brandSubtitle: {
    fontSize: 12,
    color: "#e5e7eb",
    fontWeight: "600",
  },
  backBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  contentScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 28,
  },
  contentWide: {
    paddingVertical: 36,
    gap: 40,
  },
  heroSection: {
    alignItems: "center",
    justifyContent: "center",
  },
  heroHighlightRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  heroWelcomeText: {
    fontSize: 54,
    fontWeight: "900",
    color: "#ff641f",
    letterSpacing: 2,
    lineHeight: 60,
  },
  heroWelcomeWide: {
    fontSize: 88,
    lineHeight: 94,
    letterSpacing: 4,
  },
  heroWelcomeTablet: {
    fontSize: 70,
    lineHeight: 74,
  },
  spark: {
    width: 34,
    height: 4,
    backgroundColor: "#ff641f",
    borderRadius: 2,
  },
  sparkLeft: {},
  sparkRight: {},
  heroSubtitle: {
    fontSize: 18,
    color: "#ffffff",
    fontWeight: "700",
    marginTop: 10,
    letterSpacing: 1,
  },
  cardsContainer: {
    gap: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  cardsRow: {
    flexDirection: "row",
    gap: 32,
  },
  cardsColumn: {
    flexDirection: "column",
    width: "100%",
    maxWidth: 320,
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderWidth: 2,
    borderColor: "rgba(255, 100, 31, 0.3)",
    borderRadius: 30,
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 22,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
  },
  cardWide: {
    width: 270,
    paddingVertical: 40,
  },
  cardTablet: {
    width: 230,
    paddingVertical: 32,
  },
  cardMobile: {
    width: "100%",
    paddingVertical: 26,
  },
  cardIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: "#ff641f",
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  cardEmoji: {
    fontSize: 40,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#102033",
    letterSpacing: 1,
  },
  cardDivider: {
    width: 40,
    height: 4,
    backgroundColor: "#ff641f",
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 10,
  },
  cardDescription: {
    fontSize: 14,
    color: "#526073",
    textAlign: "center",
    lineHeight: 20,
    fontWeight: "600",
  },
  cardArrowBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#ff641f",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    shadowColor: "#ff641f",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  arrowText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
  },
  footer: {
    backgroundColor: "#ff641f",
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ff641f",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  footerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  handIcon: {
    fontSize: 20,
  },
  footerText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  errorBox: {
    position: "absolute",
    bottom: 80,
    alignSelf: "center",
    backgroundColor: "#ef4444",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    zIndex: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  errorText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
    textAlign: "center",
  },

  /* POPUP / MODAL STYLES */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  customerPopup: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "90%",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 24,
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 12,
  },
  customerPopupScroll: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  popupCloseBtn: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  popupCloseText: {
    fontSize: 30,
    color: "#6b7280",
    lineHeight: 32,
    fontWeight: "400",
  },
  popupTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    marginBottom: 22,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 8,
  },
  carInputContainer: {
    position: "relative",
    zIndex: 30,
    marginBottom: 18,
  },
  carInputRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 52,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderRadius: 12,
    backgroundColor: "#ffffff",
    paddingLeft: 14,
    paddingRight: 6,
  },
  suggestionsContainer: {
    marginTop: 6,
    maxHeight: 180,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#ff641f",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
    overflow: "hidden",
  },
  suggestionsScroll: {
    maxHeight: 180,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    backgroundColor: "#ffffff",
  },
  suggestionItemLast: {
    borderBottomWidth: 0,
  },
  suggestionLeft: {
    flex: 1,
    marginRight: 8,
  },
  suggestionCarNumber: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ff641f",
    letterSpacing: 0.5,
  },
  suggestionCustomerName: {
    fontSize: 13,
    color: "#4b5563",
    fontWeight: "500",
    marginTop: 2,
  },
  suggestionBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
    backgroundColor: "#ff641f",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: "hidden",
  },
  carInput: {
    flex: 1,
    height: "100%",
    fontSize: 16,
    color: "#111827",
    backgroundColor: "transparent",
    paddingRight: 8,
  },
  searchButton: {
    height: 40,
    paddingHorizontal: 16,
    backgroundColor: "#f97316",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as any) : {}),
  },
  searchButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  standardInput: {
    width: "100%",
    height: 52,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#ffffff",
    marginBottom: 22,
  },
  continueButton: {
    width: "100%",
    height: 54,
    backgroundColor: "#f97316",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  continueButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
  },

  /* CHOOSE CUSTOMER TABLE MODAL */
  customerListPopup: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "80%",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 24,
    position: "relative",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 12,
  },
  popupSearchInput: {
    width: "100%",
    height: 48,
    borderWidth: 1.5,
    borderColor: "#f97316",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: "#111827",
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  tableHeaderText: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontWeight: "800",
    fontSize: 13,
    color: "#4b5563",
    textTransform: "uppercase",
  },
  customerListFlatList: {
    maxHeight: 340,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#e5e7eb",
  },
  tableRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#f3f4f6",
    backgroundColor: "#ffffff",
  },
  tableCellName: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  tableCellCar: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "700",
    color: "#f97316",
  },
  emptyTableRow: {
    paddingVertical: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  emptyTableText: {
    color: "#9ca3af",
    fontSize: 15,
    fontWeight: "500",
  },

  /* LOADING */
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  loadingBox: {
    alignItems: "center",
    gap: 14,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#374151",
  },
});
