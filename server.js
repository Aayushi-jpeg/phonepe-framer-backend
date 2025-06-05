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

    // Environment variables
    const merchantId = process.env.MERCHANT_ID;
    const saltKey = process.env.SALT_KEY;
    const saltIndex = process.env.SALT_INDEX;
    
    if (!merchantId || !saltKey || !saltIndex) {
      console.error("Missing environment variables");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const transactionId = "MT" + Date.now(); // Changed prefix to MT
    const userId = "MUID" + Date.now();
    
    // Create payload - EXACT format PhonePe expects
    const payload = {
      merchantId: merchantId,
      merchantTransactionId: transactionId,
      merchantUserId: userId,
      amount: parseInt(amount) * 100, // Ensure it's integer, amount in paisa
      redirectUrl: `https://phonepe-framer-backend.onrender.com/callback/${transactionId}`,
      redirectMode: "POST",
      callbackUrl: `https://phonepe-framer-backend.onrender.com/callback/${transactionId}`,
      mobileNumber: mobile,
      paymentInstrument: {
        type: "PAY_PAGE"
      }
    };

    console.log("Final Payload:", JSON.stringify(payload, null, 2));

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
    const dataToHash = payloadBase64 + "/pg/v1/pay" + saltKey;
    const hash = crypto.createHash("sha256").update(dataToHash).digest("hex") + "###" + saltIndex;

    console.log("Base64 Payload:", payloadBase64);
    console.log("Hash:", hash);

    // Choose endpoint based on environment or merchant ID
    const isProduction = merchantId.startsWith('M') && !merchantId.includes('TEST');
    const apiUrl = isProduction 
      ? "https://api.phonepe.com/apis/hermes/pg/v1/pay"
      : "https://api.phonepe.com/apis/hermes/pg/v1/pay";
    console.log("Using API URL:", apiUrl, "(Production:", isProduction + ")");

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

    const responseText = await response.text();
    console.log("Raw Response:", responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Failed to parse response:", parseError);
      return res.status(500).json({ error: "Invalid response from PhonePe" });
    }

    console.log("Parsed PhonePe Response:", JSON.stringify(data, null, 2));

    // Check for success
    if (data.success === true && data.data && data.data.instrumentResponse && data.data.instrumentResponse.redirectInfo) {
      res.json({ 
        success: true,
        url: data.data.instrumentResponse.redirectInfo.url,
        transactionId: transactionId
      });
    } else {
      console.error("Payment initiation failed:", data);
      res.status(400).json({ 
        error: "Payment initiation failed", 
        details: data,
        message: data.message || "Unknown error",
        code: data.code || "UNKNOWN"
      });
    }
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      error: "Internal server error", 
      details: err.message 
    });
  }
});

// Callback endpoint to handle PhonePe response
app.post("/callback/:transactionId", (req, res) => {
  console.log("Callback received for transaction:", req.params.transactionId);
  console.log("Callback body:", req.body);
  
  // Handle the callback from PhonePe
  // You can redirect user to success/failure page based on response
  res.json({ message: "Callback received" });
});

app.get("/callback/:transactionId", (req, res) => {
  console.log("GET Callback received for transaction:", req.params.transactionId);
  console.log("Query params:", req.query);
  
  // Handle GET callback as well
  res.send("Payment callback received");
});

// Status check endpoint
app.get("/status/:transactionId", async (req, res) => {
  try {
    const merchantId = process.env.MERCHANT_ID;
    const saltKey = process.env.SALT_KEY;
    const saltIndex = process.env.SALT_INDEX;
    const transactionId = req.params.transactionId;
    
    const dataToHash = `/pg/v1/status/${merchantId}/${transactionId}` + saltKey;
    const hash = crypto.createHash("sha256").update(dataToHash).digest("hex") + "###" + saltIndex;
    
    const isProduction = merchantId.startsWith('M') && !merchantId.includes('TEST');
    const statusUrl = isProduction 
      ? `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${transactionId}`
      : `https://api-preprod.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${transactionId}`;
    
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": hash,
        "X-MERCHANT-ID": merchantId,
        "accept": "application/json"
      }
    });
    
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "Server is running",
    timestamp: new Date().toISOString(),
    env: {
      merchantId: !!process.env.MERCHANT_ID,
      saltKey: !!process.env.SALT_KEY,
      saltIndex: !!process.env.SALT_INDEX
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Environment check:", {
    merchantId: process.env.MERCHANT_ID ? "✓" : "✗",
    saltKey: process.env.SALT_KEY ? "✓" : "✗", 
    saltIndex: process.env.SALT_INDEX ? "✓" : "✗"
  });
});




