async function run() {
  const endpoints = [
    ["POST", "https://kiosk-app-production-511f.up.railway.app/api/order/kiosk/customer"],
    ["POST", "https://kiosk-app-production-511f.up.railway.app/api/order/kiosk/customer/save"],
    ["POST", "https://kiosk-app-production-511f.up.railway.app/api/order/kiosk/customers"],
    ["POST", "https://kiosk-app-production-511f.up.railway.app/api/kiosk/customer"],
    ["GET", "https://kiosk-app-production-511f.up.railway.app/api/dishes/98373187-009C-440F-A196-53A205DCA997"],
    ["GET", "https://kiosk-app-production-511f.up.railway.app/api/dish/98373187-009C-440F-A196-53A205DCA997"]
  ];

  for (const [method, url] of endpoints) {
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ carNumber: "TEST" }) : undefined
      });
      console.log(`${method} ${url} -> status ${res.status}`);
      const text = await res.text();
      console.log(`Response: ${text.slice(0, 150)}`);
    } catch (e) {
      console.log(`Error on ${url}:`, e.message);
    }
  }
  process.exit(0);
}
run();
