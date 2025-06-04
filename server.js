const express = require("express");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post("/pay", (req, res) => {
  const { amount, mobile, name } = req.body;

  const merchantId = process.env.MERCHANT_ID;
  const saltKey = process.env.SALT_KEY;
  const saltIndex = process.env.SALT_INDEX;
  const callback = process.env.CALLBACK_URL;

  const transactionId = "T" + Date.now();

  const payload = {
    merchantId,
    transactionId,
    merchantUserId: mobile,
    amount: amount * 100,
    redirectUrl: callback,
    redirectMode: "POST",
    mobileNumber: mobile,
    paymentInstrument: {
      type: "PAY_PAGE"
    }
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const dataToHash = payloadBase64 + "/pg/v1/pay" + saltKey;
  const hash = crypto.createHash("sha256").update(dataToHash).digest("hex") + "###" + saltIndex;

  fetch("https://api.phonepe.com/apis/hermes/pg/v1/pay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-VERIFY": hash
    },
    body: JSON.stringify({
      request: payloadBase64
    })
  })
    .then(r => r.json())
    .then(data => {
      if (data.success && data.data.instrumentResponse.redirectInfo.url) {
        res.json({ url: data.data.instrumentResponse.redirectInfo.url });
      } else {
        res.status(400).json({ error: "Payment failed", details: data });
      }
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: "Something went wrong" });
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
