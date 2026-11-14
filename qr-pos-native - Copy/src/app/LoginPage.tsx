
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    ImageBackground,
    KeyboardAvoidingView,
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
  onLoginSuccess?: (user: any) => void;
};

type PromoImage = {
  PromoImage: string;
  PromoName?: string;
};

type InputIconName = "envelope" | "person" | "phone";

function FieldIcon({ name }: { name: InputIconName }) {
  const symbols = {
    envelope: { ios: "envelope", android: "mail", web: "mail" },
    person: { ios: "person", android: "person", web: "person" },
    phone: { ios: "phone", android: "call", web: "call" },
  } as const;

  return (
    <View style={styles.inputIconContainer}>
      <SymbolView
        name={symbols[name]}
        tintColor="#a0a7b4"
        size={20}
        style={styles.inputIcon}
      />
    </View>
  );
}

function PasswordEyeIcon({ visible }: { visible: boolean }) {
  return (
    <View style={styles.eyeIcon}>
      <View style={styles.eyeOutline}>
        <View style={styles.eyePupil} />
      </View>
      {!visible && <View style={styles.eyeSlash} />}
    </View>
  );
}

export default function LoginPage({ onLoginSuccess }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Screen size categories
  const isKioskWide = screenWidth >= 900;
  const isTablet = screenWidth >= 600 && screenWidth < 900;
  const isCompactWidth = screenWidth < 420;
  const isCompactHeight = screenHeight < 800;
  const isVeryShort = screenHeight < 650;

  // Responsive dimensions for Kiosk vs Mobile
  const logoSize = isKioskWide ? 92 : isVeryShort ? 64 : isCompactHeight ? 74 : 86;
  const cardWidth = isKioskWide 
    ? Math.min(screenWidth * 0.42, 480) 
    : isTablet 
    ? Math.min(screenWidth * 0.7, 460) 
    : Math.min(screenWidth - (isCompactWidth ? 24 : 36), 440);
    
  const cardPadding = isKioskWide 
    ? 36 
    : isCompactWidth 
    ? 18 
    : screenWidth < 520 
    ? 24 
    : 32;

  const brandFontSize = isKioskWide 
    ? 32 
    : screenWidth < 340 
    ? 20 
    : screenWidth < 390 
    ? 24 
    : screenWidth < 520 
    ? 26 
    : 30;

  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  const [siUsername, setSiUsername] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siPromoCode, setSiPromoCode] = useState("");
  const [showSignInPromo, setShowSignInPromo] = useState(false);

  const [suUsername, setSuUsername] = useState("");
  const [suPhone, setSuPhone] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suConfirm, setSuConfirm] = useState("");
  const [suPromoCode, setSuPromoCode] = useState("");

  const [promoImages, setPromoImages] = useState<PromoImage[]>([]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showPromo, setShowPromo] = useState(false);

  const [showGift, setShowGift] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successUser, setSuccessUser] = useState("");
  const [signedUpUser, setSignedUpUser] = useState<any>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const loadPromotions = async () => {
      try {
        const response = await fetch(`${API}/auth/promo-image`);
        const data = await response.json();

        if (data.success && data.promoImages?.length > 0) {
          setPromoImages(data.promoImages);
          setCurrentSlide(0);
          setShowPromo(true);
        }
      } catch (e) {
        console.log("Promo image loading error:", e);
      }
    };

    loadPromotions();

    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!showPromo || promoImages.length <= 1) return;

    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % promoImages.length);
    }, 3500);

    return () => clearInterval(timer);
  }, [showPromo, promoImages.length]);

  const switchTab = (value: "signin" | "signup") => {
    setTab(value);
    setError("");
    setShowPass(false);
    setShowConfirmPass(false);
  };

  const saveUserSession = async (user: any) => {
    await AsyncStorage.setItem("qr_pos_user", JSON.stringify(user));

    if (user?.Promocode) {
      await AsyncStorage.setItem("promoCode", user.Promocode);
      await AsyncStorage.setItem(
        "promoAmount",
        String(user.Promoamount || 0)
      );
      await AsyncStorage.setItem(
        "availableCredit",
        String(user.AvailableCredit || 0)
      );
    } else {
      await AsyncStorage.multiRemove([
        "promoCode",
        "promoAmount",
        "availableCredit",
      ]);
    }
  };

  const handleSignIn = async () => {
    setError("");

    if (!siUsername.trim() || !siPassword.trim()) {
      setError("Please enter your username and password.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: siUsername.trim(),
          password: siPassword,
          promoCode: siPromoCode.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || "Login failed. Please try again.");
        return;
      }

      await saveUserSession(data.user);
      setSuccessUser(data.user.FullName || data.user.UserName || "Customer");
      setShowSuccess(true);

      setTimeout(() => {
        onLoginSuccess?.(data.user);
      }, 1400);
    } catch (e) {
      setError("Cannot connect to server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    setError("");

    if (!suUsername.trim() || !suPassword.trim()) {
      setError("Username and password are required.");
      return;
    }

    if (!suPhone.trim()) {
      setError("Phone number is required.");
      return;
    }

    if (suPassword !== suConfirm) {
      setError("Passwords do not match.");
      return;
    }

    if (suPassword.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: suUsername.trim(),
          username: suUsername.trim(),
          password: suPassword,
          phone: suPhone.trim(),
          promoCode: suPromoCode.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message || "Registration failed. Please try again.");
        return;
      }

      await saveUserSession(data.user);
      setSignedUpUser(data.user);
      setSuccessUser(data.user.FullName || data.user.UserName || suUsername);
      setShowGift(true);
    } catch (e) {
      setError("Cannot connect to server. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const continueAsGuest = async () => {
    setError("");
    setLoading(true);

    try {
      const guestUser = {
        FullName: "Guest",
        UserId: "guest",
        UserName: "guest",
      };

      await AsyncStorage.setItem("qr_pos_user", JSON.stringify(guestUser));
      onLoginSuccess?.(guestUser);
    } catch (e) {
      setError("Unable to continue as guest.");
    } finally {
      setLoading(false);
    }
  };

  const finishSignUp = async () => {
    try {
      await AsyncStorage.setItem("isLoggedIn", "true");
      setShowGift(false);
      setShowSuccess(true);

      const promoCode = await AsyncStorage.getItem("promoCode");
      const promoAmount = await AsyncStorage.getItem("promoAmount");
      const availableCredit = await AsyncStorage.getItem("availableCredit");

      const user = {
        ...signedUpUser,
        Promocode: promoCode || "",
        Promoamount: Number(promoAmount || 0),
        AvailableCredit: Number(availableCredit || 0),
      };

      setTimeout(() => onLoginSuccess?.(user), 1400);
    } catch (e) {
      Alert.alert("Error", "Could not save your session.");
    }
  };

  const input = (
    label: string,
    value: string,
    setter: (value: string) => void,
    placeholder: string,
    options: {
      secure?: boolean;
      keyboardType?: "default" | "phone-pad" | "email-address";
      visible?: boolean;
      icon?: InputIconName;
    } = {}
  ) => (
    <View style={[styles.field, isCompactHeight && styles.compactField]}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          isCompactHeight && styles.compactInputRow,
        ]}
      >
        {!!options.icon && <FieldIcon name={options.icon} />}
        <TextInput
          style={[
            styles.input,
            !!options.icon && styles.inputWithIcon,
            isCompactHeight && styles.compactInput,
          ]}
          value={value}
          onChangeText={setter}
          placeholder={placeholder}
          placeholderTextColor="#a0a7b4"
          secureTextEntry={options.secure && !options.visible}
          keyboardType={options.keyboardType || "default"}
          autoCapitalize="none"
          editable={!loading}
        />
      </View>
    </View>
  );

  const actionButton = (
    label: string,
    action: () => void,
    secondary = false
  ) => (
    <TouchableOpacity
      style={[
        styles.button,
        secondary && styles.secondaryButton,
        isCompactHeight && styles.compactButton,
      ]}
      onPress={action}
      disabled={loading}
      activeOpacity={0.8}
    >
      {loading && !secondary ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text
          style={[
            styles.buttonText,
            secondary && styles.secondaryButtonText,
          ]}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );

  return (
    <ImageBackground
      source={require("./assets/images/car_wash_bg.jpg")}
      style={styles.background}
      resizeMode="cover"
    >
      <View style={styles.overlay} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingHorizontal: isCompactWidth ? 12 : 16,
              paddingTop: Math.max(logoSize * 0.65, isVeryShort ? 42 : isCompactHeight ? 52 : 64),
              paddingBottom: isVeryShort ? 24 : isCompactHeight ? 36 : 48,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={[
              styles.card,
              {
                width: cardWidth,
                paddingHorizontal: cardPadding,
                paddingTop: isVeryShort ? 36 : logoSize <= 78 ? 44 : 52,
                paddingBottom: isVeryShort ? 16 : isCompactHeight ? 20 : 28,
                marginTop: Math.max(logoSize * 0.55, isVeryShort ? 28 : logoSize <= 78 ? 36 : 46),
                borderRadius: isCompactWidth ? 24 : 32,
              },
            ]}
          >
            <View
              style={[
                styles.logoCircle,
                {
                  width: logoSize,
                  height: logoSize,
                  borderRadius: logoSize / 2,
                  top: -logoSize * 0.52,
                  transform: [{ translateX: -logoSize / 2 }],
                },
              ]}
            >
              <View style={styles.carIcon}>
                <View style={styles.carRoof} />
                <View style={styles.carBody} />
                <View style={[styles.carWheel, styles.leftCarWheel]} />
                <View style={[styles.carWheel, styles.rightCarWheel]} />
              </View>
            </View>

            <Text style={[styles.brand, { fontSize: brandFontSize }]}>
              RED BAY CAR <Text style={styles.brandAccent}>Wash</Text>
            </Text>
            <Text style={styles.subtitle}>Unipro</Text>

            <View
              style={[
                styles.tabs,
                isCompactHeight && styles.compactTabs,
              ]}
            >
              <TouchableOpacity
                style={[styles.tab, tab === "signin" && styles.activeTab]}
                onPress={() => switchTab("signin")}
              >
                <Text
                  style={[
                    styles.tabText,
                    tab === "signin" && styles.activeTabText,
                  ]}
                >
                  Sign In
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tab, tab === "signup" && styles.activeTab]}
                onPress={() => switchTab("signup")}
              >
                <Text
                  style={[
                    styles.tabText,
                    tab === "signup" && styles.activeTabText,
                  ]}
                >
                  Sign Up
                </Text>
              </TouchableOpacity>
            </View>

            {tab === "signin" ? (
              <>
                {input(
                  "Email ID or Username*",
                  siUsername,
                  setSiUsername,
                  "valentino@gmail.com",
                  { icon: "envelope" }
                )}
                <View
                  style={[
                    styles.field,
                    isCompactHeight && styles.compactField,
                  ]}
                >
                  <Text style={styles.label}>Password*</Text>
                  <View
                    style={[
                      styles.passwordRow,
                      isCompactHeight && styles.compactInputRow,
                    ]}
                  >
                    <View style={styles.lockIcon}>
                      <View style={styles.lockShackle} />
                      <View style={styles.lockBody} />
                    </View>
                    <TextInput
                      style={[
                        styles.passwordInput,
                        isCompactHeight && styles.compactPasswordInput,
                      ]}
                      value={siPassword}
                      onChangeText={setSiPassword}
                      placeholder="••••••••••••"
                      placeholderTextColor="#a0a7b4"
                      secureTextEntry={!showPass}
                      autoCapitalize="none"
                      editable={!loading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPass(!showPass)}
                      accessibilityRole="button"
                      accessibilityLabel={showPass ? "Hide password" : "Show password"}
                      hitSlop={8}
                    >
                      <PasswordEyeIcon visible={showPass} />
                    </TouchableOpacity>
                  </View>
                </View>

                {showSignInPromo ? (
                  input("Promo Code", siPromoCode, setSiPromoCode, "Enter promo code")
                ) : (
                  <TouchableOpacity
                    style={styles.promoToggle}
                    onPress={() => setShowSignInPromo(true)}
                  >
                    <Text style={styles.promoToggleText}>Have a promo code?</Text>
                  </TouchableOpacity>
                )}

                {!!error && <Text style={styles.error}>{error}</Text>}

                {actionButton("Sign In  →", handleSignIn)}

                <Text
                  style={[
                    styles.or,
                    isCompactHeight && styles.compactOr,
                  ]}
                >
                  ────────  or  ────────
                </Text>

                {actionButton("Continue as Guest", continueAsGuest, true)}

                <View
                  style={[
                    styles.footer,
                    isCompactHeight && styles.compactFooter,
                  ]}
                >
                  <Text style={styles.footerText}>Don&apos;t have an account? </Text>
                  <TouchableOpacity onPress={() => switchTab("signup")}>
                    <Text style={styles.link}>Register Now</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {input("Username *", suUsername, setSuUsername, "Choose a username", { icon: "person" })}
                {input("Phone Number *", suPhone, setSuPhone, "Enter phone number", { keyboardType: "phone-pad", icon: "phone" })}

                <View
                  style={[
                    styles.field,
                    isCompactHeight && styles.compactField,
                  ]}
                >
                  <Text style={styles.label}>Password *</Text>
                  <View
                    style={[
                      styles.passwordRow,
                      isCompactHeight && styles.compactInputRow,
                    ]}
                  >
                    <View style={styles.lockIcon}>
                      <View style={styles.lockShackle} />
                      <View style={styles.lockBody} />
                    </View>
                    <TextInput
                      style={[
                        styles.passwordInput,
                        isCompactHeight && styles.compactPasswordInput,
                      ]}
                      value={suPassword}
                      onChangeText={setSuPassword}
                      placeholder="Create a password"
                      placeholderTextColor="#a0a7b4"
                      secureTextEntry={!showPass}
                      autoCapitalize="none"
                      editable={!loading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPass(!showPass)}
                      accessibilityRole="button"
                      accessibilityLabel={showPass ? "Hide password" : "Show password"}
                      hitSlop={8}
                    >
                      <PasswordEyeIcon visible={showPass} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View
                  style={[
                    styles.field,
                    isCompactHeight && styles.compactField,
                  ]}
                >
                  <Text style={styles.label}>Confirm Password *</Text>
                  <View
                    style={[
                      styles.passwordRow,
                      isCompactHeight && styles.compactInputRow,
                    ]}
                  >
                    <View style={styles.lockIcon}>
                      <View style={styles.lockShackle} />
                      <View style={styles.lockBody} />
                    </View>
                    <TextInput
                      style={[
                        styles.passwordInput,
                        isCompactHeight && styles.compactPasswordInput,
                      ]}
                      value={suConfirm}
                      onChangeText={setSuConfirm}
                      placeholder="Re-enter your password"
                      placeholderTextColor="#a0a7b4"
                      secureTextEntry={!showConfirmPass}
                      autoCapitalize="none"
                      editable={!loading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowConfirmPass(!showConfirmPass)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        showConfirmPass ? "Hide confirm password" : "Show confirm password"
                      }
                      hitSlop={8}
                    >
                      <PasswordEyeIcon visible={showConfirmPass} />
                    </TouchableOpacity>
                  </View>
                </View>

                {input("Promo Code", suPromoCode, setSuPromoCode, "Enter promo code", { icon: "person" })}

                {!!error && <Text style={styles.error}>{error}</Text>}

                {actionButton("Create Account", handleSignUp)}

                <View
                  style={[
                    styles.footer,
                    isCompactHeight && styles.compactFooter,
                  ]}
                >
                  <Text style={styles.footerText}>Already have an account? </Text>
                  <TouchableOpacity onPress={() => switchTab("signin")}>
                    <Text style={styles.link}>Sign In</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Promo image carousel */}
      <Modal
        visible={showPromo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPromo(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.promoCard}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowPromo(false)}
            >
              <Text style={styles.closeText}>×</Text>
            </TouchableOpacity>

            {promoImages.length > 0 && (
              <>
                <Image
                  source={{ uri: promoImages[currentSlide]?.PromoImage }}
                  style={styles.promoImage}
                  resizeMode="contain"
                />
                <Text style={styles.promoTitle}>
                  {promoImages[currentSlide]?.PromoName || "Special Promotion"}
                </Text>
                <Text style={styles.promoCounter}>
                  {currentSlide + 1} / {promoImages.length}
                </Text>
                {promoImages.length > 1 && (
                  <View style={styles.slideButtons}>
                    <TouchableOpacity
                      onPress={() =>
                        setCurrentSlide(
                          (currentSlide - 1 + promoImages.length) %
                            promoImages.length
                        )
                      }
                    >
                      <Text style={styles.link}>‹ Previous</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        setCurrentSlide((currentSlide + 1) % promoImages.length)
                      }
                    >
                      <Text style={styles.link}>Next ›</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* New customer gift popup */}
      <Modal
        visible={showGift}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGift(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>🎁</Text>
            <Text style={styles.successTitle}>Welcome!</Text>
            <Text style={styles.description}>
              As a new customer, you can receive a gift at the counter.
            </Text>
            {actionButton("Awesome!", finishSignUp)}
          </View>
        </View>
      </Modal>

      {/* Login success popup */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successTitle}>Welcome, {successUser}!</Text>
            <Text style={styles.description}>Redirecting to menu…</Text>
          </View>
        </View>
      </Modal>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  background: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#101827",
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(5, 12, 25, 0.08)",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  card: {
    width: "100%",
    maxWidth: 590,
    paddingHorizontal: 40,
    paddingTop: 50,
    paddingBottom: 28,
    marginTop: 38,
    borderRadius: 38,
    position: "relative",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 14,
  },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#ff5722",
    position: "absolute",
    top: -52,
    alignSelf: "center",
    left: "50%",
    transform: [{ translateX: -48 }],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 8,
    borderColor: "#ffffff",
    shadowColor: "#ff5722",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  carIcon: {
    width: 40,
    height: 29,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  carRoof: {
    position: "absolute",
    top: 2,
    width: 21,
    height: 11,
    borderColor: "#ffffff",
    borderWidth: 2,
    borderBottomWidth: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  carBody: {
    width: 36,
    height: 13,
    borderColor: "#ffffff",
    borderWidth: 2,
    borderRadius: 6,
  },
  carWheel: {
    position: "absolute",
    bottom: 0,
    width: 8,
    height: 8,
    borderColor: "#ffffff",
    borderWidth: 2,
    borderRadius: 4,
    backgroundColor: "#ff5722",
  },
  leftCarWheel: { left: 5 },
  rightCarWheel: { right: 5 },
  brand: {
    textAlign: "center",
    fontSize: 38,
    fontWeight: "900",
    color: "#111827",
    letterSpacing: -0.5,
    marginTop: 0,
  },
  brandAccent: { color: "#ff5722" },
  subtitle: {
    textAlign: "center",
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 2.5,
    marginTop: 6,
    marginBottom: 14,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#f1f3f5",
    borderRadius: 14,
    padding: 3,
    marginTop: 0,
    marginBottom: 16,
  },
  compactTabs: { marginBottom: 12 },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 11,
  },
  activeTab: {
    backgroundColor: "#ff5722",
    shadowColor: "#ff5722",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  tabText: { fontSize: 14, fontWeight: "700", color: "#9ca3af" },
  activeTabText: { color: "#ffffff" },
  heading: {
    textAlign: "center",
    fontSize: 23,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 6,
  },
  description: {
    textAlign: "center",
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
    marginBottom: 16,
  },
  field: { marginBottom: 11 },
  compactField: { marginBottom: 8 },
  label: {
    color: "#374151",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 5,
  },
  inputRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  compactInputRow: { minHeight: 44 },
  inputIconContainer: {
    width: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  inputIcon: { width: 20, height: 20 },
  lockIcon: {
    width: 36,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  lockShackle: {
    width: 12,
    height: 11,
    borderWidth: 2,
    borderColor: "#a0a7b4",
    borderBottomWidth: 0,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
  },
  lockBody: {
    width: 19,
    height: 14,
    marginTop: -1,
    borderWidth: 2,
    borderColor: "#a0a7b4",
    borderRadius: 4,
  },
  input: {
    flex: 1,
    height: 48,
    paddingHorizontal: 14,
    fontSize: 14,
    color: "#1f2937",
    backgroundColor: "#ffffff",
    borderRadius: 12,
  },
  compactInput: { height: 42 },
  inputWithIcon: { paddingLeft: 0 },
  passwordRow: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    fontSize: 14,
    color: "#1f2937",
    paddingHorizontal: 8,
  },
  compactPasswordInput: { height: 42 },
  eyeIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
  },
  eyeOutline: {
    width: 21,
    height: 14,
    borderWidth: 2,
    borderColor: "#a0a7b4",
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  eyePupil: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#a0a7b4",
  },
  eyeSlash: {
    position: "absolute",
    width: 26,
    height: 2,
    backgroundColor: "#a0a7b4",
    transform: [{ rotate: "-45deg" }],
  },
  promoToggle: { alignSelf: "flex-end", marginTop: -4, marginBottom: 10 },
  promoToggleText: { color: "#ff5722", fontSize: 12, fontWeight: "700" },
  button: {
    minHeight: 52,
    backgroundColor: "#ff5722",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 15,
    marginTop: 4,
    shadowColor: "#ff5722",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
  compactButton: { minHeight: 46 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    backgroundColor: "#fff5f2",
    borderWidth: 1,
    borderColor: "#ff5722",
    shadowOpacity: 0,
    elevation: 0,
  },
  secondaryButtonText: { color: "#ff5722" },
  or: {
    textAlign: "center",
    color: "#6b7280",
    marginVertical: 10,
    fontSize: 13,
  },
  compactOr: { marginVertical: 7 },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: 14,
  },
  compactFooter: { marginTop: 10 },
  footerText: { color: "#6b7280", fontSize: 13 },
  link: { color: "#ff5722", fontWeight: "800", fontSize: 13 },
  error: {
    color: "#ef4444",
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  promoCard: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 20,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 12,
  },
  promoImage: { width: "100%", height: 330, borderRadius: 16 },
  promoTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111827",
    marginTop: 10,
  },
  promoCounter: { color: "#6b7280", marginTop: 8 },
  closeButton: { alignSelf: "flex-end", paddingHorizontal: 8, zIndex: 1 },
  closeText: { fontSize: 30, color: "#303849" },
  slideButtons: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
  },
  successCard: {
    width: "100%",
    maxWidth: 380,
    padding: 28,
    borderRadius: 24,
    backgroundColor: "#ffffff",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 12,
  },
  successIcon: {
    fontSize: 44,
    color: "#ff5722",
    marginBottom: 12,
    fontWeight: "900",
  },
  successTitle: {
    fontSize: 22,
    color: "#111827",
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
});
