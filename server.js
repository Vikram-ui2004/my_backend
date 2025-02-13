require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const OpenAI = require("openai");
const axios = require("axios");




const app = express();
app.use(cors({ origin: "http://localhost:3000" }));
app.use(bodyParser.json());
app.use(express.json());
app.use("/uploads", express.static("uploads")); // Serve uploaded images

const corsOptions = {
  origin: process.env.FRONTEND_URL,
  methods: "GET,POST",
};
app.use(cors(corsOptions));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);

const OrderSchema = new mongoose.Schema({
  traveler: {
    name: String,
    email: String,
    phone: String,
  },
  packageName: String,
  amount: Number,
  orderId: String,
  paymentStatus: { type: String, default: "Pending" },
});

const Order = mongoose.model("Order", OrderSchema);

// Donation Schema
const donationSchema = new mongoose.Schema({
  name: String,
  email: String,
  amount: Number,
  paymentId: String,
  date: { type: Date, default: Date.now },
});

const Donation = mongoose.model("Donation", donationSchema);
// Route to register a new user
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  console.log("📩 Received signup request:", req.body);

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: "✅ User registered successfully" });
  } catch (error) {
    console.error("❌ Error registering user:", error);
    res.status(400).json({ error: "Error registering user: " + error.message });
  }
});

// Route to log in a user
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "❌ Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
      res.json({ message: "✅ Login successful" });
    } else {
      res.status(401).json({ error: "❌ Invalid email or password" });
    }
  } catch (error) {
    console.error("❌ Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  },
});

const upload = multer({ storage });

// ✅ Image Upload API
app.post("/upload", upload.single("profilePic"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");
  res.json({ imageUrl: req.file.path }); // ✅ Send file path to frontend
});

// ✅ API: Update User Profile
app.put("/update-profile", async (req, res) => {
  const { email, password, profilePic } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).send("User not found");

    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }
    user.profilePic = profilePic;

    await user.save();
    res.status(200).send("Profile updated successfully!");
  } catch (error) {
    res.status(500).send("Error updating profile: " + error.message);
  }
});
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Order Route
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;
    const options = { amount: amount * 100, currency: "INR" };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    res.status(500).send("Error creating order");
  }
});

// Verify Payment & Save to MongoDB
app.post("/verify-payment", async (req, res) => {
  try {
    const { razorpay_payment_id, donor } = req.body;

    const newDonation = new Donation({
      name: donor.name,
      email: donor.email,
      amount: donor.amount,
      paymentId: razorpay_payment_id,
    });

    await newDonation.save();
    res.json({ success: true, message: "Payment Verified & Saved!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Payment Verification Failed" });
  }
});

//for tavelling

app.post("/travel-order", async (req, res) => {
  try {
    const { packageName, amount, traveler } = req.body;

    const options = { amount, currency: "INR" };
    const order = await razorpay.orders.create(options);

    const newOrder = new Order({
      traveler,
      packageName,
      amount,
      orderId: order.id,
    });

    await newOrder.save();
    res.json({ orderId: order.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Order creation failed" });
  }
});

// Route to verify payment
app.post("/travel-verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const order = await Order.findOne({ orderId: razorpay_order_id });
    if (!order) return res.status(400).json({ message: "Invalid order" });

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (generatedSignature === razorpay_signature) {
      order.paymentStatus = "Paid";
      await order.save();
      return res.json({ message: "Payment Verified Successfully" });
    } else {
      return res.status(400).json({ message: "Payment verification failed" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error verifying payment" });
  }
});

app.get("/", (req, res) => {
  res.send("Backend is running...");
});


// OpenAI API Route
app.post("/api/ask", async (req, res) => {
  const { question } = req.body;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: question }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    res.json({ answer: response.data.choices[0].message.content });
  } catch (error) {
    console.error("Error calling OpenAI:", error);
    res.status(500).json({ error: "Failed to fetch response from OpenAI" });
  }
});

// Start the backend server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend is running at http://localhost:${PORT}`);
});
