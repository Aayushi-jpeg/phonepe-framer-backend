const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post("/pay", async (req, res) => {
  try {
    const { amount, mobile, name } = req.body;
    
    // Input validation
    if (!amount || !mobile || !name) {
      return res.status(400).json({ 
        error: "Missing required fields", 
        required: ["amount", "mobile", "name"],
        received: req.body
      });
    }

    // Environment variables validation
    const merchantId = process.env.MERCHANT_ID;
    const saltKey = process.env.SALT_KEY;
    const saltIndex = process.env.SALT_INDEX;
    const callback = process.env.CALLBACK_URL;

    if (!merchantId || !saltKey || !saltIndex || !callback) {
      console.error("Missing environment variables:", {
        merchantId: !!merchantId,
        saltKey: !!saltKey,
        saltIndex: !!saltIndex,
        callback: !!callback
      });
      return res.status(500).json({ error: "Server configuration error" });
    }

    const transactionId = "T" + Date.now();
    
    // Create payload
    const payload = {
      merchantId,
      merchantTransactionId: transactionId, // This should be merchantTransactionId, not transactionId
      merchantUserId: mobile,
      amount: amount * 100, // Amount in paisa
      redirectUrl: callback,
      redirectMode: "POST",
      mobileNumber: mobile,
      paymentInstrument: {
        type: "PAY_PAGE"
      }
    };

    console.log("Payload:", JSON.stringify(payload, null, 2));

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
    const dataToHash = payloadBase64 + "/pg/v1/pay" + saltKey;
    const hash = crypto.createHash("sha256").update(dataToHash).digest("hex") + "###" + saltIndex;

    console.log("Base64 Payload:", payloadBase64);
    console.log("Hash:", hash);

    // Use the correct PhonePe API endpoint
    const apiUrl = process.env.NODE_ENV === 'production' 
      ? "https://api.phonepe.com/apis/hermes/pg/v1/pay" 
      : "https://api-preprod.phonepe.com/apis/hermes/pg/v1/pay"; // Use preprod for testing

    console.log("API URL:", apiUrl);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": hash,
        "accept": "application/json"
      },
      body: JSON.stringify({
        request: payloadBase64
      })
    });

    const data = await response.json();
    console.log("PhonePe Response:", JSON.stringify(data, null, 2));

    if (data.success && data.data && data.data.instrumentResponse && data.data.instrumentResponse.redirectInfo) {
      res.json({ 
        url: data.data.instrumentResponse.redirectInfo.url,
        transactionId: transactionId
      });
    } else {
      console.error("Payment failed:", data);
      res.status(400).json({ 
        error: "Payment failed", 
        details: data,
        code: data.code || "unknown"
      });
    }
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      error: "Something went wrong", 
      details: err.message 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "Server is running" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Environment check:", {
    merchantId: !!process.env.MERCHANT_ID,
    saltKey: !!process.env.SALT_KEY,
    saltIndex: !!process.env.SALT_INDEX,
    callback: !!process.env.CALLBACK_URL
  });
});
