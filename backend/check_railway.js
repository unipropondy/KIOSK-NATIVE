async function run() {
  try {
    const dishesAll = await fetch("https://kiosk-app-production-511f.up.railway.app/api/dishes/all").then(r => r.json());
    const match = dishesAll.find(d => String(d.DishId).toUpperCase() === "98373187-009C-440F-A196-53A205DCA997".toUpperCase());
    console.log("Matching dish for 98373187-009C-440F-A196-53A205DCA997:", JSON.stringify(match, null, 2));

    const jencyCust = await fetch("https://kiosk-app-production-511f.up.railway.app/api/order/kiosk/customers/search?carNumber=ABC67899").then(r => r.json()).catch(e => e.message);
    console.log("Customer search API test:", jencyCust);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}
run();
