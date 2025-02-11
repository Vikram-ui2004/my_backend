require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const multer = require("multer");
const path = require("path");



const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use("/uploads", express.static("uploads")); // Serve uploaded images

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
// Existing Razorpay routes...
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Route to verify server is running
app.get("/", (req, res) => {
  res.send("Backend is running successfully!");
});

// Route to create a payment order
app.post("/create-order", async (req, res) => {
  try {
    const options = {
      amount: req.body.amount * 100, // Amount in paisa (₹1 = 100 paisa)
      currency: "INR",
      receipt: `order_rcptid_${Math.floor(Math.random() * 10000)}`,
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (error) {
    res.status(500).send(error);
  }
});

// Route to verify payment
app.post("/verify-payment", async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const generated_signature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  if (generated_signature === razorpay_signature) {
    res.json({ status: "success", message: "Payment successful" });
  } else {
    res.status(400).json({ status: "failure", message: "Payment verification failed" });
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

fetch(`${process.env.REACT_APP_BACKEND_URL}/api/data`)
  .then(response => response.json())
  .then(data => console.log(data));

// Start the backend server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend is running at http://localhost:${PORT}`);
});
