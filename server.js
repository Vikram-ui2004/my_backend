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
const axios = require("axios");



const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());
app.use("/uploads", express.static("uploads")); // Serve uploaded images


// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// User Schema & Model
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  profilePic: String
});
const User = mongoose.model("User", userSchema);

// Order Schema & Model
const orderSchema = new mongoose.Schema({
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
const Order = mongoose.model("Order", orderSchema);

// Donation Schema & Model
const donationSchema = new mongoose.Schema({
  name: String,
  email: String,
  amount: Number,
  paymentId: String,
  date: { type: Date, default: Date.now },
});
const Donation = mongoose.model("Donation", donationSchema);

// Create the Feedback schema
const feedbackSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  message: { type: String, required: true },
  image: { type: String },  // Store the image path if any
});

// Create the Feedback model
const Feedback = mongoose.model('Feedback', feedbackSchema);

// User Authentication Routes
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: "✅ User registered successfully" });
  } catch (error) {
    res.status(400).json({ error: "❌ Error registering user: " + error.message });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "❌ Invalid email or password" });
    }
    res.json({ message: "✅ Login successful" });
  } catch (error) {
    res.status(500).json({ error: "❌ Server error" });
  }
});

// Profile Picture Upload Configuration
const storage1 = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload1 = multer({ storage1 });

// Upload Profile Picture
app.post("/upload", upload1.single("profilePic"), (req, res) => {
  if (!req.file) return res.status(400).send("❌ No file uploaded");
  res.json({ imageUrl: req.file.path });
});

// Update User Profile
app.put("/update-profile", async (req, res) => {
  const { email, password, profilePic } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).send("❌ User not found");

    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }
    if (profilePic) {
      user.profilePic = profilePic;
    }
    await user.save();
    res.status(200).send("✅ Profile updated successfully!");
  } catch (error) {
    res.status(500).send("❌ Error updating profile: " + error.message);
  }
});

// Razorpay Configuration
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Create Donation Order
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: "INR",
    });
    res.json(order);
  } catch (error) {
    res.status(500).send("❌ Error creating order");
  }
});

// Verify Donation Payment
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
    res.json({ success: true, message: "✅ Payment Verified & Saved!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "❌ Payment Verification Failed" });
  }
});

// Create Travel Order
app.post("/travel-order", async (req, res) => {
  try {
    const { packageName, amount, traveler } = req.body;
    const order = await razorpay.orders.create({ amount, currency: "INR" });
    const newOrder = new Order({ traveler, packageName, amount, orderId: order.id });
    await newOrder.save();
    res.json({ orderId: order.id });
  } catch (error) {
    res.status(500).json({ message: "❌ Travel order creation failed" });
  }
});

// Verify Travel Payment
app.post("/travel-verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const order = await Order.findOne({ orderId: razorpay_order_id });
    if (!order) return res.status(400).json({ message: "❌ Invalid order" });

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature === razorpay_signature) {
      order.paymentStatus = "Paid";
      await order.save();
      return res.json({ message: "✅ Payment Verified Successfully" });
    }
    res.status(400).json({ message: "❌ Payment verification failed" });
  } catch (error) {
    res.status(500).json({ message: "❌ Error verifying payment" });
  }
});

// Health Check Route
app.get("/", (req, res) => {
  res.send("Backend is running...");
});


// Multer setup for handling image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
      cb(null, 'uploads/');  // Specify the folder for storing images
  },
  filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));  // Give a unique name
  }
});

const upload = multer({ storage });

// POST route to submit feedback
app.post('/submit-feedback', upload.single('image'), async (req, res) => {
  try {
      const { name, email, message } = req.body;
      const image = req.file ? req.file.path : null; // If an image is uploaded, store the path

      const newFeedback = new Feedback({
          name,
          email,
          message,
          image,
      });

      await newFeedback.save();
      res.status(200).json({ message: 'Feedback submitted successfully' });
  } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error submitting feedback' });
  }
});

//chatbot

const COHERE_API_KEY = process.env.COHERE_API_KEY; 

app.post("/api/chat", async (req, res) => {
    const { userMessage } = req.body;

    try {
        const response = await axios.post(
            "https://api.cohere.ai/v1/generate",
            {
                model: "command",
                prompt: userMessage,
                max_tokens: 50,
            },
            {
                headers: {
                    Authorization: `Bearer ${COHERE_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        res.json({ botReply: response.data.generations[0].text.trim() });
    } catch (error) {
        console.error("API Error:", error);
        res.status(500).json({ error: "Something went wrong!" });
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
