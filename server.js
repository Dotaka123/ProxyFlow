const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

// --- PAGE D'ACCUEIL (FIX CANNOT GET /) ---
app.get('/', (req, res) => {
    res.send(`
        <body style="background:#121212;color:white;text-align:center;padding-top:100px;font-family:sans-serif;">
            <h1 style="color:#2ecc71;">● ProxyFlow Bot is Online</h1>
            <p>Le Webhook Messenger est actif.</p>
            <a href="https://www.facebook.com/profile.php?id=61586969783401" style="color:#3498db;text-decoration:none;">Support Technique</a>
        </body>
    `);
});

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const SUPPORT_LINK = "https://www.facebook.com/profile.php?id=61586969783401";

mongoose.connect(MONGO_URI);

// --- MODÈLES ---
const User = mongoose.model('User', new mongoose.Schema({
    psid: { type: String, unique: true }, email: String, password: String,
    balance: { type: Number, default: 0 }, isLoggedIn: { type: Boolean, default: false },
    step: { type: String, default: 'IDLE' }, selectedItem: String, selectedPrice: Number
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    psid: String, orderId: String, provider: String, price: Number,
    status: { type: String, default: 'EN ATTENTE' }, proxyData: String, date: { type: Date, default: Date.now }
}));

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    if (text === "Return to main menu") return sendMenu(psid, user);

    // --- SIGNUP AVEC VALIDATION ---
    if (user.step === 'SIGNUP_EMAIL') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text.trim())) {
            return sendText(psid, "❌ Invalid email format. Please enter a real email:");
        }
        user.email = text.trim().toLowerCase();
        user.step = 'SIGNUP_PASS'; await user.save();
        return sendText(psid, "🔐 Choose a password (min. 6 characters):");
    }
    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 6) return sendText(psid, "⚠️ Password too short! Min 6 characters:");
        user.password = text.trim();
        user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendText(psid, "✅ Registration successful! Welcome to ProxyFlow.");
    }

    // --- LOGIN ---
    if (user.step === 'LOGIN_EMAIL') {
        const check = await User.findOne({ email: text.trim().toLowerCase() });
        if (!check) return sendText(psid, "❌ Email not found. Try again or Signup.");
        user.email = text.trim().toLowerCase();
        user.step = 'LOGIN_PASS'; await user.save();
        return sendText(psid, "🔐 Enter your password:");
    }
    if (user.step === 'LOGIN_PASS') {
        const real = await User.findOne({ email: user.email });
        if (real && real.password === text.trim()) {
            user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
            return sendMenu(psid, user);
        } else {
            return sendText(psid, "❌ Wrong password. Try again:");
        }
    }

    // --- QUANTITÉ ---
    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Please enter a valid number.");
        if (user.selectedItem === 'VIRGIN' && qty < 10) return sendText(psid, "⚠️ Minimum 10 pieces for Virgin Residential.");

        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `🛒 Order: ${qty}x ${user.selectedItem}\n💰 Total: $${total.toFixed(2)}`, [
            { "title": "Confirm & Pay", "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your Email:"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your Email:"); }
    
    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'GOTO_SIGNOUT') {
        user.isLoggedIn = false; user.step = 'IDLE'; await user.save();
        sendText(psid, "👋 Logged out successfully!");
        return sendAuth(psid);
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Select Category:", [
            { "title": "⚡ Static ISP ($6)", "payload": "MENU_STATIC" },
            { "title": "🏠 Virgin Resi ($6)", "payload": "MENU_VIRGIN" },
            { "title": "📍 Verizon ($4.5)", "payload": "MENU_VERIZON" }
        ]);
    }

    if (payload.startsWith('MENU_')) {
        const type = payload.split('_')[1];
        const price = (type === 'VERIZON') ? '4.5' : '6.0';
        return sendButtons(psid, `Options for ${type}:`, [
            { "title": "🛒 Buy Now", "payload": `BUY_${type}_${price}` },
            { "title": "ℹ️ Info", "payload": `INFO_${type}` },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    if (payload.startsWith('INFO_')) {
        const info = { 
            'STATIC': "⚡ STATIC ISP ($6.00):\n- USA/UK/AUS.\n- High speed & Renewable.", 
            'VIRGIN': "🏠 VIRGIN ($6.00):\n- AT&T or Windstream.\n- Cleanest IPs. Min: 10.", 
            'VERIZON': "📍 VERIZON ($4.50):\n- Static Residential.\n- Fast & Stable." 
        };
        return sendText(psid, info[payload.split('_')[1]]);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY'; await user.save();
        return sendText(psid, `How many ${item} proxies? ${item === 'VIRGIN' ? '(Min 10)' : ''}`);
    }

    if (payload === 'MY_ACCOUNT') {
        let low = (user.balance < 4.5) ? "\n⚠️ Low balance!" : "";
        return sendButtons(psid, `👤 Account: ${user.email}\n💰 Balance: ${user.balance.toFixed(2)}$${low}`, [
            { "title": "➕ Add Funds", "payload": "ADD_FUNDS" },
            { "title": "📜 History", "payload": "MY_ORDERS" },
            { "title": "🚪 Sign Out", "payload": "GOTO_SIGNOUT" }
        ]);
    }

    if (payload === 'ADD_FUNDS') {
        return sendButtons(psid, "💳 Min deposit: $10\nSend to Binance ID or LTC.\nContact support with proof.", [{ "title": "👨‍💻 Support", "url": SUPPORT_LINK }]);
    }

    if (payload === 'MY_ORDERS') {
        const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
        if (orders.length === 0) return sendText(psid, "📜 No history.");
        let m = "📜 Last Orders:\n";
        orders.forEach(o => m += `\n${o.status === 'LIVRÉ' ? '✅':'⏳'} ${o.provider} - ${o.status}`);
        return sendText(psid, m);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        const cost = parseFloat(total);
        if (user.balance >= cost) {
            user.balance -= cost;
            const oid = "PF" + Math.floor(Math.random()*99999);
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost });
            await user.save();
            return sendText(psid, `✅ Order ${oid} placed! Admin will deliver soon.`);
        } else {
            return sendText(psid, `❌ Insufficient balance ($${user.balance.toFixed(2)}). Need $${cost.toFixed(2)}.`);
        }
    }
}

// --- HELPERS ---
function sendAuth(psid) {
    sendButtons(psid, "Welcome to ProxyFlow! 🌐\nPlease login or signup:", [
        { "title": "🔑 Login", "payload": "GOTO_LOGIN" },
        { "title": "📝 Signup", "payload": "GOTO_SIGNUP" }
    ]);
}

function sendMenu(psid, user) {
    if (!user.isLoggedIn) return sendAuth(psid);
    let alert = (user.balance < 4.5) ? " (⚠️ Low Balance)" : "";
    sendButtons(psid, `ProxyFlow Menu${alert}\nBalance: ${user.balance.toFixed(2)}$`, [
        { "title": "🛒 Shop", "payload": "START_ORDER" },
        { "title": "👤 My Account", "payload": "MY_ACCOUNT" }
    ]);
}

function sendText(psid, text) {
    callAPI(psid, { text, quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }] });
}

function sendButtons(psid, text, b) {
    const btns = b.map(x => x.url ? { type: "web_url", title: x.title, url: x.url } : { type: "postback", title: x.title, payload: x.payload });
    callAPI(psid, {
        attachment: { type: "template", payload: { template_type: "button", text, buttons: btns } },
        quick_replies: [{ content_type: "text", title: "Return to main menu", payload: "MAIN" }]
    });
}

function callAPI(psid, message) {
    axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id: psid }, message }).catch(()=>{});
}

// --- WEBHOOK ---
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']); });
app.post('/webhook', async (req, res) => {
    let entry = req.body.entry[0];
    if (entry && entry.messaging) {
        let event = entry.messaging[0];
        let psid = event.sender.id;
        let user = await User.findOne({ psid }) || await User.create({ psid });
        if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
        else if (event.postback) handlePostback(psid, event.postback.payload, user);
    }
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000);
