import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import KioskStartPage from "./KioskStartPage";
import LoginPage from "./LoginPage";
import OrderingScreen from "./OrderingScreen";
import SettlementSuccessScreen from "./SettlementSuccessScreen";

type ScreenState = "login" | "start" | "ordering" | "settlement_success";

export default function Index() {
  const [currentPage, setCurrentPage] = useState<ScreenState>("login");
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // Initial launch: ensure clean state and session check before revealing screen
    const checkSession = async () => {
      try {
        const storedKioskOrder = await AsyncStorage.getItem("kioskOrderId");
        if (storedKioskOrder) {
          await AsyncStorage.removeItem("kioskOrderId");
        }
      } catch (err) {
        console.error("Error checking initial session:", err);
      } finally {
        // Small graceful pause so fonts/layout settle smoothly without flicker
        setTimeout(() => {
          setIsInitializing(false);
        }, 350);
      }
    };
    checkSession();
  }, []);

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingCard}>
          <View style={styles.logoBadge}>
            <View style={styles.carIcon}>
              <View style={styles.carRoof} />
              <View style={styles.carBody} />
              <View style={[styles.carWheel, styles.leftCarWheel]} />
              <View style={[styles.carWheel, styles.rightCarWheel]} />
            </View>
          </View>
          <Text style={styles.brandTitle}>
            RED BAY CAR <Text style={styles.brandAccent}>Wash</Text>
          </Text>
          <Text style={styles.brandSubtitle}>Unipro</Text>
          <ActivityIndicator size="large" color="#ff5722" style={styles.spinner} />
          <Text style={styles.loadingText}>Starting system...</Text>
        </View>
      </View>
    );
  }

  if (currentPage === "settlement_success") {
    return (
      <SettlementSuccessScreen
        orderId={completedOrderId}
        onReturnToOrder={() => {
          setCompletedOrderId(null);
          setCurrentPage("start");
        }}
      />
    );
  }

  if (currentPage === "ordering") {
    return (
      <OrderingScreen
        onOrderCompleted={(orderId) => {
          setCompletedOrderId(orderId);
          setCurrentPage("settlement_success");
        }}
        onLogout={() => {
          setCurrentPage("login");
        }}
      />
    );
  }

  if (currentPage === "start") {
    return (
      <KioskStartPage
        onStart={(user, selectedTable) => {
          console.log("Kiosk session started for user:", user, selectedTable);
          setCurrentPage("ordering");
        }}
        onBackToLogin={() => setCurrentPage("login")}
      />
    );
  }

  return (
    <LoginPage
      onLoginSuccess={() => {
        setCurrentPage("start");
      }}
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: "#101827",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#ffffff",
    borderRadius: 28,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 32,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 10,
  },
  logoBadge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#ff5722",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: "#ffffff",
    shadowColor: "#ff5722",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 16,
  },
  carIcon: {
    width: 36,
    height: 26,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  carRoof: {
    position: "absolute",
    top: 2,
    width: 19,
    height: 10,
    borderColor: "#ffffff",
    borderWidth: 2,
    borderBottomWidth: 0,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
  },
  carBody: {
    width: 32,
    height: 12,
    borderColor: "#ffffff",
    borderWidth: 2,
    borderRadius: 5,
  },
  carWheel: {
    position: "absolute",
    bottom: 0,
    width: 7,
    height: 7,
    borderColor: "#ffffff",
    borderWidth: 2,
    borderRadius: 3.5,
    backgroundColor: "#ff5722",
  },
  leftCarWheel: { left: 4 },
  rightCarWheel: { right: 4 },
  brandTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  brandAccent: {
    color: "#ff5722",
  },
  brandSubtitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    color: "#6b7280",
    marginTop: 4,
    marginBottom: 20,
    textAlign: "center",
  },
  spinner: {
    marginBottom: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4b5563",
    textAlign: "center",
  },
});


