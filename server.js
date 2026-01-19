const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// --- CONFIGURATION ---
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

const Settings = mongoose.model('Settings', new mongoose.Schema({
    key: String, value: String
}));

// --- ROUTES WEB (ADMIN & STATUS) ---
app.get('/', (req, res) => {
    res.send('<body style="background:#121212;color:white;text-align:center;font-family:sans-serif;padding-top:100px;"><h1>● ProxyFlow Online</h1><p>Residential 0 Fraud Score</p></body>');
});

// Route Admin pour mettre à jour les Free Proxies sans redémarrer
app.post('/admin/update-free', async (req, res) => {
    const { freeContent } = req.body;
    await Settings.findOneAndUpdate({ key: 'free_proxies' }, { value: freeContent }, { upsert: true });
    res.send("✅ Free proxies updated! Messenger bot updated instantly.");
});

// --- LOGIQUE MESSAGES ---
async function handleMessage(psid, text, user) {
    if (text === "Return to main menu") return sendMenu(psid, user);

    if (user.step === 'SIGNUP_EMAIL') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text.trim())) return sendText(psid, "❌ Invalid email. Enter a real one:");
        user.email = text.trim().toLowerCase();
        user.step = 'SIGNUP_PASS'; await user.save();
        return sendText(psid, "🔐 Choose a password (min. 6 chars):");
    }
    if (user.step === 'SIGNUP_PASS') {
        if (text.length < 6) return sendText(psid, "⚠️ Too short! Min 6 characters:");
        user.password = text.trim(); user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendMenu(psid, user);
    }

    if (user.step === 'LOGIN_EMAIL') {
        const check = await User.findOne({ email: text.trim().toLowerCase() });
        if (!check) return sendText(psid, "❌ Email not found.");
        user.email = text.trim().toLowerCase(); user.step = 'LOGIN_PASS'; await user.save();
        return sendText(psid, "🔐 Enter password:");
    }
    if (user.step === 'LOGIN_PASS') {
        const real = await User.findOne({ email: user.email });
        if (real && real.password === text.trim()) {
            user.isLoggedIn = true; user.step = 'IDLE'; await user.save(); return sendMenu(psid, user);
        } else return sendText(psid, "❌ Wrong password.");
    }

    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Invalid number.");
        if (user.selectedItem === 'VIRGIN' && qty < 10) return sendText(psid, "⚠️ Min: 10 pieces for Virgin.");
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
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter Email:"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Enter Email:"); }
    
    if (payload === 'FREE_PROXY') {
        const data = await Settings.findOne({ key: 'free_proxies' });
        const freeText = data ? data.value : "🚫 No free proxies available right now.";
        return sendText(psid, "🎁 FREE RESIDENTIAL PROXIES (0 Fraud Score):\n\n" + freeText);
    }

    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'GOTO_SIGNOUT') {
        user.isLoggedIn = false; user.step = 'IDLE'; await user.save();
        sendText(psid, "👋 Logged out successfully!");
        return sendAuth(psid);
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Select Service (All 0 Fraud Score):", [
            { "title": "⚡ Paid Proxies", "payload": "MENU_PAID" },
            { "title": "🎁 Free Proxy", "payload": "FREE_PROXY" }
        ]);
    }

    if (payload === 'MENU_PAID') {
        return sendButtons(psid, "Select Residential Type:", [
            { "title": "Static ISP ($6)", "payload": "MENU_STATIC" },
            { "title": "Virgin Resi ($6)", "payload": "MENU_VIRGIN" },
            { "title": "Verizon ($4.5)", "payload": "MENU_VERIZON" }
        ]);
    }

    if (payload.startsWith('MENU_')) {
        const type = payload.split('_')[1];
        const price = (type === 'VERIZON') ? '4.5' : '6.0';
        return sendButtons(psid, `${type} Residential:`, [
            { "title": "🛒 Buy Now", "payload": `BUY_${type}_${price}` },
            { "title": "ℹ️ Info", "payload": `INFO_${type}` },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    if (payload.startsWith('INFO_')) {
        const info = { 
            'STATIC': "⚡ STATIC ISP: Residential IP, 0 Fraud Score. Renewable.", 
            'VIRGIN': "🏠 VIRGIN: Cleanest IPs, 0 Fraud Score. Min 10 pieces.", 
            'VERIZON': "📍 VERIZON: Static Residential, 0 Fraud Score. Fast." 
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
        return sendButtons(psid, `👤 ${user.email}\n💰 Balance: ${user.balance.toFixed(2)}$${low}`, [
            { "title": "➕ Add Funds", "payload": "ADD_FUNDS" },
            { "title": "📜 History", "payload": "MY_ORDERS" },
            { "title": "🚪 Sign Out", "payload": "GOTO_SIGNOUT" }
        ]);
    }

    if (payload === 'ADD_FUNDS') {
        return sendButtons(psid, "💳 Min deposit: $10. Binance/LTC.\nContact support with proof.", [{ "title": "👨‍💻 Support", "url": SUPPORT_LINK }]);
    }

    if (payload.startsWith('CONFIRM_PAY_')) {
        const [,, qty, total] = payload.split('_');
        const cost = parseFloat(total);
        const oid = "PF" + Math.floor(Math.random()*99999);
        if (user.balance >= cost) {
            user.balance -= cost;
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost, status: 'EN ATTENTE (Solde)' });
            await user.save();
            return sendText(psid, `✅ Order ${oid} placed via balance!`);
        } else {
            await Order.create({ psid, orderId: oid, provider: `${qty}x ${user.selectedItem}`, price: cost, status: 'EN ATTENTE (Manuel)' });
            return sendButtons(psid, `📝 Order ${oid} created!\n💰 Total: $${cost.toFixed(2)}\n⚠️ Please send payment manually and contact support.`, [{"title":"👨‍💻 Support", "url": SUPPORT_LINK}]);
        }
    }
}

// --- HELPERS ---
function sendAuth(psid) {
    sendButtons(psid, "ProxyFlow 🌐\nResidential Proxies | 0 Fraud Score", [
        { "title": "🔑 Login", "payload": "GOTO_LOGIN" },
        { "title": "📝 Signup", "payload": "GOTO_SIGNUP" },
        { "title": "🎁 Free Proxy", "payload": "FREE_PROXY" }
    ]);
}

function sendMenu(psid, user) {
    if (!user.isLoggedIn) return sendAuth(psid);
    sendButtons(psid, `ProxyFlow Menu\nBalance: ${user.balance.toFixed(2)}$`, [
        { "title": "🛒 Shop", "payload": "START_ORDER" },
        { "title": "👤 Account", "payload": "MY_ACCOUNT" }
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
