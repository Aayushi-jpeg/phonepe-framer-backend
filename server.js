const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Validation helper functions
const validateMobileNumber = (mobile) => {
  const mobileRegex = /^[6-9]\d{9}$/;
  return mobileRegex.test(mobile);
};

const validateAmount = (amount) => {
  const numAmount = parseFloat(amount);
  return !isNaN(numAmount) && numAmount > 0 && numAmount <= 100000; // Max ₹1,00,000
};

app.post("/pay", async (req, res) => {
  try {
    const { amount, mobile, name } = req.body;
    
    // Enhanced input validation
    if (!amount || !mobile || !name) {
      return res.status(400).json({ 
        error: "Missing required fields", 
        required: ["amount", "mobile", "name"],
        received: req.body
      });
    }

    // Validate mobile number format
    if (!validateMobileNumber(mobile)) {
      return res.status(400).json({ 
        error: "Invalid mobile number format. Must be 10 digits starting with 6-9" 
      });
    }

    // Validate amount
    if (!validateAmount(amount)) {
      return res.status(400).json({ 
        error: "Invalid amount. Must be between ₹1 and ₹1,00,000" 
      });
    }

    // Validate name length
    if (name.length < 2 || name.length > 50) {
      return res.status(400).json({ 
        error: "Name must be between 2 and 50 characters" 
      });
    }

    // Environment variables
    const merchantId = process.env.MERCHANT_ID;
    const saltKey = process.env.SALT_KEY;
    const saltIndex = process.env.SALT_INDEX;
    
    if (!merchantId || !saltKey || !saltIndex) {
      console.error("Missing environment variables");
      return res.status(500).json({ 
        error: "Server configuration error",
        details: "Required environment variables not set"
      });
    }

    // Generate unique transaction ID with timestamp
    const timestamp = Date.now();
    const transactionId = `MT${timestamp}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const userId = `MUID${timestamp}`;
    
    // Base URL for callbacks - adjust based on your deployment
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    
    // Create payload - EXACT format PhonePe expects
    const payload = {
      merchantId: merchantId,
      merchantTransactionId: transactionId,
      merchantUserId: userId,
      amount: Math.round(parseFloat(amount) * 100), // Convert to paisa, ensure integer
      redirectUrl: `${baseUrl}/callback/${transactionId}`,
      redirectMode: "POST", // Can be GET or POST
      callbackUrl: `${baseUrl}/callback/${transactionId}`,
      mobileNumber: mobile,
      paymentInstrument: {
        type: "PAY_PAGE"
      }
    };

    console.log("Transaction ID:", transactionId);
    console.log("Final Payload:", JSON.stringify(payload, null, 2));

    // Encode payload to base64
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
    
    // Create hash for verification
    const dataToHash = payloadBase64 + "/pg/v1/pay" + saltKey;
    const hash = crypto.createHash("sha256").update(dataToHash).digest("hex");
    const xVerify = hash + "###" + saltIndex;

    console.log("Base64 Payload:", payloadBase64);
    console.log("X-VERIFY Hash:", xVerify);

    // Determine API endpoint (UAT for testing, Production for live)
    // For testing, always use UAT endpoint
    const isProduction = process.env.NODE_ENV === 'production' && 
                        merchantId.startsWith('M') && 
                        !merchantId.includes('TEST');
    
    const apiUrl = isProduction 
      ? "https://api.phonepe.com/apis/hermes/pg/v1/pay"
      : "https://api-preprod.phonepe.com/apis/hermes/pg/v1/pay";
    
    console.log("Using API URL:", apiUrl, "(Production:", isProduction + ")");

    // Make API call to PhonePe
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerify,
        "accept": "application/json"
      },
      body: JSON.stringify({
        request: payloadBase64
      })
    });

    const responseText = await response.text();
    console.log("HTTP Status:", response.status);
    console.log("Raw Response:", responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Failed to parse response:", parseError);
      return res.status(500).json({ 
        error: "Invalid response from PhonePe",
        httpStatus: response.status,
        rawResponse: responseText
      });
    }

    console.log("Parsed PhonePe Response:", JSON.stringify(data, null, 2));

    // Check for success and valid response structure
    if (data.success === true && data.data && data.data.instrumentResponse) {
      const redirectInfo = data.data.instrumentResponse.redirectInfo;
      
      if (redirectInfo && redirectInfo.url) {
        res.json({ 
          success: true,
          url: redirectInfo.url,
          transactionId: transactionId,
          merchantTransactionId: transactionId
        });
      } else {
        console.error("Missing redirect URL in successful response:", data);
        res.status(400).json({ 
          error: "Payment initiation failed - missing redirect URL", 
          details: data
        });
      }
    } else {
      console.error("Payment initiation failed:", data);
      res.status(400).json({ 
        error: "Payment initiation failed", 
        details: data,
        message: data.message || "Unknown error from PhonePe",
        code: data.code || "UNKNOWN_ERROR"
      });
    }
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      error: "Internal server error", 
      details: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// Enhanced callback endpoint to handle PhonePe response
app.post("/callback/:transactionId", async (req, res) => {
  try {
    const transactionId = req.params.transactionId;
    console.log("POST Callback received for transaction:", transactionId);
    console.log("Callback headers:", req.headers);
    console.log("Callback body:", req.body);
    
    // Verify the callback (optional but recommended)
    const merchantId = process.env.MERCHANT_ID;
    if (merchantId) {
      // Get transaction status to verify
      const status = await getTransactionStatus(transactionId);
      console.log("Transaction status from callback:", status);
    }
    
    // You can redirect user to success/failure page based on response
    // For testing, return JSON response
    res.json({ 
      message: "Callback received successfully",
      transactionId: transactionId,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).json({ error: "Callback processing failed" });
  }
});

// Handle GET callback as well (some implementations use GET)
app.get("/callback/:transactionId", async (req, res) => {
  try {
    const transactionId = req.params.transactionId;
    console.log("GET Callback received for transaction:", transactionId);
    console.log("Query params:", req.query);
    
    // For web interface, you might want to redirect to a page
    res.send(`
      <html>
        <body>
          <h2>Payment Callback Received</h2>
          <p>Transaction ID: ${transactionId}</p>
          <p>Status: Processing...</p>
          <script>
            // You can add JavaScript here to check status and redirect
            setTimeout(() => {
              window.location.href = '/status/${transactionId}';
            }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("GET Callback error:", err);
    res.status(500).send("Callback processing failed");
  }
});

// Helper function to get transaction status
async function getTransactionStatus(transactionId) {
  try {
    const merchantId = process.env.MERCHANT_ID;
    const saltKey = process.env.SALT_KEY;
    const saltIndex = process.env.SALT_INDEX;
    
    if (!merchantId || !saltKey || !saltIndex) {
      throw new Error("Missing environment variables");
    }
    
    const dataToHash = `/pg/v1/status/${merchantId}/${transactionId}` + saltKey;
    const hash = crypto.createHash("sha256").update(dataToHash).digest("hex");
    const xVerify = hash + "###" + saltIndex;
    
    const isProduction = process.env.NODE_ENV === 'production' && 
                        merchantId.startsWith('M') && 
                        !merchantId.includes('TEST');
    
    const statusUrl = isProduction 
      ? `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${transactionId}`
      : `https://api-preprod.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${transactionId}`;
    
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerify,
        "X-MERCHANT-ID": merchantId,
        "accept": "application/json"
      }
    });
    
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("Status check error:", err);
    throw err;
  }
}

// Enhanced status check endpoint
app.get("/status/:transactionId", async (req, res) => {
  try {
    const transactionId = req.params.transactionId;
    const data = await getTransactionStatus(transactionId);
    
    console.log("Status check response:", JSON.stringify(data, null, 2));
    
    // Format response for better readability
    const formattedResponse = {
      transactionId: transactionId,
      status: data.success ? 'SUCCESS' : 'FAILED',
      data: data.data,
      message: data.message,
      code: data.code,
      timestamp: new Date().toISOString()
    };
    
    res.json(formattedResponse);
  } catch (err) {
    console.error("Status check error:", err);
    res.status(500).json({ 
      error: "Status check failed",
      details: err.message,
      transactionId: req.params.transactionId
    });
  }
});

// Test endpoint to verify server setup
app.get("/test", (req, res) => {
  res.json({
    message: "PhonePe Test Server is running!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      pay: "POST /pay",
      status: "GET /status/:transactionId",
      callback: "POST|GET /callback/:transactionId",
      health: "GET /health"
    }
  });
});

// Enhanced health check
app.get("/health", (req, res) => {
  const envCheck = {
    merchantId: !!process.env.MERCHANT_ID,
    saltKey: !!process.env.SALT_KEY,
    saltIndex: !!process.env.SALT_INDEX,
    baseUrl: !!process.env.BASE_URL,
    nodeEnv: process.env.NODE_ENV || 'development'
  };
  
  const allEnvVarsPresent = envCheck.merchantId && envCheck.saltKey && envCheck.saltIndex;
  
  res.json({ 
    status: allEnvVarsPresent ? "Healthy" : "Configuration incomplete",
    timestamp: new Date().toISOString(),
    environment: envCheck,
    ready: allEnvVarsPresent
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Handle 404 routes
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method,
    availableRoutes: [
      "POST /pay",
      "GET /status/:transactionId", 
      "POST /callback/:transactionId",
      "GET /callback/:transactionId",
      "GET /health",
      "GET /test"
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 PhonePe Test Server running on port ${PORT}`);
  console.log(`📱 Test endpoint: http://localhost:${PORT}/test`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  
  console.log("\n🔧 Environment check:");
  console.log("  MERCHANT_ID:", process.env.MERCHANT_ID ? "✅ Set" : "❌ Missing");
  console.log("  SALT_KEY:", process.env.SALT_KEY ? "✅ Set" : "❌ Missing");
  console.log("  SALT_INDEX:", process.env.SALT_INDEX ? "✅ Set" : "❌ Missing");
  console.log("  BASE_URL:", process.env.BASE_URL ? "✅ Set" : "⚠️  Using default (localhost)");
  console.log("  NODE_ENV:", process.env.NODE_ENV || "development");
  
  console.log("\n📋 Testing Tips:");
  console.log("  1. Test with UAT credentials first");
  console.log("  2. Use test mobile numbers: 7000000001-7000000010");
  console.log("  3. Amount should be between ₹1 and ₹1,00,000");
  console.log("  4. Check logs for detailed request/response info");
});
