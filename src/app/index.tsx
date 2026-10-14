import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import KioskStartPage from "./KioskStartPage";
import LoginPage from "./LoginPage";
import OrderingScreen from "./OrderingScreen";
import SettlementSuccessScreen from "./SettlementSuccessScreen";

type ScreenState = "login" | "start" | "ordering" | "settlement_success";

export default function Index() {
  const [currentPage, setCurrentPage] = useState<ScreenState>("login");
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(null);

  useEffect(() => {
    // Initial launch: always display the login screen first.
    // If there is an active kiosk order in progress, clear or allow clean login.
    const checkSession = async () => {
      try {
        const storedKioskOrder = await AsyncStorage.getItem("kioskOrderId");
        if (storedKioskOrder) {
          // If a kiosk order was abandoned or in progress, keep state clean for fresh login
          await AsyncStorage.removeItem("kioskOrderId");
        }
      } catch (err) {
        console.error("Error checking initial session:", err);
      }
    };
    checkSession();
  }, []);

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

