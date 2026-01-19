const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express().use(bodyParser.json());

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

    // ÉTAPES SIGNUP
    if (user.step === 'SIGNUP_EMAIL') {
        user.email = text; user.step = 'SIGNUP_PASS'; await user.save();
        return sendText(psid, "🔐 Choose a password for your account:");
    }
    if (user.step === 'SIGNUP_PASS') {
        user.password = text; user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
        return sendText(psid, "✅ Registration successful! Welcome to ProxyFlow.");
    }

    // ÉTAPES LOGIN
    if (user.step === 'LOGIN_EMAIL') {
        const checkUser = await User.findOne({ email: text });
        if (!checkUser) return sendText(psid, "❌ Email not found. Try again or Signup:");
        user.email = text; user.step = 'LOGIN_PASS'; await user.save();
        return sendText(psid, "🔐 Enter your password:");
    }
    if (user.step === 'LOGIN_PASS') {
        const realUser = await User.findOne({ email: user.email });
        if (realUser && realUser.password === text) {
            user.isLoggedIn = true; user.step = 'IDLE'; await user.save();
            return sendText(psid, "✅ Login successful!");
        } else {
            return sendText(psid, "❌ Wrong password. Try again:");
        }
    }

    // ÉTAPE QUANTITÉ
    if (user.step === 'ASK_QUANTITY') {
        const qty = parseInt(text);
        if (isNaN(qty) || qty <= 0) return sendText(psid, "❌ Enter a valid number.");
        if (user.selectedItem === 'VIRGIN' && qty < 10) return sendText(psid, "⚠️ Min: 10 pieces for Virgin.");
        const total = qty * user.selectedPrice;
        user.step = 'IDLE'; await user.save();
        return sendButtons(psid, `🛒 Order: ${qty}x ${user.selectedItem}\n💰 Total: $${total.toFixed(2)}`, [
            { "title": "Confirm Payment", "payload": `CONFIRM_PAY_${qty}_${total}` },
            { "title": "❌ Cancel", "payload": "START_ORDER" }
        ]);
    }

    if (!user.isLoggedIn) return sendAuth(psid);
    sendMenu(psid, user);
}

// --- LOGIQUE BOUTONS ---
async function handlePostback(psid, payload, user) {
    // ACTIONS PUBLIQUES (DÉCONNECTÉ)
    if (payload === 'GOTO_SIGNUP') { user.step = 'SIGNUP_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your Email to start:"); }
    if (payload === 'GOTO_LOGIN') { user.step = 'LOGIN_EMAIL'; await user.save(); return sendText(psid, "📧 Enter your registered Email:"); }

    // ACTIONS PRIVÉES (CONNECTÉ)
    if (!user.isLoggedIn) return sendAuth(psid);

    if (payload === 'GOTO_SIGNOUT') {
        user.isLoggedIn = false; user.step = 'IDLE'; await user.save();
        return sendText(psid, "👋 Logged out successfully. See you soon!");
    }

    if (payload === 'START_ORDER') {
        return sendButtons(psid, "🌍 Select Category:", [
            { "title": "⚡ Static ISP ($5)", "payload": "MENU_STATIC" },
            { "title": "🏠 Virgin Resi ($5)", "payload": "MENU_VIRGIN" },
            { "title": "📍 Verizon ($3.5)", "payload": "MENU_VERIZON" }
        ]);
    }

    // SOUS-MENUS INFO/BUY
    if (payload.startsWith('MENU_')) {
        const type = payload.split('_')[1];
        const infoText = {
            'STATIC': "⚡ STATIC ISP: USA/UK/AUS. Renewable.",
            'VIRGIN': "🏠 VIRGIN: AT&T (HTTP) or Windstream (SOCKS5). Min 10.",
            'VERIZON': "📍 VERIZON: Static Residential. Non-renewable."
        }[type];
        const price = type === 'VERIZON' ? '3.5' : '5.0';
        return sendButtons(psid, infoText, [
            { "title": "🛒 Buy Now", "payload": `BUY_${type}_${price}` },
            { "title": "ℹ️ Full Details", "payload": `INFO_${type}` },
            { "title": "👨‍💻 Support", "url": SUPPORT_LINK }
        ]);
    }

    if (payload.startsWith('INFO_')) {
        const type = payload.split('_')[1];
        const details = {
            'STATIC': "ℹ️ Speed: 1Gbps. High anonymity. Monthly renewal available.",
            'VIRGIN': "ℹ️ 100% Private. Perfect for bypass. AT&T or Windstream lines.",
            'VERIZON': "ℹ️ Location specific (NY, IL, etc). Extremely stable residential IP."
        }[type];
        return sendText(psid, details);
    }

    if (payload.startsWith('BUY_')) {
        const [_, item, price] = payload.split('_');
        user.selectedItem = item; user.selectedPrice = parseFloat(price);
        user.step = 'ASK_QUANTITY'; await user.save();
        return sendText(psid, `How many ${item} proxies? ${item === 'VIRGIN' ? '(Min 10)' : ''}`);
    }

    if (payload === 'MY_ACCOUNT') {
        return sendButtons(psid, `👤 Account: ${user.email}\n💰 Balance: ${user.balance.toFixed(2)}$`, [
            { "title": "📜 History", "payload": "MY_ORDERS" },
            { "title": "➕ Add Funds", "payload": "ADD_FUNDS" },
            { "title": "🚪 Sign Out", "payload": "GOTO_SIGNOUT" }
        ]);
    }

    // (Reste des fonctions CONFIRM_PAY, MY_ORDERS, ADD_FUNDS identique...)
    if (payload === 'MY_ORDERS') {
        const orders = await Order.find({ psid }).sort({ date: -1 }).limit(5);
        if (orders.length === 0) return sendText(psid, "📜 No orders yet.");
        let m = "📜 History:\n";
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
            return sendText(psid, `✅ Order ${oid} placed!`);
        }
        return sendText(psid, "❌ Insufficient balance.");
    }
}

// --- HELPERS DYNAMIQUES ---
function sendAuth(psid) {
    sendButtons(psid, "Welcome to ProxyFlow! 🌐\nPlease login or create an account to continue.", [
        { "title": "🔑 Login", "payload": "GOTO_LOGIN" },
        { "title": "📝 Signup", "payload": "GOTO_SIGNUP" }
    ]);
}

function sendMenu(psid, user) {
    sendButtons(psid, `ProxyFlow Menu\nUser: ${user.email}\nBalance: ${user.balance.toFixed(2)}$`, [
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

// WEBHOOK
app.get('/webhook', (req, res) => { if (req.query['hub.verify_token'] === 'tata') res.status(200).send(req.query['hub.challenge']); });
app.post('/webhook', async (req, res) => {
    let event = req.body.entry[0].messaging[0];
    let psid = event.sender.id;
    let user = await User.findOne({ psid }) || await User.create({ psid });
    if (event.message && event.message.text) handleMessage(psid, event.message.text, user);
    else if (event.postback) handlePostback(psid, event.postback.payload, user);
    res.status(200).send('OK');
});

app.listen(process.env.PORT || 3000);
